import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAddress, isAddress, isHex, type Address } from "viem";
import {
  issueNonce,
  verifyAuthToken,
  verifyWalletSignIn,
  type AuthRole,
  type AuthTokenPayload,
} from "./auth.ts";
import type { ApiConfig } from "./config.ts";
import {
  deleteStudent,
  getIndexedSession,
  getStudent,
  getSyncValue,
  listIndexedSessions,
  listSessionAttendance,
  listStudents,
  upsertStudent,
} from "./db.ts";
import { createRateLimiter } from "./rate-limit.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MATRIC_PATTERN = /^[a-zA-Z0-9/_ -]{1,64}$/;

function escapeCsvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function logEvent(level: "info" | "error", event: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...event });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createApiApp(deps: {
  db: DatabaseSync;
  config: ApiConfig;
  resolveRole: (address: Address) => Promise<AuthRole | null>;
  triggerSync: () => Promise<{ fromBlock: string; toBlock: string; eventsProcessed: number }>;
  rateLimits?: {
    authMax?: number;
    syncMax?: number;
    windowMs?: number;
  };
}) {
  const { db, config, resolveRole, triggerSync, rateLimits } = deps;
  const app = new Hono<{ Variables: { auth: AuthTokenPayload } }>();
  const windowMs = rateLimits?.windowMs ?? 60_000;

  app.onError((err, c) => {
    logEvent("error", {
      msg: "unhandled_api_error",
      method: c.req.method,
      path: c.req.path,
      error: err.message,
    });
    return c.json({ error: "Internal server error." }, 500);
  });

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    logEvent("info", {
      msg: "http_request",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });

  app.use(
    "*",
    cors({
      origin: config.corsOrigin,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      chainId: 11155111,
      contractAddress: config.contractAddress,
      lastSyncedBlock: getSyncValue(db, "last_synced_block"),
    });
  });

  app.use(
    "/api/auth/*",
    createRateLimiter({
      keyPrefix: "auth",
      windowMs,
      maxRequests: rateLimits?.authMax ?? 15,
    }),
  );

  app.post("/api/auth/nonce", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { address?: string } | null;
    if (!body?.address || !isAddress(body.address)) {
      return c.json({ error: "Valid EVM wallet address is required." }, 400);
    }
    const result = issueNonce(db, getAddress(body.address));
    return c.json(result);
  });

  app.post("/api/auth/verify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { address?: string; signature?: string }
      | null;
    if (
      !body?.address ||
      !isAddress(body.address) ||
      !body?.signature ||
      !isHex(body.signature, { strict: true })
    ) {
      return c.json({ error: "Valid address and hex signature are required." }, 400);
    }

    try {
      const session = await verifyWalletSignIn({
        db,
        address: getAddress(body.address),
        signature: body.signature,
        secret: config.authSecret,
        resolveRole,
      });
      return c.json(session);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Authentication failed." },
        401,
      );
    }
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) {
      return next();
    }
    const header = c.req.header("Authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      return c.json({ error: "Missing Bearer token." }, 401);
    }
    const payload = verifyAuthToken(match[1], config.authSecret);
    if (!payload) {
      return c.json({ error: "Invalid or expired token." }, 401);
    }
    c.set("auth", payload);
    return next();
  });

  app.get("/api/roster", (c) => {
    const auth = c.get("auth");
    const students =
      auth.role === "admin" ? listStudents(db) : listStudents(db, auth.sub);
    return c.json({ students });
  });

  app.put("/api/roster/:address", async (c) => {
    const rawAddress = c.req.param("address");
    if (!isAddress(rawAddress)) {
      return c.json({ error: "Invalid student wallet address." }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as
      | { fullName?: unknown; email?: unknown; matricNo?: unknown }
      | null;

    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    if (!fullName || fullName.length > 120) {
      return c.json({ error: "fullName is required (max 120 chars)." }, 400);
    }

    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (email && (email.length > 160 || !EMAIL_PATTERN.test(email))) {
      return c.json({ error: "Invalid email format or length." }, 400);
    }

    const matricNo = typeof body?.matricNo === "string" ? body.matricNo.trim() : "";
    if (matricNo && !MATRIC_PATTERN.test(matricNo)) {
      return c.json({ error: "Invalid matricNo format (max 64 alphanumeric chars)." }, 400);
    }

    const auth = c.get("auth");
    const existing = getStudent(db, rawAddress);
    if (existing && auth.role !== "admin" && existing.createdBy !== auth.sub) {
      return c.json({ error: "Forbidden: student record belongs to another instructor." }, 403);
    }

    const student = upsertStudent(db, {
      walletAddress: getAddress(rawAddress),
      fullName,
      email: email || null,
      matricNo: matricNo || null,
      createdBy: existing?.createdBy ?? auth.sub,
    });
    return c.json({ student });
  });

  app.delete("/api/roster/:address", (c) => {
    const rawAddress = c.req.param("address");
    if (!isAddress(rawAddress)) {
      return c.json({ error: "Invalid student wallet address." }, 400);
    }
    const auth = c.get("auth");
    const existing = getStudent(db, rawAddress);
    if (existing && auth.role !== "admin" && existing.createdBy !== auth.sub) {
      return c.json({ error: "Forbidden: student record belongs to another instructor." }, 403);
    }
    const removed = deleteStudent(db, rawAddress);
    return c.json({ removed });
  });

  app.get("/api/sessions", (c) => {
    const auth = c.get("auth");
    const sessions =
      auth.role === "admin"
        ? listIndexedSessions(db)
        : listIndexedSessions(db, auth.sub);
    return c.json({ sessions });
  });

  app.get("/api/sessions/:id/attendance", (c) => {
    const id = c.req.param("id");
    if (!/^[1-9][0-9]*$/.test(id)) {
      return c.json({ error: "Invalid session ID." }, 400);
    }
    const auth = c.get("auth");
    const session = getIndexedSession(db, id);
    if (session && auth.role !== "admin" && session.instructor !== auth.sub) {
      return c.json({ error: "Forbidden: session belongs to another instructor." }, 403);
    }
    return c.json({ sessionId: id, attendance: listSessionAttendance(db, id) });
  });

  app.get("/api/sessions/:id/export.csv", (c) => {
    const id = c.req.param("id");
    if (!/^[1-9][0-9]*$/.test(id)) {
      return c.json({ error: "Invalid session ID." }, 400);
    }
    const auth = c.get("auth");
    const session = getIndexedSession(db, id);
    if (session && auth.role !== "admin" && session.instructor !== auth.sub) {
      return c.json({ error: "Forbidden: session belongs to another instructor." }, 403);
    }
    const rows = listSessionAttendance(db, id);
    const header = [
      "session_id",
      "student_address",
      "full_name",
      "email",
      "matric_no",
      "recorded_at_iso",
      "tx_hash",
    ].join(",");

    const lines = rows.map((r) =>
      [
        escapeCsvCell(r.sessionId),
        escapeCsvCell(r.studentAddress),
        escapeCsvCell(r.fullName),
        escapeCsvCell(r.email),
        escapeCsvCell(r.matricNo),
        escapeCsvCell(new Date(r.recordedAt * 1000).toISOString()),
        escapeCsvCell(r.txHash),
      ].join(","),
    );

    const csv = [header, ...lines].join("\r\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="session-${id}-attendance.csv"`,
      },
    });
  });

  app.use(
    "/api/sync",
    createRateLimiter({
      keyPrefix: "sync",
      windowMs,
      maxRequests: rateLimits?.syncMax ?? 6,
    }),
  );

  app.post("/api/sync", async (c) => {
    try {
      const result = await triggerSync();
      return c.json(result);
    } catch (err) {
      logEvent("error", {
        msg: "sepolia_sync_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      return c.json({ error: "Sepolia sync failed." }, 502);
    }
  });

  return app;
}
