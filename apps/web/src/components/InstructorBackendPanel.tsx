"use client";

import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import {
  clearApiSession,
  downloadSessionCsv,
  fetchIndexedSessions,
  fetchRoster,
  fetchSessionAttendance,
  isBackendConfigured,
  loadSavedApiSession,
  requestAuthNonce,
  saveApiSession,
  triggerBackendSync,
  upsertRosterStudent,
  verifyAuthSignature,
  type AttendanceReportRow,
  type BackendAuthSession,
  type IndexedSessionSummary,
  type RosterStudent,
} from "../lib/api/client";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function InstructorBackendPanel({
  canUseInstructorTools,
}: {
  canUseInstructorTools: boolean;
}) {
  const { address } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [authSession, setAuthSession] = useState<BackendAuthSession | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [sessions, setSessions] = useState<IndexedSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceReportRow[]>([]);

  const [studentWallet, setStudentWallet] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [matricNo, setMatricNo] = useState("");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const loadBackendData = useCallback(async (token: string) => {
    const [rosterRes, sessionsRes] = await Promise.all([
      fetchRoster(token),
      fetchIndexedSessions(token),
    ]);
    setRoster(rosterRes.students);
    setSessions(sessionsRes.sessions);
  }, []);

  useEffect(() => {
    if (!address || !isBackendConfigured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthSession(null);
      return;
    }
    const saved = loadSavedApiSession(address);
    setAuthSession(saved);
    if (saved) {
      void loadBackendData(saved.token).catch(() => undefined);
    }
  }, [address, loadBackendData]);

  if (!isBackendConfigured) {
    return null;
  }

  async function handleSignIn() {
    if (!address) return;
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const { message } = await requestAuthNonce(address);
      const signature = await signMessageAsync({ message });
      const verified = await verifyAuthSignature(address, signature);
      saveApiSession(verified);
      setAuthSession(verified);
      await loadBackendData(verified.token);
      setStatus(`Signed in to backend (${verified.role}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveStudent() {
    if (!authSession) return;
    if (!isAddress(studentWallet)) {
      setError("Enter a valid student wallet address.");
      return;
    }
    if (!fullName.trim()) {
      setError("Student full name is required.");
      return;
    }
    setError("");
    setStatus("");
    setBusy(true);
    try {
      await upsertRosterStudent(authSession.token, studentWallet, {
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        matricNo: matricNo.trim() || undefined,
      });
      await loadBackendData(authSession.token);
      setStudentWallet("");
      setFullName("");
      setEmail("");
      setMatricNo("");
      setStatus("Off-chain student profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save student profile.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncAndRefresh() {
    if (!authSession) return;
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const syncResult = await triggerBackendSync(authSession.token);
      await loadBackendData(authSession.token);
      setStatus(`Synced blocks ${syncResult.fromBlock}–${syncResult.toBlock} (${syncResult.eventsProcessed} events).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleViewSession(sessionId: string) {
    if (!authSession) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetchSessionAttendance(authSession.token, sessionId);
      setSelectedSessionId(sessionId);
      setAttendanceRows(res.attendance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load session attendance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="dashboard-card backend-panel">
      <div className="card-header">
        <p className="panel-label">OFF-CHAIN ROSTER & REPORTS</p>
        <h3>Instructor directory & CSV export</h3>
        <p className="muted">
          Map student wallets to names/matric numbers off-chain and export indexed Sepolia attendance sheets.
        </p>
      </div>

      {!authSession ? (
        <div className="dashboard-actions">
          <button
            type="button"
            className="primary-action"
            onClick={() => void handleSignIn()}
            disabled={!canUseInstructorTools || busy || isSigning}
          >
            {isSigning ? "Sign in wallet…" : busy ? "Verifying…" : "Sign in to Instructor API"}
          </button>
        </div>
      ) : (
        <>
          <div className="dashboard-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => void handleSyncAndRefresh()}
              disabled={busy}
            >
              Sync & refresh
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                if (address) clearApiSession(address);
                setAuthSession(null);
              }}
            >
              Sign out API
            </button>
          </div>

          <div className="divider" />

          <div className="signer-fields">
            <label>
              Student wallet
              <input
                value={studentWallet}
                onChange={(e) => setStudentWallet(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
              />
            </label>
            <div className="field-row">
              <label>
                Full name
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                />
              </label>
              <label>
                Matric / ID (optional)
                <input
                  value={matricNo}
                  onChange={(e) => setMatricNo(e.target.value)}
                  placeholder="CSC/2026/001"
                />
              </label>
            </div>
            <label>
              Email (optional)
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ada@example.edu"
              />
            </label>
            <button
              type="button"
              className="primary-action"
              onClick={() => void handleSaveStudent()}
              disabled={busy || !studentWallet || !fullName.trim()}
            >
              Save off-chain profile
            </button>
          </div>

          {roster.length > 0 && (
            <div className="session-details">
              <p><strong>Saved directory ({roster.length}):</strong></p>
              {roster.slice(0, 5).map((s) => (
                <p key={s.walletAddress}>
                  {s.fullName} {s.matricNo ? `(${s.matricNo})` : ""} — <code>{shortAddr(s.walletAddress)}</code>
                </p>
              ))}
            </div>
          )}

          {sessions.length > 0 && (
            <div className="session-details">
              <p><strong>Indexed sessions:</strong></p>
              {sessions.map((s) => (
                <div key={s.sessionId} className="dashboard-actions">
                  <span className="muted">
                    #{s.sessionId} · {s.attendanceCount} check-ins
                  </span>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => void handleViewSession(s.sessionId)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => void downloadSessionCsv(authSession.token, s.sessionId)}
                  >
                    Export CSV
                  </button>
                </div>
              ))}
            </div>
          )}

          {selectedSessionId && (
            <div className="session-details">
              <p><strong>Session #{selectedSessionId} attendees ({attendanceRows.length}):</strong></p>
              {attendanceRows.map((row) => (
                <p key={row.studentAddress}>
                  {row.fullName || shortAddr(row.studentAddress)}
                  {row.matricNo ? ` (${row.matricNo})` : ""} ·{" "}
                  {new Date(row.recordedAt * 1000).toLocaleTimeString()}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {status && <p className="status-message">{status}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </article>
  );
}
