"use client";

import { useRef, useState } from "react";
import { isAddress } from "viem";
import { Html5Qrcode } from "html5-qrcode";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { sepolia } from "wagmi/chains";
import { studentAttendanceAbi } from "../lib/contract/abi";
import { parseAttendanceQrPayload } from "../lib/qr/attendance-payload";

export function StudentAttendanceScanner() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [rawQr, setRawQr] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  const configuredAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  const contractConfigured = Boolean(configuredAddress && isAddress(configuredAddress));

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      await scanner.clear();
    } catch {
      // Camera may already have stopped after a successful scan.
    } finally {
      scannerRef.current = null;
      setCameraActive(false);
    }
  }

  async function startScanner() {
    setError("");
    setStatus("");
    try {
      const scanner = new Html5Qrcode("attendance-qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          setRawQr(decodedText);
          void stopScanner();
          setStatus("QR captured. Review and submit your attendance.");
        },
        () => undefined,
      );
      setCameraActive(true);
    } catch (cameraError) {
      scannerRef.current = null;
      setCameraActive(false);
      setError(cameraError instanceof Error ? cameraError.message : "Camera could not start. Paste the QR payload instead.");
    }
  }

  async function submitAttendance() {
    setError("");
    setStatus("");
    setTransactionHash("");

    if (!isConnected || !address) {
      setError("Connect your student wallet first.");
      return;
    }
    if (chainId !== sepolia.id) {
      setError("Switch your wallet to Ethereum Sepolia.");
      return;
    }
    if (!publicClient || !contractConfigured || !configuredAddress) {
      setError("The Sepolia contract address is not configured yet.");
      return;
    }

    try {
      const payload = parseAttendanceQrPayload(rawQr.trim());
      if (payload.contractAddress.toLowerCase() !== configuredAddress.toLowerCase()) {
        throw new Error("This QR belongs to a different contract address.");
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      const sessionId = BigInt(payload.sessionId);
      const qrNonce = BigInt(payload.qrNonce);
      const expiresAt = BigInt(payload.expiresAt);

      if (now > expiresAt) throw new Error("This attendance QR has expired.");

      const [registered, session, alreadyAttended] = await Promise.all([
        publicClient.readContract({
          address: configuredAddress as `0x${string}`,
          abi: studentAttendanceAbi,
          functionName: "registeredStudents",
          args: [address],
        }),
        publicClient.readContract({
          address: configuredAddress as `0x${string}`,
          abi: studentAttendanceAbi,
          functionName: "sessions",
          args: [sessionId],
        }),
        publicClient.readContract({
          address: configuredAddress as `0x${string}`,
          abi: studentAttendanceAbi,
          functionName: "hasAttended",
          args: [sessionId, address],
        }),
      ]);

      if (!registered) throw new Error("This wallet is not registered as a student.");
      if (alreadyAttended) throw new Error("This wallet has already checked in for this session.");

      const [, startsAt, endsAt, currentNonce, active] = session;
      if (startsAt === BigInt(0)) throw new Error("The attendance session does not exist.");
      if (!active) throw new Error("The attendance session is paused.");
      if (now < startsAt || now >= endsAt) throw new Error("The session is not currently accepting attendance.");
      if (expiresAt > endsAt) throw new Error("The QR expiry exceeds the session end time.");
      if (qrNonce !== currentNonce) throw new Error("This QR has been invalidated. Ask the instructor for a new one.");

      setStatus("Pre-checks passed. Confirm the attendance transaction in your wallet.");
      const hash = await writeContractAsync({
        address: configuredAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "markAttendance",
        args: [sessionId, expiresAt, qrNonce, payload.signature],
      });
      setTransactionHash(hash);
      setStatus("Transaction submitted. Waiting for Sepolia confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Attendance confirmed on Sepolia.");
      setRawQr("");
    } catch (submissionError) {
      setStatus("");
      setError(submissionError instanceof Error ? submissionError.message : "Attendance submission failed.");
    }
  }

  return (
    <section className="integration-panel scanner-panel" aria-labelledby="scanner-heading">
      <div>
        <p className="panel-label">STUDENT TOOL · QR CHECK-IN</p>
        <h2 id="scanner-heading">Scan and record attendance</h2>
        <p className="muted">
          Connect the wallet registered by your instructor, scan the live session QR,
          then confirm the transaction. Camera access starts only when you tap the button.
        </p>
        {!contractConfigured && (
          <p className="notice-message">Student check-in is disabled until NEXT_PUBLIC_CONTRACT_ADDRESS is configured after Sepolia deployment.</p>
        )}
      </div>

      <div className="scanner-controls">
        <div id="attendance-qr-reader" className="qr-reader" aria-label="QR camera scanner" />
        <div className="scanner-actions">
          {!cameraActive ? (
            <button className="secondary-action" onClick={startScanner} disabled={!contractConfigured}>Open camera scanner</button>
          ) : (
            <button className="secondary-action" onClick={() => void stopScanner()}>Stop camera</button>
          )}
        </div>
        <label className="payload-label" htmlFor="attendance-qr-payload">Or paste the QR payload</label>
        <textarea
          id="attendance-qr-payload"
          rows={4}
          value={rawQr}
          onChange={(event) => setRawQr(event.target.value)}
          placeholder="Paste the complete signed attendance QR payload"
        />
        <button className="primary-action" onClick={submitAttendance} disabled={!contractConfigured || !rawQr.trim() || !isConnected || isPending}>
          {isPending ? "Confirm in wallet…" : "Submit attendance"}
        </button>
        {status && <p className="status-message" role="status">{status}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {transactionHash && (
          <a className="explorer-link" href={`https://sepolia.etherscan.io/tx/${transactionHash}`} target="_blank" rel="noreferrer">
            View transaction on Sepolia Etherscan
          </a>
        )}
      </div>
      <p className="notice-message scanner-disclaimer">
        A QR code can be photographed or shared. QR scanning alone does not prove physical presence.
        The contract remains authoritative and rejects invalid or duplicate check-ins.
      </p>
    </section>
  );
}
