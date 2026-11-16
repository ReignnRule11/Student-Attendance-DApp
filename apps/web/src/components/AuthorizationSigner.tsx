"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { isAddress } from "viem";
import { useAccount, useChainId, usePublicClient, useSignTypedData } from "wagmi";
import { studentAttendanceAbi } from "../lib/contract/abi";
import { sepolia } from "wagmi/chains";

const attendanceTypes = {
  AttendanceAuthorization: [
    { name: "sessionId", type: "uint256" },
    { name: "qrNonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export function AuthorizationSigner() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync, isPending, error } = useSignTypedData();
  const [sessionId, setSessionId] = useState("1");
  const [qrNonce, setQrNonce] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [signature, setSignature] = useState("");
  const [qrPayload, setQrPayload] = useState("");
  const [localError, setLocalError] = useState("");

  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  const validContractAddress = Boolean(contractAddress && isAddress(contractAddress));
  const canSign = isConnected && chainId === sepolia.id && validContractAddress;

  async function handleSign() {
    setSignature("");
    setQrPayload("");
    setLocalError("");
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
        throw new Error("Expiry must be a future Unix timestamp.");
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

  return (
    <section className="integration-panel signer-panel" aria-labelledby="signer-heading">
      <div>
        <p className="panel-label">INSTRUCTOR TOOL · EIP-712 + QR</p>
        <h2 id="signer-heading">Create a signed attendance QR</h2>
        <p className="muted">
          Sign the exact fields enforced by the contract, then display the resulting QR
          for students. The same QR can serve multiple students until it expires or its
          nonce is rotated. No transaction is sent by the instructor signing step.
        </p>
      </div>

      <div className="signer-fields">
        <label>
          Session ID
          <input inputMode="numeric" value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
        </label>
        <label>
          QR nonce
          <input inputMode="numeric" value={qrNonce} onChange={(event) => setQrNonce(event.target.value)} />
        </label>
        <label>
          Expiry (Unix seconds)
          <input inputMode="numeric" placeholder="e.g. 1790000000" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
      </div>

      {!validContractAddress && (
        <p className="notice-message">
          Set NEXT_PUBLIC_CONTRACT_ADDRESS to the deployed Sepolia contract address before signing.
        </p>
      )}
      {isConnected && chainId !== sepolia.id && (
        <p className="notice-message">Switch your wallet to Sepolia before signing.</p>
      )}

      <button className="primary-action" onClick={handleSign} disabled={!canSign || isPending || !expiresAt.trim()}>
        {isPending ? "Waiting for wallet…" : "Sign and generate QR"}
      </button>

      {(localError || error?.message) && <p className="error-message" role="alert">{localError || error?.message}</p>}
      {qrPayload && (
        <div className="qr-result">
          <div className="qr-code-surface">
            <QRCodeSVG value={qrPayload} size={240} level="M" includeMargin />
          </div>
          <div>
            <p className="panel-label">SIGNED QR READY</p>
            <p className="muted">Display this code to students. It contains no student names or personal data.</p>
            <button className="secondary-action" onClick={() => navigator.clipboard.writeText(qrPayload)}>
              Copy QR payload
            </button>
          </div>
          <details>
            <summary>View signature</summary>
            <code>{signature}</code>
          </details>
        </div>
      )}
      {!address && <p className="muted">Connect an authorized instructor wallet to enable signing.</p>}
    </section>
  );
}
