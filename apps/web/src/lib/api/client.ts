export type BackendAuthSession = {
  token: string;
  address: string;
  role: "admin" | "instructor";
  expiresAt: number;
};

export type RosterStudent = {
  walletAddress: string;
  fullName: string;
  email: string | null;
  matricNo: string | null;
  createdBy: string;
  updatedAt: number;
};

export type IndexedSessionSummary = {
  sessionId: string;
  instructor: string;
  startsAt: number;
  endsAt: number;
  qrNonce: number;
  active: boolean;
  attendanceCount: number;
};

export type AttendanceReportRow = {
  sessionId: string;
  studentAddress: string;
  recordedAt: number;
  txHash: string;
  fullName: string | null;
  email: string | null;
  matricNo: string | null;
};

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
export const apiBaseUrl = rawApiUrl.replace(/\/+$/, "");
export const isBackendConfigured = Boolean(apiBaseUrl);

const TOKEN_PREFIX = "student-attendance-api-token:";

export function loadSavedApiSession(address: string): BackendAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${TOKEN_PREFIX}${address.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackendAuthSession>;
    if (
      typeof parsed.token === "string" &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Math.floor(Date.now() / 1000)
    ) {
      return parsed as BackendAuthSession;
    }
    window.sessionStorage.removeItem(`${TOKEN_PREFIX}${address.toLowerCase()}`);
    return null;
  } catch {
    return null;
  }
}

export function saveApiSession(session: BackendAuthSession): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${TOKEN_PREFIX}${session.address.toLowerCase()}`,
      JSON.stringify(session),
    );
  } catch {
    // Ignore storage quota errors.
  }
}

export function clearApiSession(address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${TOKEN_PREFIX}${address.toLowerCase()}`);
  } catch {
    // Ignore storage errors.
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function requestAuthNonce(address: string) {
  return apiRequest<{ nonce: string; message: string; expiresAt: number }>(
    "/api/auth/nonce",
    { method: "POST", body: JSON.stringify({ address }) },
  );
}

export async function verifyAuthSignature(address: string, signature: `0x${string}`) {
  return apiRequest<BackendAuthSession>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ address, signature }),
  });
}

export async function fetchRoster(token: string) {
  return apiRequest<{ students: RosterStudent[] }>("/api/roster", {}, token);
}

export async function upsertRosterStudent(
  token: string,
  walletAddress: string,
  profile: { fullName: string; email?: string; matricNo?: string },
) {
  return apiRequest<{ student: RosterStudent }>(
    `/api/roster/${walletAddress}`,
    { method: "PUT", body: JSON.stringify(profile) },
    token,
  );
}

export async function fetchIndexedSessions(token: string) {
  return apiRequest<{ sessions: IndexedSessionSummary[] }>("/api/sessions", {}, token);
}

export async function fetchSessionAttendance(token: string, sessionId: string) {
  return apiRequest<{ sessionId: string; attendance: AttendanceReportRow[] }>(
    `/api/sessions/${sessionId}/attendance`,
    {},
    token,
  );
}

export async function triggerBackendSync(token: string) {
  return apiRequest<{ fromBlock: string; toBlock: string; eventsProcessed: number }>(
    "/api/sync",
    { method: "POST" },
    token,
  );
}

export async function downloadSessionCsv(token: string, sessionId: string): Promise<void> {
  if (!apiBaseUrl) throw new Error("Backend API URL is not configured.");
  const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/export.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`CSV export failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `session-${sessionId}-attendance.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
