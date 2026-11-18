"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { sepolia } from "wagmi/chains";
import { studentAttendanceAbi } from "../lib/contract/abi";
import { studentAttendanceAddress } from "../lib/contract/deployment";

type CheckState = "not-configured" | "checking" | "passed" | "failed";

type DeploymentCheck = {
  state: CheckState;
  message: string;
  admin?: string;
  nextSessionId?: string;
};

const initialCheck: DeploymentCheck = {
  state: studentAttendanceAddress ? "checking" : "not-configured",
  message: studentAttendanceAddress
    ? "Checking the Sepolia deployment…"
    : "The Sepolia contract address is not configured in this frontend build.",
};

export function DeploymentStatus() {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [check, setCheck] = useState<DeploymentCheck>(initialCheck);

  const verifyDeployment = useCallback(async () => {
    if (!studentAttendanceAddress) {
      setCheck(initialCheck);
      return;
    }
    if (!publicClient) {
      setCheck({ state: "failed", message: "Sepolia RPC client is unavailable. Check the public RPC configuration and retry." });
      return;
    }

    setCheck({ state: "checking", message: "Checking deployed bytecode and contract reads on Sepolia…" });
    try {
      const bytecode = await publicClient.getBytecode({ address: studentAttendanceAddress });
      if (!bytecode || bytecode === "0x") {
        throw new Error("No contract bytecode exists at the configured address on Sepolia.");
      }

      const [admin, nextSessionId] = await Promise.all([
        publicClient.readContract({ address: studentAttendanceAddress, abi: studentAttendanceAbi, functionName: "admin" }),
        publicClient.readContract({ address: studentAttendanceAddress, abi: studentAttendanceAbi, functionName: "nextSessionId" }),
      ]);

      setCheck({
        state: "passed",
        message: "On-chain checks passed: contract bytecode exists and admin/session reads succeeded.",
        admin,
        nextSessionId: nextSessionId.toString(),
      });
    } catch (error) {
      setCheck({
        state: "failed",
        message: error instanceof Error ? error.message : "Could not verify the configured Sepolia deployment.",
      });
    }
  }, [publicClient]);

  useEffect(() => {
    // This effect synchronizes the component with the external Sepolia RPC.
    // The callback updates state before and after its asynchronous reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verifyDeployment();
  }, [verifyDeployment]);

  return (
    <section className="integration-panel" aria-labelledby="deployment-status-heading">
      <div>
        <p className="panel-label">NETWORK · DEPLOYMENT CHECK</p>
        <h2 id="deployment-status-heading">Sepolia contract status</h2>
        {studentAttendanceAddress ? (
          <p className="muted">Configured contract: <code>{studentAttendanceAddress}</code></p>
        ) : null}
      </div>

      <p className={check.state === "passed" ? "status-message" : check.state === "failed" ? "error-message" : "notice-message"} role="status" aria-live="polite">
        {check.message}
      </p>

      {check.state === "passed" && (
        <div className="session-details">
          <p><strong>Chain:</strong> Ethereum Sepolia ({sepolia.id})</p>
          <p><strong>Administrator:</strong> <code>{check.admin}</code></p>
          <p><strong>Next session ID:</strong> {check.nextSessionId}</p>
        </div>
      )}

      {studentAttendanceAddress && (
        <div className="dashboard-actions">
          <a className="explorer-link" href={`https://sepolia.etherscan.io/address/${studentAttendanceAddress}`} target="_blank" rel="noreferrer">
            View contract on Sepolia Etherscan
          </a>
          <button className="secondary-action" type="button" onClick={() => void verifyDeployment()} disabled={check.state === "checking"}>
            {check.state === "checking" ? "Checking…" : "Recheck deployment"}
          </button>
        </div>
      )}
      <p className="muted">This check confirms runtime bytecode and two ABI reads. It does not mean the source code has been independently verified on Etherscan or audited.</p>
    </section>
  );
}
