"use client";

import { useCallback, useEffect, useState } from "react";
import { decodeEventLog, isAddress } from "viem";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { sepolia } from "wagmi/chains";
import { studentAttendanceAbi } from "../lib/contract/abi";
import { isStudentAttendanceConfigured, studentAttendanceAddress } from "../lib/contract/deployment";

type SessionView = {
  instructor: `0x${string}`;
  startsAt: bigint;
  endsAt: bigint;
  qrNonce: bigint;
  active: boolean;
};

function dateLabel(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function RoleDashboard() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const contractAddress = studentAttendanceAddress;
  const configured = isStudentAttendanceConfigured;
  const onSepolia = chainId === sepolia.id;

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
    setRolesLoading(true);
    try {
      const [admin, pendingAdmin, instructor, student] = await Promise.all([
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "admin" }),
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "pendingAdmin" }),
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "instructors", args: [address] }),
        publicClient.readContract({ address: contractAddress as `0x${string}`, abi: studentAttendanceAbi, functionName: "registeredStudents", args: [address] }),
      ]);
      setAdminAddress(admin);
      setPendingAdminAddress(pendingAdmin);
      setIsAdmin(admin.toLowerCase() === address.toLowerCase());
      setIsInstructor(instructor);
      setIsStudent(student);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not load on-chain roles.");
    } finally {
      setRolesLoading(false);
    }
  }, [address, publicClient, contractAddress, configured, onSepolia]);

  useEffect(() => {
    // Load wallet roles from the external Sepolia contract when wallet/network changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles();
  }, [loadRoles]);

  const sendTransaction = async (functionName: "registerStudent" | "revokeStudent" | "authorizeInstructor" | "revokeInstructor" | "setSessionActive" | "rotateQrNonce" | "proposeAdmin" | "acceptAdmin", args: readonly unknown[], successMessage: string) => {
    if (!address || !contractAddress || !configured || !publicClient || !onSepolia) {
      setError("Connect a wallet on Sepolia and configure the deployed contract address.");
      return;
    }
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
      setStatus("Transaction submitted. Waiting for Sepolia confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(successMessage);
      await loadRoles();
      if (sessionIdInput.trim()) await loadSession(sessionIdInput.trim());
    } catch (txError) {
      setStatus("");
      setError(txError instanceof Error ? txError.message : "Transaction failed.");
    }
  };

  const loadSession = async (rawId: string) => {
    if (!publicClient || !contractAddress || !configured || !/^[1-9][0-9]*$/.test(rawId)) {
      setError("Enter a valid positive session ID and ensure the contract is configured.");
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
      setSession({ instructor: result[0], startsAt: result[1], endsAt: result[2], qrNonce: result[3], active: result[4] });
      setStatus("Session loaded from the Sepolia contract.");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not load this session.");
    }
  };

  const createSession = async () => {
    if (!address || !contractAddress || !publicClient || !configured || !onSepolia) {
      setError("Connect an instructor wallet on Sepolia and configure the contract address.");
      return;
    }
    const startSeconds = Math.floor(new Date(startsAt).getTime() / 1000);
    const endSeconds = Math.floor(new Date(endsAt).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < now || endSeconds <= startSeconds) {
      setError("Choose a future start time and an end time later than the start.");
      return;
    }
    setError("");
    setStatus("");
    setLastTransaction("");
    try {
      const hash = await writeContractAsync({
        address: contractAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "createSession",
        args: [BigInt(startSeconds), BigInt(endSeconds)],
      });
      setLastTransaction(hash);
      setStatus("Session transaction submitted. Waiting for confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
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
        setStatus(`Session #${createdId} created and confirmed on Sepolia.`);
      } else {
        setStatus("Session transaction confirmed. Enter its session ID to inspect it.");
      }
      setStartsAt("");
      setEndsAt("");
    } catch (txError) {
      setStatus("");
      setError(txError instanceof Error ? txError.message : "Session creation failed.");
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
      setStatus(attended === null ? "Registration status loaded. Enter a session ID to check attendance." : "Student registration and attendance status loaded.");
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
      setStatus(`Your attendance status for session #${studentSessionId} was loaded from Sepolia.`);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not load your attendance status.");
    }
  };

  const canManageSession = Boolean(address && session && (isAdmin || session.instructor.toLowerCase() === address.toLowerCase()));

  return (
    <section className="dashboard-section" id="dashboard" aria-labelledby="dashboard-heading">
      <div className="section-heading">
        <p className="eyebrow">ROLE-AWARE WORKSPACE</p>
        <h2 id="dashboard-heading">Attendance dashboard</h2>
        <p className="muted">Actions and status are read from or submitted to the configured Sepolia contract.</p>
      </div>

      {!configured && <p className="notice-message dashboard-notice">Dashboard actions are disabled until NEXT_PUBLIC_CONTRACT_ADDRESS points to the deployed StudentAttendance contract.</p>}
      {isConnected && !onSepolia && <p className="notice-message dashboard-notice">Switch your wallet to Ethereum Sepolia to load roles and manage attendance.</p>}
      {!isConnected && <p className="muted">Connect a wallet to view its on-chain role and available tools.</p>}

      {isConnected && onSepolia && configured && (
        <>
          <div className="role-strip">
            <span className={isAdmin ? "role-chip role-active" : "role-chip"}>Admin</span>
            <span className={isInstructor ? "role-chip role-active" : "role-chip"}>Instructor</span>
            <span className={isStudent ? "role-chip role-active" : "role-chip"}>Registered student</span>
            {rolesLoading && <span className="muted">Refreshing roles…</span>}
          </div>
          {isAdmin && adminAddress && <p className="muted">Contract administrator: {shortAddress(adminAddress)}</p>}
          {pendingAdminAddress !== "0x0000000000000000000000000000000000000000" && <p className="notice-message dashboard-notice">Pending administrator: {shortAddress(pendingAdminAddress)}</p>}
          {address && pendingAdminAddress.toLowerCase() === address.toLowerCase() && (
            <article className="dashboard-card">
              <p className="panel-label">ADMIN · TRANSFER ACCEPTANCE</p>
              <h3>Accept administrator role</h3>
              <p className="muted">Accepting transfers administrator authority to this wallet. The previous administrator loses admin privileges.</p>
              <button className="primary-action" onClick={() => void sendTransaction("acceptAdmin", [], "Administrator transfer accepted.")} disabled={isPending}>Accept admin transfer</button>
            </article>
          )}

          {(isInstructor || isAdmin) && (
            <div className="dashboard-grid">
              <article className="dashboard-card">
                <p className="panel-label">INSTRUCTOR · SESSION MANAGEMENT</p>
                <h3>Create an attendance session</h3>
                <label>Starts at<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
                <label>Ends at<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
                <button className="primary-action" onClick={createSession} disabled={isPending || !startsAt || !endsAt}>Create session</button>
              </article>

              <article className="dashboard-card">
                <p className="panel-label">INSTRUCTOR · STUDENT MANAGEMENT</p>
                <h3>Register or revoke a student</h3>
                <label>Student wallet address<input value={studentAddress} onChange={(event) => setStudentAddress(event.target.value)} placeholder="0x…" spellCheck={false} /></label>
                <div className="dashboard-actions">
                  <button className="primary-action" onClick={() => isAddress(studentAddress) ? void sendTransaction("registerStudent", [studentAddress], "Student registered.") : setError("Enter a valid student wallet address.")} disabled={isPending || !studentAddress}>Register</button>
                  <button className="secondary-action" onClick={() => isAddress(studentAddress) ? void sendTransaction("revokeStudent", [studentAddress], "Student registration revoked; historical attendance remains unchanged.") : setError("Enter a valid student wallet address.")} disabled={isPending || !studentAddress}>Revoke</button>
                </div>
              </article>

              <article className="dashboard-card">
                <p className="panel-label">SESSION · INSPECT AND CONTROL</p>
                <h3>Load a session</h3>
                <label>Session ID<input inputMode="numeric" value={sessionIdInput} onChange={(event) => setSessionIdInput(event.target.value)} placeholder="e.g. 1" /></label>
                <button className="secondary-action" onClick={() => void loadSession(sessionIdInput.trim())} disabled={!sessionIdInput.trim()}>Load session</button>
                {session && (
                  <div className="session-details">
                    <p><strong>Session:</strong> #{sessionIdInput}</p>
                    <p><strong>Instructor:</strong> {shortAddress(session.instructor)}</p>
                    <p><strong>Starts:</strong> {dateLabel(session.startsAt)}</p>
                    <p><strong>Ends:</strong> {dateLabel(session.endsAt)}</p>
                    <p><strong>QR nonce:</strong> {session.qrNonce.toString()}</p>
                    <p><strong>Status:</strong> {session.active ? "Active" : "Paused"}</p>
                    {canManageSession && (
                      <div className="dashboard-actions">
                        <button className="secondary-action" onClick={() => void sendTransaction("setSessionActive", [BigInt(sessionIdInput), !session.active], session.active ? "Session paused." : "Session resumed.")} disabled={isPending}>{session.active ? "Pause session" : "Resume session"}</button>
                        <button className="secondary-action" onClick={() => void sendTransaction("rotateQrNonce", [BigInt(sessionIdInput)], "QR nonce rotated. Previously issued QR codes are invalid.")} disabled={isPending}>Rotate QR nonce</button>
                      </div>
                    )}
                  </div>
                )}
              </article>

              <article className="dashboard-card">
                <p className="panel-label">STUDENT · ELIGIBILITY LOOKUP</p>
                <h3>Check a student wallet</h3>
                <label>Wallet address<input value={studentLookupAddress} onChange={(event) => setStudentLookupAddress(event.target.value)} placeholder="0x…" spellCheck={false} /></label>
                <button className="secondary-action" onClick={() => void checkStudent()} disabled={!isAddress(studentLookupAddress)}>Check status</button>
                {lookupRegistered !== null && <p className="status-message">Registration: {lookupRegistered ? "Registered" : "Not registered"}</p>}
                {lookupAttended !== null && <p className="status-message">Attendance for #{sessionIdInput}: {lookupAttended ? "Recorded" : "Not recorded"}</p>}
              </article>

              {isAdmin && (
                <article className="dashboard-card">
                  <p className="panel-label">ADMIN · GOVERNANCE</p>
                  <h3>Propose administrator transfer</h3>
                  <label>New administrator wallet<input value={newAdminAddress} onChange={(event) => setNewAdminAddress(event.target.value)} placeholder="0x…" spellCheck={false} /></label>
                  <button className="secondary-action" onClick={() => isAddress(newAdminAddress) ? void sendTransaction("proposeAdmin", [newAdminAddress], "Administrator transfer proposed. The new wallet must accept it.") : setError("Enter a valid administrator wallet address.")} disabled={isPending || !newAdminAddress}>Propose transfer</button>
                  <p className="notice-message">Two-step transfer: the proposed wallet must connect and accept. Until acceptance, the current administrator remains in control.</p>
                </article>
              )}

              {isAdmin && (
                <article className="dashboard-card">
                  <p className="panel-label">ADMIN · INSTRUCTOR ACCESS</p>
                  <h3>Authorize or revoke an instructor</h3>
                  <label>Instructor wallet address<input value={instructorAddress} onChange={(event) => setInstructorAddress(event.target.value)} placeholder="0x…" spellCheck={false} /></label>
                  <div className="dashboard-actions">
                    <button className="primary-action" onClick={() => isAddress(instructorAddress) ? void sendTransaction("authorizeInstructor", [instructorAddress], "Instructor authorized.") : setError("Enter a valid instructor wallet address.")} disabled={isPending || !instructorAddress}>Authorize</button>
                    <button className="secondary-action" onClick={() => isAddress(instructorAddress) ? void sendTransaction("revokeInstructor", [instructorAddress], "Instructor revoked.") : setError("Enter a valid instructor wallet address.")} disabled={isPending || !instructorAddress}>Revoke</button>
                  </div>
                  <p className="notice-message">The contract administrator cannot revoke its own instructor access. Revoking an instructor blocks new attendance for their sessions and prevents them from managing those sessions; historical attendance remains unchanged.</p>
                </article>
              )}
            </div>
          )}

          {isStudent && (
            <article className="dashboard-card student-summary">
              <p className="panel-label">STUDENT · PERSONAL STATUS</p>
              <h3>Your wallet is registered</h3>
              <p className="muted">Check your own recorded attendance for any session. The result is read directly from the contract.</p>
              <label>Session ID<input inputMode="numeric" value={studentSessionId} onChange={(event) => setStudentSessionId(event.target.value)} placeholder="e.g. 1" /></label>
              <button className="secondary-action" onClick={() => void checkOwnAttendance()} disabled={!studentSessionId.trim()}>Check my attendance</button>
              {ownAttendance !== null && <p className="status-message">Attendance: {ownAttendance ? "Recorded" : "Not recorded"}</p>}
            </article>
          )}

          {!isAdmin && !isInstructor && !isStudent && (
            <p className="notice-message dashboard-notice">This wallet has no role on the configured contract. Ask the contract administrator to authorize it as an instructor or register it as a student.</p>
          )}
        </>
      )}

      {(status || error) && (
        <div className="dashboard-feedback" aria-live="polite">
          {status && <p className="status-message">{status}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
          {lastTransaction && <a className="explorer-link" href={`https://sepolia.etherscan.io/tx/${lastTransaction}`} target="_blank" rel="noreferrer">View latest transaction on Sepolia Etherscan</a>}
        </div>
      )}
    </section>
  );
}
