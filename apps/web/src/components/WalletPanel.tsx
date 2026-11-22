"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { sepolia } from "wagmi/chains";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatWalletError(error: Error | null): string {
  if (!error) return "";
  const msg = error.message || "";
  if (/user rejected|denied transaction|rejected the request/i.test(msg)) {
    return "Connection request was cancelled in your wallet.";
  }
  if (/already processing|resource unavailable/i.test(msg)) {
    return "A wallet prompt is already open. Check your wallet extension.";
  }
  if (/provider not found/i.test(msg)) {
    return "Wallet extension was not found. Unlock or install your wallet and retry.";
  }
  return msg;
}

const subscribeNoop = () => () => {};

function useHasInjectedEthereum(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum),
    () => false,
  );
}

export function WalletPanel() {
  const { address, chainId, isConnected, connector: activeConnector } = useAccount();
  const { connectAsync, connectors, isPending, error: connectError, reset: resetConnectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const hasWindowEthereum = useHasInjectedEthereum();
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectingUid, setConnectingUid] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const wrongNetwork = isConnected && chainId !== sepolia.id;

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  // Separate named EIP-6963 browser wallets, WalletConnect, and the generic injected fallback.
  const eip6963Wallets = connectors.filter(
    (c) => c.id !== "injected" && c.id !== "walletConnect",
  );
  const walletConnectConnector = connectors.find((c) => c.id === "walletConnect");
  const genericInjected = connectors.find((c) => c.id === "injected");

  // Only show the generic `Injected` option when no named EIP-6963 wallet is present
  // and `window.ethereum` exists (e.g. legacy in-app browsers or test mocks).
  const availableWallets: Array<{ connector: Connector; label: string; tag: string }> = [
    ...eip6963Wallets.map((connector) => ({
      connector,
      label: connector.name,
      tag: "Detected",
    })),
    ...(eip6963Wallets.length === 0 && genericInjected && hasWindowEthereum
      ? [{ connector: genericInjected, label: "Browser Wallet", tag: "Injected" }]
      : []),
    ...(walletConnectConnector
      ? [{ connector: walletConnectConnector, label: "WalletConnect", tag: "Mobile / QR" }]
      : []),
  ];

  async function handleConnect(connector: Connector) {
    resetConnectError();
    setConnectingUid(connector.uid);
    try {
      await connectAsync({ connector, chainId: sepolia.id });
      setMenuOpen(false);
    } catch {
      // Error is exposed via `connectError`.
    } finally {
      setConnectingUid(null);
    }
  }

  const displayedError = formatWalletError(connectError || switchError);

  return (
    <div className="wallet-status-wrap" id="wallet" ref={containerRef}>
      {isConnected && address ? (
        <button
          type="button"
          className={menuOpen ? "wallet-pill wallet-pill-open" : "wallet-pill"}
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-label="Connected wallet account"
        >
          <span className={wrongNetwork ? "status-dot status-dot-err" : "status-dot status-dot-ok"} />
          <span className="wallet-pill-addr">{shortenAddress(address)}</span>
          <span className={wrongNetwork ? "wallet-net-tag wallet-net-warn" : "wallet-net-tag"}>
            {wrongNetwork ? "Wrong network" : "Connected · Sepolia"}
          </span>
          <svg
            className={menuOpen ? "pill-chevron pill-chevron-open" : "pill-chevron"}
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
      ) : (
        <button
          type="button"
          className="primary-action wallet-connect-trigger"
          onClick={() => {
            resetConnectError();
            setMenuOpen((prev) => !prev);
          }}
          aria-expanded={menuOpen}
        >
          Connect Wallet
        </button>
      )}

      {menuOpen && (
        <>
          <div
            className="status-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="status-popover wallet-popover"
            role="dialog"
            aria-label={isConnected ? "Wallet account details" : "Connect a wallet"}
          >
            <div className="popover-header">
              <div className="popover-title-group">
                <span className="panel-label">
                  {isConnected ? "CONNECTED WALLET" : "SELECT WALLET"}
                </span>
              </div>
              <button
                type="button"
                className="popover-close"
                onClick={() => setMenuOpen(false)}
                aria-label="Close wallet menu"
              >
                ✕
              </button>
            </div>

            {isConnected && address ? (
              <>
                <div className="popover-rows">
                  <div className="popover-row">
                    <span className="popover-key">
                      Provider{activeConnector ? ` · ${activeConnector.name}` : ""}
                    </span>
                    <div className="popover-value-group">
                      <code title={address}>{address}</code>
                      <button
                        type="button"
                        className="copy-inline-btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(address);
                          setCopiedAddress(true);
                          setTimeout(() => setCopiedAddress(false), 1800);
                        }}
                      >
                        {copiedAddress ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div className="popover-row">
                    <span className="popover-key">Network</span>
                    <span className={wrongNetwork ? "notice-message" : "status-message"}>
                      {wrongNetwork ? "Not on Ethereum Sepolia (11155111)" : "Ethereum Sepolia (11155111)"}
                    </span>
                  </div>
                </div>

                {wrongNetwork && (
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => switchChain({ chainId: sepolia.id })}
                    disabled={isSwitching}
                  >
                    {isSwitching ? "Switching network…" : "Switch to Sepolia"}
                  </button>
                )}

                <div className="popover-footer">
                  <a
                    className="secondary-action popover-action-link"
                    href={`https://sepolia.etherscan.io/address/${address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Etherscan ↗
                  </a>
                  <button
                    type="button"
                    className="secondary-action popover-action-btn"
                    onClick={() => {
                      disconnect();
                      setMenuOpen(false);
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">
                  Connect on <strong>Ethereum Sepolia</strong>. The app never requests or stores your recovery phrase.
                </p>

                {availableWallets.length > 0 ? (
                  <div className="wallet-option-list">
                    {availableWallets.map(({ connector, label, tag }) => {
                      const isThisConnecting = isPending && connectingUid === connector.uid;
                      return (
                        <button
                          key={connector.uid}
                          type="button"
                          className="wallet-option-btn"
                          onClick={() => void handleConnect(connector)}
                          disabled={isPending}
                        >
                          <span className="wallet-option-left">
                            {connector.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={connector.icon}
                                alt=""
                                width={24}
                                height={24}
                                className="wallet-option-icon"
                              />
                            ) : (
                              <span className="wallet-option-fallback" aria-hidden="true">
                                {label.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="wallet-option-name">
                              {isThisConnecting ? `Connecting ${label}…` : label}
                            </span>
                          </span>
                          <span className="wallet-option-tag">{tag}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="wallet-empty-state">
                    <p className="notice-message">No browser wallet detected.</p>
                    <p className="muted">
                      Install MetaMask, Phantom, or Rabby in your browser, or open this page inside your mobile wallet&apos;s built-in browser.
                    </p>
                  </div>
                )}
              </>
            )}

            {displayedError && (
              <p className="error-message" role="alert">
                {displayedError}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
