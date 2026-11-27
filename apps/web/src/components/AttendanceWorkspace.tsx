"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeEventLog, isAddress } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { sepolia } from "wagmi/chains";
import { studentAttendanceAbi } from "../lib/contract/abi";
import { isStudentAttendanceConfigured, studentAttendanceAddress } from "../lib/contract/deployment";
import {
  assertSuccessfulReceipt,
  clearPendingTransaction,
  loadPendingTransaction,
  savePendingTransaction,
} from "../lib/contract/transactions";
import { AuthorizationSigner } from "./AuthorizationSigner";
import { InstructorBackendPanel } from "./InstructorBackendPanel";
import { StudentAttendanceScanner } from "./StudentAttendanceScanner";

type WorkspaceTab = "checkin" | "instructor" | "admin";

type SessionView = {
  id: string;
  instructor: `0x${string}`;
  startsAt: bigint;
  endsAt: bigint;
  qrNonce: bigint;
  active: boolean;
};

const DASHBOARD_TX_SCOPE = "role-dashboard";

function dateLabel(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function AttendanceWorkspace() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const isSubmittingRef = useRef(false);
  const activeAddressRef = useRef(address);

  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  const contractAddress = studentAttendanceAddress;
  const configured = isStudentAttendanceConfigured;
  const onSepolia = chainId === sepolia.id;

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("checkin");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const txBusy = isPending || isSubmitting;

  const [adminAddress, setAdminAddress] = useState("");
  const [pendingAdminAddress, setPendingAdminAddress] = useState("");
  const [newAdminAddress, setNewAdminAddress] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isInstructor, setIsInstructor] = useState(false);
  const [isStudent, setIsStudent] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);

  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [studentAddress, setStudentAddress] = useState("");
  const [instructorAddress, setInstructorAddress] = useState("");
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [session, setSession] = useState<SessionView | null>(null);

  const [studentLookupAddress, setStudentLookupAddress] = useState("");
  const [lookupRegistered, setLookupRegistered] = useState<boolean | null>(null);
  const [lookupAttended, setLookupAttended] = useState<boolean | null>(null);

  const [studentSessionId, setStudentSessionId] = useState("");
  const [ownAttendance, setOwnAttendance] = useState<boolean | null>(null);

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [lastTransaction, setLastTransaction] = useState("");

  const loadRoles = useCallback(async () => {
    if (!address || !publicClient || !contractAddress || !configured || !onSepolia) {
      setIsAdmin(false);
      setIsInstructor(false);
      setIsStudent(false);
      return;
    }
    const targetAddress = address;
    setRolesLoading(true);
    try {
      const [admin, pendingAdmin, instructor, student] = await Promise.all([
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "admin" }),
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "pendingAdmin" }),
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "instructors", args: [targetAddress] }),
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "registeredStudents", args: [targetAddress] }),
      ]);
      if (activeAddressRef.current?.toLowerCase() !== targetAddress.toLowerCase()) return;
      setAdminAddress(admin);
      setPendingAdminAddress(pendingAdmin);
      setIsAdmin(admin.toLowerCase() === targetAddress.toLowerCase());
      setIsInstructor(instructor);
      setIsStudent(student);
    } catch (readError) {
      if (activeAddressRef.current?.toLowerCase() !== targetAddress.toLowerCase()) return;
      setError(readError instanceof Error ? readError.message : "Could not load on-chain roles.");
    } finally {
      if (activeAddressRef.current?.toLowerCase() === targetAddress.toLowerCase()) {
        setRolesLoading(false);
      }
    }
  }, [address, publicClient, contractAddress, configured, onSepolia]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    if (!publicClient || !address || !onSepolia || !configured) return;
    const pending = loadPendingTransaction(DASHBOARD_TX_SCOPE);
    if (!pending || pending.address.toLowerCase() !== address.toLowerCase()) return;

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLastTransaction(pending.hash);
      setStatus(`Recovering pending transaction (${pending.label})…`);
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: pending.hash, timeout: 60_000 });
        if (cancelled) return;
        clearPendingTransaction(DASHBOARD_TX_SCOPE);
        assertSuccessfulReceipt(receipt, `Recovered transaction (${pending.label}) reverted on-chain.`);
        setStatus(`Recovered transaction confirmed: ${pending.label}.`);
        await loadRoles();
      } catch (recoveryError) {
        if (cancelled) return;
        // Keep pending state when confirmation is unavailable for later recovery.
        setStatus("Transaction confirmation is still unknown. The pending record was kept for recovery.");
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "Could not confirm pending transaction. Check Sepolia Etherscan.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, configured, loadRoles, onSepolia, publicClient]);

  const loadSession = async (rawId: string) => {
    if (!publicClient || !contractAddress || !configured || !/^[1-9][0-9]*$/.test(rawId)) {
      setError("Enter a valid positive session ID.");
      return;
    }
    setError("");
    setSession(null);
    try {
      const result = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "sessions",
        args: [BigInt(rawId)],
      });
      if (result[0] === "0x0000000000000000000000000000000000000000") {
        throw new Error("No session exists with that ID.");
      }
      setSession({
        id: rawId,
        instructor: result[0],
        startsAt: result[1],
        endsAt: result[2],
        qrNonce: result[3],
        active: result[4],
      });
      setStatus(`Session #${rawId} loaded.`);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not load this session.");
    }
  };

  const sendTransaction = async (
    functionName:
      | "registerStudent"
      | "revokeStudent"
      | "authorizeInstructor"
      | "revokeInstructor"
      | "setSessionActive"
      | "rotateQrNonce"
      | "proposeAdmin"
      | "acceptAdmin",
    args: readonly unknown[],
    successMessage: string,
  ) => {
    if (isSubmittingRef.current) return;
    if (!address || !contractAddress || !configured || !publicClient || !onSepolia) {
      setError("Connect a wallet on Sepolia first.");
      return;
    }
    const submittingAddress = address;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    setStatus("");
    setLastTransaction("");
    try {
      const hash = await writeContractAsync({
        address: contractAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName,
        args,
      } as never);
      setLastTransaction(hash);
      savePendingTransaction(DASHBOARD_TX_SCOPE, {
        hash,
        address: submittingAddress,
        label: functionName,
      });
      setStatus("Transaction submitted. Waiting for Sepolia confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      clearPendingTransaction(DASHBOARD_TX_SCOPE);
      assertSuccessfulReceipt(receipt);
      if (activeAddressRef.current?.toLowerCase() !== submittingAddress.toLowerCase()) {
        setStatus("");
        setError("Wallet changed while the transaction was confirming. Verify the result on Etherscan.");
        return;
      }
      setStatus(successMessage);
      await loadRoles();
      if (sessionIdInput.trim()) await loadSession(sessionIdInput.trim());
    } catch (txError) {
      setStatus("");
      setError(txError instanceof Error ? txError.message : "Transaction failed.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const createSession = async () => {
    if (isSubmittingRef.current) return;
    if (!address || !contractAddress || !publicClient || !configured || !onSepolia) {
      setError("Connect an instructor wallet on Sepolia first.");
      return;
    }
    const startSeconds = Math.floor(new Date(startsAt).getTime() / 1000);
    const endSeconds = Math.floor(new Date(endsAt).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < now || endSeconds <= startSeconds) {
      setError("Choose a future start time and an end time later than the start.");
      return;
    }
    const submittingAddress = address;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    setStatus("");
    setLastTransaction("");
    try {
      const hash = await writeContractAsync({
        account: submittingAddress,
        address: contractAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "createSession",
        args: [BigInt(startSeconds), BigInt(endSeconds)],
      });
      setLastTransaction(hash);
      savePendingTransaction(DASHBOARD_TX_SCOPE, {
        hash,
        address: submittingAddress,
        label: "createSession",
      });
      setStatus("Session transaction submitted. Waiting for confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      clearPendingTransaction(DASHBOARD_TX_SCOPE);
      assertSuccessfulReceipt(receipt, "Session creation transaction reverted on-chain.");
      if (activeAddressRef.current?.toLowerCase() !== submittingAddress.toLowerCase()) {
        setStatus("");
        setError("Wallet changed while creating the session. Verify on Etherscan.");
        return;
      }
      let createdId = "";
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: studentAttendanceAbi, eventName: "SessionCreated", data: log.data, topics: log.topics });
          createdId = decoded.args.sessionId.toString();
          break;
        } catch {
          // Ignore logs emitted by other contracts.
        }
      }
      if (createdId) {
        setSessionIdInput(createdId);
        await loadSession(createdId);
        setStatus(`Session #${createdId} created. You can now generate its QR code.`);
      } else {
        setStatus("Session confirmed. Enter its session ID to inspect it.");
      }
      setStartsAt("");
      setEndsAt("");
    } catch (txError) {
      setStatus("");
      setError(txError instanceof Error ? txError.message : "Session creation failed.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const checkStudent = async () => {
    if (!publicClient || !contractAddress || !configured || !isAddress(studentLookupAddress)) {
      setError("Enter a valid student wallet address.");
      return;
    }
    setError("");
    try {
      const [registered, attended] = await Promise.all([
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "registeredStudents", args: [studentLookupAddress] }),
        sessionIdInput.trim() && /^[1-9][0-9]*$/.test(sessionIdInput.trim())
          ? publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "hasAttended", args: [BigInt(sessionIdInput.trim()), studentLookupAddress] })
          : Promise.resolve(null),
      ]);
      setLookupRegistered(registered);
      setLookupAttended(attended);
      setStatus(attended === null ? "Registration status loaded." : "Registration and attendance status loaded.");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not check this student.");
    }
  };

  const checkOwnAttendance = async () => {
    if (!address || !publicClient || !contractAddress || !configured || !/^[1-9][0-9]*$/.test(studentSessionId)) {
      setError("Enter a valid session ID to check your attendance.");
      return;
    }
    setError("");
    try {
      const attended = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "hasAttended",
        args: [BigInt(studentSessionId), address],
      });
      setOwnAttendance(attended);
      setStatus(`Attendance status for session #${studentSessionId} loaded.`);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not load your attendance status.");
    }
  };

  const canManageSession = Boolean(
    address && session && (isAdmin || session.instructor.toLowerCase() === address.toLowerCase()),
  );
  const isPendingAdmin = Boolean(
    address && pendingAdminAddress.toLowerCase() === address.toLowerCase(),
  );

  return (
    <section className="workspace" aria-label="Attendance workspace">
      <div className="workspace-header">
        <div className="tab-list" role="tablist" aria-label="Role views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "checkin"}
            className={activeTab === "checkin" ? "tab-button tab-active" : "tab-button"}
            onClick={() => setActiveTab("checkin")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <rect x="7" y="7" width="10" height="10" rx="1" />
            </svg>
            <span>Check In</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "instructor"}
            className={activeTab === "instructor" ? "tab-button tab-active" : "tab-button"}
            onClick={() => setActiveTab("instructor")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4" />
              <path d="M8 2v4" />
              <path d="M3 10h18" />
            </svg>
            <span>Instructor</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "admin"}
            className={activeTab === "admin" ? "tab-button tab-active" : "tab-button"}
            onClick={() => setActiveTab("admin")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Admin</span>
          </button>
        </div>

        {isConnected && onSepolia && configured && (
          <div className="role-strip" aria-label="Wallet roles">
            {isAdmin && <span className="role-chip role-active">Admin</span>}
            {isInstructor && <span className="role-chip role-active">Instructor</span>}
            {isStudent && <span className="role-chip role-active">Student</span>}
            {!isAdmin && !isInstructor && !isStudent && !rolesLoading && (
              <span className="role-chip">Unregistered wallet</span>
            )}
            {rolesLoading && <span className="muted">Checking roles…</span>}
          </div>
        )}
      </div>

      {!configured && (
        <p className="notice-message">
          Contract address is not configured. Set NEXT_PUBLIC_CONTRACT_ADDRESS to enable on-chain actions.
        </p>
      )}
      {isConnected && !onSepolia && (
        <p className="notice-message">
          Wrong network. Switch your wallet to Ethereum Sepolia in the header.
        </p>
      )}

      {activeTab === "checkin" && (
        <div className="tab-panel" role="tabpanel">
          <StudentAttendanceScanner />

          {isConnected && onSepolia && configured && (
            <article className="dashboard-card">
              <div className="card-header">
                <p className="panel-label">MY RECORDS</p>
                <h3>Verify my attendance</h3>
                <p className="muted">Check if your connected wallet has a confirmed check-in for a session.</p>
              </div>
              <div className="inline-form">
                <input
                  inputMode="numeric"
                  aria-label="Session ID to check"
                  value={studentSessionId}
                  onChange={(event) => setStudentSessionId(event.target.value)}
                  placeholder="Session ID (e.g. 1)"
                />
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => void checkOwnAttendance()}
                  disabled={!studentSessionId.trim()}
                >
                  Check status
                </button>
              </div>
              {ownAttendance !== null && (
                <p className={ownAttendance ? "status-message" : "notice-message"}>
                  Session #{studentSessionId}: {ownAttendance ? "Attendance recorded" : "Not recorded"}
                </p>
              )}
            </article>
          )}
        </div>
      )}

      {activeTab === "instructor" && (
        <div className="tab-panel" role="tabpanel">
          {!isConnected && (
            <p className="notice-message">Connect an authorized instructor wallet to manage sessions and issue QR codes.</p>
          )}
          {isConnected && onSepolia && configured && !isInstructor && !isAdmin && (
            <p className="notice-message">
              Your connected wallet is not authorized as an instructor. Ask the contract admin to authorize it.
            </p>
          )}

          <div className="dashboard-grid">
            <AuthorizationSigner
              selectedSession={
                session
                  ? { id: session.id, qrNonce: session.qrNonce.toString(), endsAt: session.endsAt }
                  : null
              }
            />

            <article className="dashboard-card">
              <div className="card-header">
                <p className="panel-label">SESSIONS</p>
                <h3>Create or load a session</h3>
                <p className="muted">Create a time-bounded class session or load an existing one to pause it or rotate its QR nonce.</p>
              </div>

              <div className="field-row">
                <label>
                  Starts at
                  <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
                </label>
                <label>
                  Ends at
                  <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
                </label>
              </div>
              <button
                type="button"
                className="primary-action"
                onClick={createSession}
                disabled={txBusy || !startsAt || !endsAt || (!isInstructor && !isAdmin)}
              >
                Create session
              </button>

              <div className="divider" />

              <div className="inline-form">
                <input
                  inputMode="numeric"
                  aria-label="Session ID to load"
                  value={sessionIdInput}
                  onChange={(event) => setSessionIdInput(event.target.value)}
                  placeholder="Load session ID (e.g. 1)"
                />
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => void loadSession(sessionIdInput.trim())}
                  disabled={!sessionIdInput.trim()}
                >
                  Load
                </button>
              </div>

              {session && (
                <div className="session-details">
                  <p><strong>Session:</strong> #{session.id} · {session.active ? "Active" : "Paused"}</p>
                  <p><strong>Instructor:</strong> {shortAddress(session.instructor)}</p>
                  <p><strong>Window:</strong> {dateLabel(session.startsAt)} — {dateLabel(session.endsAt)}</p>
                  <p><strong>Current QR nonce:</strong> {session.qrNonce.toString()}</p>
                  {canManageSession && (
                    <div className="dashboard-actions">
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() =>
                          void sendTransaction(
                            "setSessionActive",
                            [BigInt(session.id), !session.active],
                            session.active ? "Session paused." : "Session resumed.",
                          )
                        }
                        disabled={txBusy}
                      >
                        {session.active ? "Pause session" : "Resume session"}
                      </button>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() =>
                          void sendTransaction(
                            "rotateQrNonce",
                            [BigInt(session.id)],
                            "QR nonce rotated. Previous QR codes are now invalid.",
                          )
                        }
                        disabled={txBusy}
                      >
                        Rotate QR nonce
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>

            <article className="dashboard-card">
              <div className="card-header">
                <p className="panel-label">ROSTER</p>
                <h3>Register or revoke student</h3>
                <p className="muted">Only registered student wallets can submit attendance.</p>
              </div>
              <label>
                Student wallet address
                <input
                  value={studentAddress}
                  onChange={(event) => setStudentAddress(event.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                />
              </label>
              <div className="dashboard-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() =>
                    isAddress(studentAddress)
                      ? void sendTransaction("registerStudent", [studentAddress], "Student registered.")
                      : setError("Enter a valid student wallet address.")
                  }
                  disabled={txBusy || !studentAddress || (!isInstructor && !isAdmin)}
                >
                  Register
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() =>
                    isAddress(studentAddress)
                      ? void sendTransaction("revokeStudent", [studentAddress], "Student revoked.")
                      : setError("Enter a valid student wallet address.")
                  }
                  disabled={txBusy || !studentAddress || (!isInstructor && !isAdmin)}
                >
                  Revoke
                </button>
              </div>
            </article>

            <article className="dashboard-card">
              <div className="card-header">
                <p className="panel-label">LOOKUP</p>
                <h3>Check student eligibility</h3>
                <p className="muted">Verify registration and (if a session is loaded) whether they checked in.</p>
              </div>
              <div className="inline-form">
                <input
                  value={studentLookupAddress}
                  onChange={(event) => setStudentLookupAddress(event.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  aria-label="Student wallet address to lookup"
                />
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => void checkStudent()}
                  disabled={!isAddress(studentLookupAddress)}
                >
                  Check
                </button>
              </div>
              {lookupRegistered !== null && (
                <p className="status-message">Registration: {lookupRegistered ? "Registered" : "Not registered"}</p>
              )}
              {lookupAttended !== null && (
                <p className="status-message">Attendance for #{sessionIdInput}: {lookupAttended ? "Recorded" : "Not recorded"}</p>
              )}
            </article>

            <InstructorBackendPanel
              canUseInstructorTools={Boolean(isConnected && onSepolia && configured && (isInstructor || isAdmin))}
            />
          </div>
        </div>
      )}

      {activeTab === "admin" && (
        <div className="tab-panel" role="tabpanel">
          {!isConnected && (
            <p className="notice-message">Connect the contract administrator wallet to manage instructors and governance.</p>
          )}
          {isConnected && onSepolia && configured && !isAdmin && !isPendingAdmin && (
            <p className="notice-message">
              Your connected wallet is not the contract administrator{adminAddress ? ` (${shortAddress(adminAddress)})` : ""}.
            </p>
          )}

          {isPendingAdmin && (
            <article className="dashboard-card">
              <p className="panel-label">PENDING TRANSFER</p>
              <h3>Accept administrator role</h3>
              <p className="muted">Your wallet has been nominated as the new contract administrator.</p>
              <button
                type="button"
                className="primary-action"
                onClick={() => void sendTransaction("acceptAdmin", [], "Administrator transfer accepted.")}
                disabled={txBusy}
              >
                Accept admin transfer
              </button>
            </article>
          )}

          <div className="dashboard-grid">
            <article className="dashboard-card">
              <div className="card-header">
                <p className="panel-label">INSTRUCTOR ACCESS</p>
                <h3>Authorize or revoke instructor</h3>
                <p className="muted">Revoking an instructor blocks new attendance and management on their sessions.</p>
              </div>
              <label>
                Instructor wallet address
                <input
                  value={instructorAddress}
                  onChange={(event) => setInstructorAddress(event.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                />
              </label>
              <div className="dashboard-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() =>
                    isAddress(instructorAddress)
                      ? void sendTransaction("authorizeInstructor", [instructorAddress], "Instructor authorized.")
                      : setError("Enter a valid instructor wallet address.")
                  }
                  disabled={txBusy || !instructorAddress || !isAdmin}
                >
                  Authorize
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() =>
                    isAddress(instructorAddress)
                      ? void sendTransaction("revokeInstructor", [instructorAddress], "Instructor revoked.")
                      : setError("Enter a valid instructor wallet address.")
                  }
                  disabled={txBusy || !instructorAddress || !isAdmin}
                >
                  Revoke
                </button>
              </div>
            </article>

            <article className="dashboard-card">
              <div className="card-header">
                <p className="panel-label">GOVERNANCE</p>
                <h3>Propose admin transfer</h3>
                <p className="muted">
                  Two-step handover: the nominated wallet must connect and accept before control transfers.
                </p>
              </div>
              <label>
                New administrator wallet
                <input
                  value={newAdminAddress}
                  onChange={(event) => setNewAdminAddress(event.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  isAddress(newAdminAddress)
                    ? void sendTransaction("proposeAdmin", [newAdminAddress], "Administrator transfer proposed.")
                    : setError("Enter a valid administrator wallet address.")
                }
                disabled={txBusy || !newAdminAddress || !isAdmin}
              >
                Propose transfer
              </button>
              {pendingAdminAddress && pendingAdminAddress !== "0x0000000000000000000000000000000000000000" && (
                <p className="notice-message">Pending administrator: {shortAddress(pendingAdminAddress)}</p>
              )}
            </article>
          </div>
        </div>
      )}

      {(status || error) && (
        <div className="dashboard-feedback" aria-live="polite">
          {status && <p className="status-message">{status}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
          {lastTransaction && (
            <a
              className="explorer-link"
              href={`https://sepolia.etherscan.io/tx/${lastTransaction}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction on Sepolia Etherscan
            </a>
          )}
        </div>
      )}
    </section>
  );
}
