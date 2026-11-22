"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
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
import { parseAttendanceQrPayload } from "../lib/qr/attendance-payload";

const SCANNER_TX_SCOPE = "student-attendance";

export function StudentAttendanceScanner() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerOpRef = useRef<"idle" | "starting" | "stopping">("idle");
  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);
  const activeAddressRef = useRef(address);

  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  const [rawQr, setRawQr] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  const configuredAddress = studentAttendanceAddress;
  const contractConfigured = isStudentAttendanceConfigured;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) {
        void scanner.stop().then(() => scanner.clear()).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (!publicClient || !address || chainId !== sepolia.id || !contractConfigured) return;
    const pending = loadPendingTransaction(SCANNER_TX_SCOPE);
    if (!pending || pending.address.toLowerCase() !== address.toLowerCase()) return;

    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setTransactionHash(pending.hash);
      setStatus("Recovering pending attendance transaction from Sepolia…");
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: pending.hash });
        if (cancelled) return;
        clearPendingTransaction(SCANNER_TX_SCOPE);
        assertSuccessfulReceipt(receipt, "Recovered transaction reverted on-chain. Attendance was not recorded.");
        setStatus("Recovered attendance transaction confirmed on Sepolia.");
      } catch (recoveryError) {
        if (cancelled) return;
        clearPendingTransaction(SCANNER_TX_SCOPE);
        setStatus("");
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "Could not confirm pending attendance transaction. Check Sepolia Etherscan.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, chainId, contractConfigured, publicClient]);

  async function stopScanner() {
    if (scannerOpRef.current === "stopping") return;
    const scanner = scannerRef.current;
    if (!scanner) {
      scannerOpRef.current = "idle";
      setCameraActive(false);
      return;
    }
    scannerOpRef.current = "stopping";
    try {
      if (scanner.isScanning) await scanner.stop();
      await scanner.clear();
    } catch {
      // Camera may already have stopped after a successful scan.
    } finally {
      scannerRef.current = null;
      scannerOpRef.current = "idle";
      if (mountedRef.current) setCameraActive(false);
    }
  }

  async function startScanner() {
    if (scannerOpRef.current !== "idle" || scannerRef.current) return;
    scannerOpRef.current = "starting";
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
      if (!mountedRef.current || scannerOpRef.current !== "starting") {
        if (scanner.isScanning) await scanner.stop().catch(() => undefined);
        await Promise.resolve(scanner.clear()).catch(() => undefined);
        scannerRef.current = null;
        return;
      }
      scannerOpRef.current = "idle";
      setCameraActive(true);
    } catch (cameraError) {
      scannerRef.current = null;
      scannerOpRef.current = "idle";
      if (mountedRef.current) {
        setCameraActive(false);
        setError(cameraError instanceof Error ? cameraError.message : "Camera could not start. Paste the QR payload instead.");
      }
    }
  }

  async function submitAttendance() {
    if (isSubmittingRef.current) return;
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

    const submittingAddress = address;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

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
          args: [submittingAddress],
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
          args: [sessionId, submittingAddress],
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

      if (activeAddressRef.current?.toLowerCase() !== submittingAddress.toLowerCase()) {
        throw new Error("Connected wallet changed during pre-checks. Review your account and retry.");
      }

      setStatus("Pre-checks passed. Confirm the attendance transaction in your wallet.");
      const hash = await writeContractAsync({
        address: configuredAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "markAttendance",
        args: [sessionId, expiresAt, qrNonce, payload.signature],
      });
      setTransactionHash(hash);
      savePendingTransaction(SCANNER_TX_SCOPE, {
        hash,
        address: submittingAddress,
        label: `Attendance for session #${payload.sessionId}`,
        createdAt: Date.now(),
      });
      setStatus("Transaction submitted. Waiting for Sepolia confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      clearPendingTransaction(SCANNER_TX_SCOPE);
      assertSuccessfulReceipt(receipt, "Transaction reverted on-chain. Attendance was not recorded.");
      if (activeAddressRef.current?.toLowerCase() !== submittingAddress.toLowerCase()) {
        setStatus("");
        setError("Wallet changed while the transaction was confirming. Verify attendance for the original wallet on Etherscan.");
        return;
      }
      setStatus("Attendance confirmed on Sepolia.");
      setRawQr("");
    } catch (submissionError) {
      setStatus("");
      setError(submissionError instanceof Error ? submissionError.message : "Attendance submission failed.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
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
        <button className="primary-action" onClick={submitAttendance} disabled={!contractConfigured || !rawQr.trim() || !isConnected || isPending || isSubmitting}>
          {isPending ? "Confirm in wallet…" : isSubmitting ? "Confirming on Sepolia…" : "Submit attendance"}
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
