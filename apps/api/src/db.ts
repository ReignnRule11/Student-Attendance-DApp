import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StudentProfile = {
  walletAddress: string;
  fullName: string;
  email: string | null;
  matricNo: string | null;
  createdBy: string;
  updatedAt: number;
};

export type IndexedSession = {
  sessionId: string;
  instructor: string;
  startsAt: number;
  endsAt: number;
  qrNonce: number;
  active: boolean;
  txHash: string;
  blockNumber: number;
  attendanceCount?: number;
};

export type IndexedAttendanceRow = {
  sessionId: string;
  studentAddress: string;
  instructor: string;
  recordedAt: number;
  txHash: string;
  blockNumber: number;
  fullName: string | null;
  email: string | null;
  matricNo: string | null;
};

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS auth_nonces (
      address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      wallet_address TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT,
      matric_no TEXT,
      created_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexed_sessions (
      session_id TEXT PRIMARY KEY,
      instructor TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      qr_nonce INTEGER NOT NULL,
      active INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indexed_attendance (
      session_id TEXT NOT NULL,
      student_address TEXT NOT NULL,
      instructor TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      PRIMARY KEY (session_id, student_address)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}

export function getSyncValue(db: DatabaseSync, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSyncValue(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getStudent(
  db: DatabaseSync,
  walletAddress: string,
): StudentProfile | null {
  const row = db
    .prepare(
      `SELECT wallet_address, full_name, email, matric_no, created_by, updated_at
       FROM students WHERE wallet_address = ?`,
    )
    .get(walletAddress.toLowerCase()) as
    | {
        wallet_address: string;
        full_name: string;
        email: string | null;
        matric_no: string | null;
        created_by: string;
        updated_at: number;
      }
    | undefined;

  if (!row) return null;
  return {
    walletAddress: row.wallet_address,
    fullName: row.full_name,
    email: row.email,
    matricNo: row.matric_no,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

export function listStudents(db: DatabaseSync, createdBy?: string): StudentProfile[] {
  const rows = (createdBy
    ? db
        .prepare(
          `SELECT wallet_address, full_name, email, matric_no, created_by, updated_at
           FROM students WHERE created_by = ? ORDER BY updated_at DESC`,
        )
        .all(createdBy.toLowerCase())
    : db
        .prepare(
          `SELECT wallet_address, full_name, email, matric_no, created_by, updated_at
           FROM students ORDER BY updated_at DESC`,
        )
        .all()) as Array<{
    wallet_address: string;
    full_name: string;
    email: string | null;
    matric_no: string | null;
    created_by: string;
    updated_at: number;
  }>;

  return rows.map((r) => ({
    walletAddress: r.wallet_address,
    fullName: r.full_name,
    email: r.email,
    matricNo: r.matric_no,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
  }));
}

export function upsertStudent(
  db: DatabaseSync,
  input: {
    walletAddress: string;
    fullName: string;
    email?: string | null;
    matricNo?: string | null;
    createdBy: string;
  },
): StudentProfile {
  const updatedAt = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO students (wallet_address, full_name, email, matric_no, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(wallet_address) DO UPDATE SET
       full_name = excluded.full_name,
       email = excluded.email,
       matric_no = excluded.matric_no,
       created_by = excluded.created_by,
       updated_at = excluded.updated_at`,
  ).run(
    input.walletAddress.toLowerCase(),
    input.fullName,
    input.email ?? null,
    input.matricNo ?? null,
    input.createdBy.toLowerCase(),
    updatedAt,
  );

  return {
    walletAddress: input.walletAddress.toLowerCase(),
    fullName: input.fullName,
    email: input.email ?? null,
    matricNo: input.matricNo ?? null,
    createdBy: input.createdBy.toLowerCase(),
    updatedAt,
  };
}

export function deleteStudent(db: DatabaseSync, walletAddress: string): boolean {
  const result = db
    .prepare("DELETE FROM students WHERE wallet_address = ?")
    .run(walletAddress.toLowerCase());
  return Number(result.changes) > 0;
}

export function getIndexedSession(
  db: DatabaseSync,
  sessionId: string,
): IndexedSession | null {
  const row = db
    .prepare("SELECT * FROM indexed_sessions WHERE session_id = ?")
    .get(sessionId) as
    | {
        session_id: string;
        instructor: string;
        starts_at: number;
        ends_at: number;
        qr_nonce: number;
        active: number;
        tx_hash: string;
        block_number: number;
      }
    | undefined;

  if (!row) return null;
  return {
    sessionId: row.session_id,
    instructor: row.instructor,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    qrNonce: row.qr_nonce,
    active: Boolean(row.active),
    txHash: row.tx_hash,
    blockNumber: row.block_number,
  };
}

export function listIndexedSessions(
  db: DatabaseSync,
  instructor?: string,
): IndexedSession[] {
  const rows = (instructor
    ? db
        .prepare(
          `SELECT s.*, COUNT(a.student_address) AS attendance_count
           FROM indexed_sessions s
           LEFT JOIN indexed_attendance a ON a.session_id = s.session_id
           WHERE s.instructor = ?
           GROUP BY s.session_id
           ORDER BY CAST(s.session_id AS INTEGER) DESC`,
        )
        .all(instructor.toLowerCase())
    : db
        .prepare(
          `SELECT s.*, COUNT(a.student_address) AS attendance_count
           FROM indexed_sessions s
           LEFT JOIN indexed_attendance a ON a.session_id = s.session_id
           GROUP BY s.session_id
           ORDER BY CAST(s.session_id AS INTEGER) DESC`,
        )
        .all()) as Array<{
    session_id: string;
    instructor: string;
    starts_at: number;
    ends_at: number;
    qr_nonce: number;
    active: number;
    tx_hash: string;
    block_number: number;
    attendance_count: number;
  }>;

  return rows.map((r) => ({
    sessionId: r.session_id,
    instructor: r.instructor,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    qrNonce: r.qr_nonce,
    active: Boolean(r.active),
    txHash: r.tx_hash,
    blockNumber: r.block_number,
    attendanceCount: Number(r.attendance_count),
  }));
}

export function backupDatabase(db: DatabaseSync, targetPath: string): void {
  const escaped = targetPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
}

export function listSessionAttendance(
  db: DatabaseSync,
  sessionId: string,
): IndexedAttendanceRow[] {
  const rows = db
    .prepare(
      `SELECT a.session_id, a.student_address, a.instructor, a.recorded_at, a.tx_hash, a.block_number,
              s.full_name, s.email, s.matric_no
       FROM indexed_attendance a
       LEFT JOIN students s ON s.wallet_address = a.student_address
       WHERE a.session_id = ?
       ORDER BY a.recorded_at ASC`,
    )
    .all(sessionId) as Array<{
    session_id: string;
    student_address: string;
    instructor: string;
    recorded_at: number;
    tx_hash: string;
    block_number: number;
    full_name: string | null;
    email: string | null;
    matric_no: string | null;
  }>;

  return rows.map((r) => ({
    sessionId: r.session_id,
    studentAddress: r.student_address,
    instructor: r.instructor,
    recordedAt: r.recorded_at,
    txHash: r.tx_hash,
    blockNumber: r.block_number,
    fullName: r.full_name,
    email: r.email,
    matricNo: r.matric_no,
  }));
}
