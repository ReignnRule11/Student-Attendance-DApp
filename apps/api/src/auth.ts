import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { verifyMessage, type Address } from "viem";

export type AuthRole = "admin" | "instructor";

export type AuthTokenPayload = {
  sub: string;
  role: AuthRole;
  exp: number;
};

const NONCE_TTL_SECONDS = 300;
const TOKEN_TTL_SECONDS = 3600 * 12;

export function buildChallengeMessage(address: string, nonce: string): string {
  return [
    "Student Attendance DApp — Instructor Sign-In",
    `Wallet: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    "Chain: Ethereum Sepolia (11155111)",
  ].join("\n");
}

export function issueNonce(db: DatabaseSync, address: Address): {
  nonce: string;
  message: string;
  expiresAt: number;
} {
  const normalized = address.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + NONCE_TTL_SECONDS;

  db.prepare(
    `INSERT INTO auth_nonces (address, nonce, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       nonce = excluded.nonce,
       expires_at = excluded.expires_at`,
  ).run(normalized, nonce, expiresAt);

  return {
    nonce,
    message: buildChallengeMessage(normalized, nonce),
    expiresAt,
  };
}

export function signAuthToken(
  payload: AuthTokenPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAuthToken(
  token: string,
  secret: string,
): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as AuthTokenPayload;
    if (
      typeof parsed.sub !== "string" ||
      (parsed.role !== "admin" && parsed.role !== "instructor") ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function verifyWalletSignIn(params: {
  db: DatabaseSync;
  address: Address;
  signature: `0x${string}`;
  secret: string;
  resolveRole: (address: Address) => Promise<AuthRole | null>;
}): Promise<{ token: string; address: string; role: AuthRole; expiresAt: number }> {
  const normalized = params.address.toLowerCase();
  const row = params.db
    .prepare("SELECT nonce, expires_at FROM auth_nonces WHERE address = ?")
    .get(normalized) as { nonce: string; expires_at: number } | undefined;

  if (!row) {
    throw new Error("No active sign-in nonce for this wallet. Request a new nonce.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) {
    params.db.prepare("DELETE FROM auth_nonces WHERE address = ?").run(normalized);
    throw new Error("Sign-in nonce expired. Request a new nonce.");
  }

  const message = buildChallengeMessage(normalized, row.nonce);
  const valid = await verifyMessage({
    address: params.address,
    message,
    signature: params.signature,
  });

  if (!valid) {
    throw new Error("Invalid wallet signature.");
  }

  // Consume nonce after successful verification to prevent replay.
  params.db.prepare("DELETE FROM auth_nonces WHERE address = ?").run(normalized);

  const role = await params.resolveRole(params.address);
  if (!role) {
    throw new Error("Wallet is not an authorized instructor or admin on-chain.");
  }

  const expiresAt = now + TOKEN_TTL_SECONDS;
  const token = signAuthToken({ sub: normalized, role, exp: expiresAt }, params.secret);
  return { token, address: normalized, role, expiresAt };
}
