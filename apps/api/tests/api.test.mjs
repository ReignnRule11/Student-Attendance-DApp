import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createApiApp } from "../src/app.ts";
import { backupDatabase, openDatabase } from "../src/db.ts";

const INSTRUCTOR_A = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const INSTRUCTOR_B = privateKeyToAccount(
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c864e6f5b9e9b7f5a32a5c3c21",
);
const UNAUTHORIZED_ACCOUNT = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const STUDENT_ADDR = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

function setupTestApi(options = {}) {
  const db = openDatabase(":memory:");
  const config = {
    port: 4000,
    corsOrigin: "http://localhost:3000",
    databasePath: ":memory:",
    sepoliaRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    contractAddress: "0x66d5E20AFEA78C97BefC47FaCd462D93b888C703",
    authSecret: "test-secret-for-unit-suite",
    enableIndexer: false,
    indexerIntervalMs: 30_000,
    startBlock: 0n,
  };

  const app = createApiApp({
    db,
    config,
    resolveRole: async (addr) => {
      const lower = addr.toLowerCase();
      if (lower === INSTRUCTOR_A.address.toLowerCase()) return "instructor";
      if (lower === INSTRUCTOR_B.address.toLowerCase()) return "instructor";
      return null;
    },
    triggerSync:
      options.triggerSync ??
      (async () => ({ fromBlock: "0", toBlock: "10", eventsProcessed: 0 })),
    rateLimits: options.rateLimits,
  });

  return { app, db };
}

async function signInAs(app, account) {
  const nonceRes = await app.request("/api/auth/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.address }),
  });
  assert.equal(nonceRes.status, 200);
  const { message } = await nonceRes.json();
  const signature = await account.signMessage({ message });

  const verifyRes = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.address, signature }),
  });
  assert.equal(verifyRes.status, 200);
  const body = await verifyRes.json();
  return { token: body.token, message, signature };
}

describe("Student Attendance API", () => {
  it("exposes health metadata", async () => {
    const { app } = setupTestApi();
    const res = await app.request("/health");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.equal(data.chainId, 11155111);
  });

  it("enforces wallet-signed auth, rejects replay, and rejects unauthorized wallets", async () => {
    const { app } = setupTestApi();

    const unauthRes = await app.request("/api/roster");
    assert.equal(unauthRes.status, 401);

    const { signature } = await signInAs(app, INSTRUCTOR_A);

    const replayRes = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: INSTRUCTOR_A.address, signature }),
    });
    assert.equal(replayRes.status, 401);

    const n2 = await app.request("/api/auth/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: UNAUTHORIZED_ACCOUNT.address }),
    });
    const { message: m2 } = await n2.json();
    const s2 = await UNAUTHORIZED_ACCOUNT.signMessage({ message: m2 });
    const v2 = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: UNAUTHORIZED_ACCOUNT.address, signature: s2 }),
    });
    assert.equal(v2.status, 401);
  });

  it("validates roster fields and isolates rows between instructors", async () => {
    const { app, db } = setupTestApi();
    const { token: tokenA } = await signInAs(app, INSTRUCTOR_A);
    const { token: tokenB } = await signInAs(app, INSTRUCTOR_B);
    const headersA = { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" };
    const headersB = { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" };

    const badEmailRes = await app.request(`/api/roster/${STUDENT_ADDR}`, {
      method: "PUT",
      headers: headersA,
      body: JSON.stringify({ fullName: "Ada", email: "not-an-email" }),
    });
    assert.equal(badEmailRes.status, 400);

    const putRes = await app.request(`/api/roster/${STUDENT_ADDR}`, {
      method: "PUT",
      headers: headersA,
      body: JSON.stringify({
        fullName: "=Ada Lovelace",
        email: "ada@example.edu",
        matricNo: "CSC/2026/001",
      }),
    });
    assert.equal(putRes.status, 200);

    // Instructor B cannot overwrite or delete Instructor A's student record.
    const hijackRes = await app.request(`/api/roster/${STUDENT_ADDR}`, {
      method: "PUT",
      headers: headersB,
      body: JSON.stringify({ fullName: "Hijacked" }),
    });
    assert.equal(hijackRes.status, 403);

    const delHijackRes = await app.request(`/api/roster/${STUDENT_ADDR}`, {
      method: "DELETE",
      headers: headersB,
    });
    assert.equal(delHijackRes.status, 403);

    // Seed indexed session owned by Instructor A.
    db.prepare(
      `INSERT INTO indexed_sessions (session_id, instructor, starts_at, ends_at, qr_nonce, active, tx_hash, block_number)
       VALUES ('1', ?, 1700000000, 1700003600, 1, 1, '0xtx1', 100)`,
    ).run(INSTRUCTOR_A.address.toLowerCase());
    db.prepare(
      `INSERT INTO indexed_attendance (session_id, student_address, instructor, recorded_at, tx_hash, block_number)
       VALUES ('1', ?, ?, 1700000500, '0xtx2', 101)`,
    ).run(STUDENT_ADDR.toLowerCase(), INSTRUCTOR_A.address.toLowerCase());

    // Instructor B cannot see or export Instructor A's session.
    const sessionsB = await app.request("/api/sessions", { headers: headersB });
    assert.equal((await sessionsB.json()).sessions.length, 0);

    const exportB = await app.request("/api/sessions/1/export.csv", { headers: headersB });
    assert.equal(exportB.status, 403);

    const csvRes = await app.request("/api/sessions/1/export.csv", { headers: headersA });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.match(csvText, /"'=Ada Lovelace"/);
    assert.match(csvText, /CSC\/2026\/001/);
  });

  it("enforces rate limits on auth and sync endpoints and hides internal error details", async () => {
    const { app } = setupTestApi({
      rateLimits: { authMax: 2, syncMax: 1, windowMs: 60_000 },
      triggerSync: async () => {
        throw new Error("internal RPC secret detail should not leak");
      },
    });

    const r1 = await app.request("/api/auth/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: INSTRUCTOR_A.address }),
    });
    assert.equal(r1.status, 200);
    const { message } = await r1.json();
    const signature = await INSTRUCTOR_A.signMessage({ message });

    const r2 = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: INSTRUCTOR_A.address, signature }),
    });
    assert.equal(r2.status, 200);
    const { token } = await r2.json();

    // 3rd auth call within window must be rate-limited (429).
    const r3 = await app.request("/api/auth/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: INSTRUCTOR_A.address }),
    });
    assert.equal(r3.status, 429);

    // Sync error must not leak internal message, and 2nd sync must hit rate limit.
    const s1 = await app.request("/api/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(s1.status, 502);
    const s1Body = await s1.json();
    assert.equal(s1Body.error, "Sepolia sync failed.");

    const s2 = await app.request("/api/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(s2.status, 429);
  });

  it("creates a consistent SQLite hot backup and restores data from it", () => {
    const dir = mkdtempSync(join(tmpdir(), "attendance-backup-"));
    try {
      const db = openDatabase(":memory:");
      db.prepare(
        `INSERT INTO students (wallet_address, full_name, email, matric_no, created_by, updated_at)
         VALUES ('0x1234', 'Grace Hopper', 'grace@example.edu', 'CSC-01', '0xadmin', 1700000000)`,
      ).run();

      const backupPath = join(dir, "backup.db");
      backupDatabase(db, backupPath);
      db.close();

      const restored = openDatabase(backupPath);
      const row = restored
        .prepare("SELECT full_name, matric_no FROM students WHERE wallet_address = '0x1234'")
        .get();
      restored.close();

      assert.equal(row.full_name, "Grace Hopper");
      assert.equal(row.matric_no, "CSC-01");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
