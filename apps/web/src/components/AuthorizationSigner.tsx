"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAccount, useChainId, usePublicClient, useSignTypedData } from "wagmi";
import { studentAttendanceAbi } from "../lib/contract/abi";
import { isStudentAttendanceConfigured, studentAttendanceAddress } from "../lib/contract/deployment";
import { sepolia } from "wagmi/chains";

const attendanceTypes = {
  AttendanceAuthorization: [
    { name: "sessionId", type: "uint256" },
    { name: "qrNonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

type SelectedSession = {
  id: string;
  qrNonce: string;
  endsAt: bigint;
};

const EXPIRY_PRESETS = [
  { label: "5 min", seconds: 5 * 60 },
  { label: "15 min", seconds: 15 * 60 },
  { label: "30 min", seconds: 30 * 60 },
] as const;

function computePresetExpiry(offsetSeconds: number, maxEndsAt?: bigint): string {
  const target = Math.floor(Date.now() / 1000) + offsetSeconds;
  if (maxEndsAt !== undefined && BigInt(target) > maxEndsAt) {
    return maxEndsAt.toString();
  }
  return String(target);
}

export function AuthorizationSigner({
  selectedSession,
}: {
  selectedSession?: SelectedSession | null;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync, isPending, error } = useSignTypedData();
  const [sessionId, setSessionId] = useState(selectedSession?.id || "1");
  const [qrNonce, setQrNonce] = useState(selectedSession?.qrNonce || "1");
  const [expiresAt, setExpiresAt] = useState("");
  const [signature, setSignature] = useState("");
  const [qrPayload, setQrPayload] = useState("");
  const [localError, setLocalError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedSession) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(selectedSession.id);
    setQrNonce(selectedSession.qrNonce);
  }, [selectedSession]);

  const contractAddress = studentAttendanceAddress;
  const validContractAddress = isStudentAttendanceConfigured;
  const canSign = isConnected && chainId === sepolia.id && validContractAddress;

  function applyPreset(offsetSeconds: number) {
    setExpiresAt(computePresetExpiry(offsetSeconds, selectedSession?.endsAt));
    setLocalError("");
  }

  async function handleSign() {
    setSignature("");
    setQrPayload("");
    setLocalError("");
    setCopied(false);
    if (!canSign || !contractAddress) return;

    try {
      if (![sessionId, qrNonce, expiresAt].every((value) => /^\d+$/.test(value.trim()))) {
        throw new Error("Session ID, QR nonce, and expiry must be positive integers.");
      }

      const session = BigInt(sessionId);
      const nonce = BigInt(qrNonce);
      const expiry = BigInt(expiresAt);
      const zero = BigInt(0);
      const maxUint64 = BigInt("18446744073709551615");

      if (session <= zero || nonce <= zero || expiry <= zero || nonce > maxUint64 || expiry > maxUint64) {
        throw new Error("Session ID must be positive; nonce and expiry must fit uint64.");
      }
      if (expiry <= BigInt(Math.floor(Date.now() / 1000))) {
        throw new Error("Expiry must be in the future. Pick a preset or a future timestamp.");
      }

      if (!publicClient || !address) throw new Error("Sepolia RPC is unavailable. Try again.");
      const sessionInfo = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi: studentAttendanceAbi,
        functionName: "sessions",
        args: [session],
      });
      const [sessionInstructor, startsAt, endsAt, currentNonce, active] = sessionInfo;
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (startsAt === BigInt(0)) throw new Error("The selected session does not exist.");
      if (sessionInstructor.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Only the instructor who created this session can authorize its QR.");
      }
      if (!active || now < startsAt || now >= endsAt) {
        throw new Error("The selected session is not currently active.");
      }
      if (nonce !== currentNonce) throw new Error("QR nonce is stale. Refresh it from the current session state.");
      if (expiry > endsAt) throw new Error("QR expiry cannot exceed the session end time.");

      const result = await signTypedDataAsync({
        domain: {
          name: "StudentAttendance",
          version: "1",
          chainId: sepolia.id,
          verifyingContract: contractAddress as `0x${string}`,
        },
        types: attendanceTypes,
        primaryType: "AttendanceAuthorization",
        message: {
          sessionId: session,
          qrNonce: nonce,
          expiresAt: expiry,
        },
      });

      const payload = {
        version: 1,
        chainId: sepolia.id,
        contractAddress,
        sessionId: session.toString(),
        qrNonce: nonce.toString(),
        expiresAt: expiry.toString(),
        signature: result,
      };
      setSignature(result);
      setQrPayload(JSON.stringify(payload));
    } catch (signingError) {
      setSignature("");
      setQrPayload("");
      setLocalError(
        signingError instanceof Error
          ? signingError.message
          : "Signing failed. Check the wallet and try again.",
      );
    }
  }

  const expiryPreview =
    /^\d+$/.test(expiresAt.trim()) && Number(expiresAt) > 0
      ? new Date(Number(expiresAt) * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <article className="dashboard-card signer-card" aria-labelledby="signer-heading">
      <div className="card-header">
        <p className="panel-label">QR AUTHORIZATION</p>
        <h3 id="signer-heading">Generate attendance QR</h3>
        <p className="muted">
          Sign a gas-free authorization for students to scan. Valid for multiple students until expiry or nonce rotation.
        </p>
      </div>

      <div className="signer-fields">
        <div className="field-row">
          <label>
            Session ID
            <input inputMode="numeric" value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
          </label>
          <label>
            QR nonce
            <input inputMode="numeric" value={qrNonce} onChange={(event) => setQrNonce(event.target.value)} />
          </label>
        </div>

        <div className="preset-group">
          <span className="field-label">QR validity</span>
          <div className="preset-row">
            {EXPIRY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="preset-chip"
                onClick={() => applyPreset(preset.seconds)}
              >
                {preset.label}
              </button>
            ))}
            {selectedSession && (
              <button
                type="button"
                className="preset-chip"
                onClick={() => setExpiresAt(selectedSession.endsAt.toString())}
              >
                Session end
              </button>
            )}
          </div>
        </div>

        <label>
          Expiry timestamp {expiryPreview ? `(until ${expiryPreview})` : ""}
          <input
            inputMode="numeric"
            placeholder="Pick a preset above or enter Unix seconds"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
      </div>

      {!validContractAddress && (
        <p className="notice-message">
          Contract address is not configured.
        </p>
      )}
      {isConnected && chainId !== sepolia.id && (
        <p className="notice-message">Switch your wallet to Sepolia before signing.</p>
      )}

      <button
        type="button"
        className="primary-action"
        onClick={handleSign}
        disabled={!canSign || isPending || !expiresAt.trim()}
      >
        {isPending ? "Waiting for wallet…" : "Sign and generate QR"}
      </button>

      {(localError || error?.message) && (
        <p className="error-message" role="alert">
          {localError || error?.message}
        </p>
      )}

      {qrPayload && (
        <div className="qr-result">
          <div className="qr-code-surface">
            <QRCodeSVG value={qrPayload} size={220} level="M" includeMargin />
          </div>
          <div className="qr-result-actions">
            <p className="panel-label">QR READY FOR STUDENTS</p>
            <p className="muted">Display this code on screen. No student PII is included.</p>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                void navigator.clipboard.writeText(qrPayload);
                setCopied(true);
              }}
            >
              {copied ? "Copied payload" : "Copy QR payload"}
            </button>
          </div>
          <details>
            <summary>Signature details</summary>
            <code>{signature}</code>
          </details>
        </div>
      )}
      {!address && <p className="muted">Connect an authorized instructor wallet to sign.</p>}
    </article>
  );
}
