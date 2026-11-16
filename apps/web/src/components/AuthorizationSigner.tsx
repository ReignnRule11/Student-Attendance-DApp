"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useChainId, useSignTypedData } from "wagmi";
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
  const { signTypedDataAsync, isPending, error } = useSignTypedData();
  const [sessionId, setSessionId] = useState("1");
  const [qrNonce, setQrNonce] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [signature, setSignature] = useState("");
  const [localError, setLocalError] = useState("");

  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  const validContractAddress = Boolean(contractAddress && isAddress(contractAddress));
  const canSign = isConnected && chainId === sepolia.id && validContractAddress;

  async function handleSign() {
    setSignature("");
    setLocalError("");
    if (!canSign || !contractAddress) return;

    try {
      if (![sessionId, qrNonce, expiresAt].every((value) => /^\\d+$/.test(value.trim()))) {
        throw new Error("Session ID, QR nonce, and expiry must be positive integers.");
      }

      const session = BigInt(sessionId);
      const nonce = BigInt(qrNonce);
      const expiry = BigInt(expiresAt);
      const zero = BigInt(0);

      if (session <= zero || nonce <= zero || expiry <= zero) {
        throw new Error("Session ID, QR nonce, and expiry must be positive integers.");
      }

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

      setSignature(result);
    } catch (signingError) {
      setSignature("");
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
        <p className="panel-label">INSTRUCTOR TOOL · EIP-712</p>
        <h2 id="signer-heading">Sign an attendance authorization</h2>
        <p className="muted">
          This signs the exact AttendanceAuthorization fields expected by the Solidity
          contract. A deployed Sepolia contract address is required; no transaction is sent.
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
          Set NEXT_PUBLIC_CONTRACT_ADDRESS to the verified Sepolia contract address before signing.
        </p>
      )}
      {isConnected && chainId !== sepolia.id && (
        <p className="notice-message">Switch your wallet to Sepolia before signing.</p>
      )}

      <button className="primary-action" onClick={handleSign} disabled={!canSign || isPending || !expiresAt.trim()}>
        {isPending ? "Waiting for wallet…" : "Sign authorization"}
      </button>

      {(localError || error?.message) && <p className="error-message" role="alert">{localError || error?.message}</p>}
      {signature && (
        <div className="signature-result">
          <p className="panel-label">SIGNATURE CREATED · NOT SUBMITTED</p>
          <code>{signature}</code>
          <button className="secondary-action" onClick={() => navigator.clipboard.writeText(signature)}>
            Copy signature
          </button>
        </div>
      )}
      {!address && <p className="muted">Connect an instructor wallet to enable signing.</p>}
    </section>
  );
}
