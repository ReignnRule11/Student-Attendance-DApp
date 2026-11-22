"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const DEPLOYMENT_CHECK_TIMEOUT_MS = 18_000;

const initialCheck: DeploymentCheck = {
  state: studentAttendanceAddress ? "checking" : "not-configured",
  message: studentAttendanceAddress
    ? "Checking Sepolia contract…"
    : "Contract address not configured.",
};

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Sepolia RPC check timed out after ${Math.round(timeoutMs / 1000)}s.`,
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function DeploymentStatus() {
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [check, setCheck] = useState<DeploymentCheck>(initialCheck);
  const [expanded, setExpanded] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const verifyDeployment = useCallback(async () => {
    if (!studentAttendanceAddress) {
      setCheck(initialCheck);
      return;
    }
    if (!publicClient) {
      setCheck({
        state: "failed",
        message: "Sepolia RPC client is unavailable.",
      });
      return;
    }

    setCheck({
      state: "checking",
      message: "Verifying bytecode and ABI reads on Sepolia…",
    });

    try {
      const result = await withTimeout(
        (async () => {
          const bytecode = await publicClient.getBytecode({
            address: studentAttendanceAddress,
          });
          if (!bytecode || bytecode === "0x") {
            throw new Error("No contract bytecode found on Sepolia.");
          }

          const [admin, nextSessionId] = await Promise.all([
            publicClient.readContract({
              address: studentAttendanceAddress,
              abi: studentAttendanceAbi,
              functionName: "admin",
            }),
            publicClient.readContract({
              address: studentAttendanceAddress,
              abi: studentAttendanceAbi,
              functionName: "nextSessionId",
            }),
          ]);

          return { admin, nextSessionId: nextSessionId.toString() };
        })(),
        DEPLOYMENT_CHECK_TIMEOUT_MS,
      );

      setCheck({
        state: "passed",
        message: "Contract bytecode and ABI reads verified.",
        admin: result.admin,
        nextSessionId: result.nextSessionId,
      });
    } catch (error) {
      setCheck({
        state: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Could not verify Sepolia contract.",
      });
    }
  }, [publicClient]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verifyDeployment();
  }, [verifyDeployment]);

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  const pillLabel =
    check.state === "passed"
      ? "Sepolia · Ready"
      : check.state === "checking"
        ? "Sepolia · Checking"
        : check.state === "failed"
          ? "Sepolia · RPC issue"
          : "Not configured";

  const dotClass =
    check.state === "passed"
      ? "status-dot status-dot-ok"
      : check.state === "failed"
        ? "status-dot status-dot-err"
        : "status-dot status-dot-pending";

  return (
    <div className="network-status-wrap" ref={containerRef}>
      <button
        type="button"
        className={expanded ? "network-pill network-pill-open" : "network-pill"}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label="Sepolia contract status"
      >
        <span className={dotClass} />
        <span className="network-pill-label">{pillLabel}</span>
        <svg
          className={expanded ? "pill-chevron pill-chevron-open" : "pill-chevron"}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <>
          <div
            className="status-backdrop"
            aria-hidden="true"
            onClick={() => setExpanded(false)}
          />
          <div className="status-popover" role="region" aria-label="Sepolia contract details">
            <div className="popover-header">
              <div className="popover-title-group">
                <span className={dotClass} />
                <span className="panel-label">SEPOLIA CONTRACT</span>
              </div>
              <button
                type="button"
                className="popover-close"
                onClick={() => setExpanded(false)}
                aria-label="Close contract status"
              >
                ✕
              </button>
            </div>

            <p
              className={
                check.state === "passed"
                  ? "status-message"
                  : check.state === "failed"
                    ? "error-message"
                    : "notice-message"
              }
              role="status"
              aria-live="polite"
            >
              {check.message}
            </p>

            {studentAttendanceAddress && (
              <div className="popover-rows">
                <div className="popover-row">
                  <span className="popover-key">Address</span>
                  <div className="popover-value-group">
                    <code title={studentAttendanceAddress}>{studentAttendanceAddress}</code>
                    <button
                      type="button"
                      className="copy-inline-btn"
                      onClick={() => {
                        if (!studentAttendanceAddress) return;
                        void navigator.clipboard.writeText(studentAttendanceAddress);
                        setCopiedAddress(true);
                        setTimeout(() => setCopiedAddress(false), 1800);
                      }}
                    >
                      {copiedAddress ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                {check.state === "passed" && (
                  <>
                    <div className="popover-row">
                      <span className="popover-key">Administrator</span>
                      <code title={check.admin}>{check.admin ? shortAddress(check.admin) : "—"}</code>
                    </div>
                    <div className="popover-row">
                      <span className="popover-key">Next session</span>
                      <span className="popover-value">#{check.nextSessionId}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="popover-footer">
              {studentAttendanceAddress && (
                <a
                  className="secondary-action popover-action-link"
                  href={`https://sepolia.etherscan.io/address/${studentAttendanceAddress}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Etherscan ↗
                </a>
              )}
              <button
                className="primary-action popover-action-btn"
                type="button"
                onClick={() => void verifyDeployment()}
                disabled={check.state === "checking"}
              >
                {check.state === "checking" ? "Checking…" : "Recheck"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
