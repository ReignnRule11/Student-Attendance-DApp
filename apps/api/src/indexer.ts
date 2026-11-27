import type { DatabaseSync } from "node:sqlite";
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import type { AuthRole } from "./auth.ts";
import { getSyncValue, setSyncValue } from "./db.ts";

export const attendanceContractAbi = parseAbi([
  "function admin() view returns (address)",
  "function instructors(address) view returns (bool)",
  "event SessionCreated(uint256 indexed sessionId, address indexed instructor, uint64 startsAt, uint64 endsAt, uint64 qrNonce)",
  "event SessionStatusUpdated(uint256 indexed sessionId, bool active)",
  "event QrNonceRotated(uint256 indexed sessionId, uint64 newNonce)",
  "event AttendanceRecorded(uint256 indexed sessionId, address indexed student, address indexed instructor, uint64 recordedAt)",
]);

const LAST_BLOCK_KEY = "last_synced_block";
const MAX_BLOCK_CHUNK = BigInt(10_000);

export function createSepoliaClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl, { timeout: 10_000, retryCount: 1 }),
  });
}

export async function resolveOnChainRole(
  client: PublicClient,
  contractAddress: Address,
  wallet: Address,
): Promise<AuthRole | null> {
  const [adminAddress, isInstructor] = await Promise.all([
    client.readContract({
      address: contractAddress,
      abi: attendanceContractAbi,
      functionName: "admin",
    }),
    client.readContract({
      address: contractAddress,
      abi: attendanceContractAbi,
      functionName: "instructors",
      args: [wallet],
    }),
  ]);

  if (adminAddress.toLowerCase() === wallet.toLowerCase()) {
    return "admin";
  }
  if (isInstructor) {
    return "instructor";
  }
  return null;
}

export async function syncContractEvents(params: {
  db: DatabaseSync;
  client: PublicClient;
  contractAddress: Address;
  defaultStartBlock: bigint;
}): Promise<{ fromBlock: string; toBlock: string; eventsProcessed: number }> {
  const { db, client, contractAddress, defaultStartBlock } = params;
  const latestBlock = await client.getBlockNumber();
  const saved = getSyncValue(db, LAST_BLOCK_KEY);
  let cursor = saved !== null ? BigInt(saved) + BigInt(1) : defaultStartBlock;

  if (cursor > latestBlock) {
    return {
      fromBlock: cursor.toString(),
      toBlock: latestBlock.toString(),
      eventsProcessed: 0,
    };
  }

  let eventsProcessed = 0;

  while (cursor <= latestBlock) {
    const chunkEnd =
      cursor + MAX_BLOCK_CHUNK - BigInt(1) < latestBlock
        ? cursor + MAX_BLOCK_CHUNK - BigInt(1)
        : latestBlock;

    const [createdLogs, statusLogs, nonceLogs, attendanceLogs] = await Promise.all([
      client.getLogs({
        address: contractAddress,
        event: attendanceContractAbi[2],
        fromBlock: cursor,
        toBlock: chunkEnd,
      }),
      client.getLogs({
        address: contractAddress,
        event: attendanceContractAbi[3],
        fromBlock: cursor,
        toBlock: chunkEnd,
      }),
      client.getLogs({
        address: contractAddress,
        event: attendanceContractAbi[4],
        fromBlock: cursor,
        toBlock: chunkEnd,
      }),
      client.getLogs({
        address: contractAddress,
        event: attendanceContractAbi[5],
        fromBlock: cursor,
        toBlock: chunkEnd,
      }),
    ]);

    for (const log of createdLogs) {
      const args = log.args;
      if (args.sessionId === undefined || !args.instructor) continue;
      db.prepare(
        `INSERT INTO indexed_sessions (session_id, instructor, starts_at, ends_at, qr_nonce, active, tx_hash, block_number)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(session_id) DO NOTHING`,
      ).run(
        args.sessionId.toString(),
        args.instructor.toLowerCase(),
        Number(args.startsAt ?? 0),
        Number(args.endsAt ?? 0),
        Number(args.qrNonce ?? 1),
        log.transactionHash ?? "",
        Number(log.blockNumber ?? 0),
      );
      eventsProcessed += 1;
    }

    for (const log of statusLogs) {
      const args = log.args;
      if (args.sessionId === undefined || args.active === undefined) continue;
      db.prepare("UPDATE indexed_sessions SET active = ? WHERE session_id = ?").run(
        args.active ? 1 : 0,
        args.sessionId.toString(),
      );
      eventsProcessed += 1;
    }

    for (const log of nonceLogs) {
      const args = log.args;
      if (args.sessionId === undefined || args.newNonce === undefined) continue;
      db.prepare("UPDATE indexed_sessions SET qr_nonce = ? WHERE session_id = ?").run(
        Number(args.newNonce),
        args.sessionId.toString(),
      );
      eventsProcessed += 1;
    }

    for (const log of attendanceLogs) {
      const args = log.args;
      if (args.sessionId === undefined || !args.student || !args.instructor) continue;
      db.prepare(
        `INSERT INTO indexed_attendance (session_id, student_address, instructor, recorded_at, tx_hash, block_number)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, student_address) DO NOTHING`,
      ).run(
        args.sessionId.toString(),
        args.student.toLowerCase(),
        args.instructor.toLowerCase(),
        Number(args.recordedAt ?? 0),
        log.transactionHash ?? "",
        Number(log.blockNumber ?? 0),
      );
      eventsProcessed += 1;
    }

    setSyncValue(db, LAST_BLOCK_KEY, chunkEnd.toString());
    cursor = chunkEnd + BigInt(1);
  }

  return {
    fromBlock: (saved !== null ? BigInt(saved) + BigInt(1) : defaultStartBlock).toString(),
    toBlock: latestBlock.toString(),
    eventsProcessed,
  };
}
