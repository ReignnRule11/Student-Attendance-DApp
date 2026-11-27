import { randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";

export type ApiConfig = {
  port: number;
  corsOrigin: string;
  databasePath: string;
  sepoliaRpcUrl: string;
  contractAddress: Address;
  authSecret: string;
  enableIndexer: boolean;
  indexerIntervalMs: number;
  startBlock: bigint;
};

export function loadConfig(): ApiConfig {
  const rawContract =
    process.env.CONTRACT_ADDRESS?.trim() ||
    "0x66d5E20AFEA78C97BefC47FaCd462D93b888C703";

  if (!isAddress(rawContract)) {
    throw new Error(`Invalid CONTRACT_ADDRESS: ${rawContract}`);
  }

  const authSecret =
    process.env.AUTH_SECRET?.trim() || randomBytes(32).toString("hex");

  return {
    port: Number(process.env.PORT || 4000),
    corsOrigin: process.env.CORS_ORIGIN?.trim() || "http://localhost:3000",
    databasePath: process.env.DATABASE_PATH?.trim() || "./data/attendance.db",
    sepoliaRpcUrl:
      process.env.SEPOLIA_RPC_URL?.trim() ||
      "https://ethereum-sepolia-rpc.publicnode.com",
    contractAddress: getAddress(rawContract),
    authSecret,
    enableIndexer: process.env.ENABLE_INDEXER !== "false",
    indexerIntervalMs: Number(process.env.INDEXER_INTERVAL_MS || 30_000),
    startBlock: BigInt(process.env.INDEXER_START_BLOCK || "0"),
  };
}
