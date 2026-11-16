"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletPanel() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  const wrongNetwork = isConnected && chainId !== sepolia.id;

  return (
    <section className="integration-panel" aria-labelledby="wallet-heading">
      <div>
        <p className="panel-label">WALLET CONNECTION</p>
        <h2 id="wallet-heading">Connect on Sepolia</h2>
        <p className="muted">
          Connect an injected wallet such as MetaMask. The app never asks for or stores
          your recovery phrase or private key.
        </p>
      </div>

      <div className="wallet-controls">
        {isConnected && address ? (
          <>
            <span className="wallet-address" title={address}>{shortenAddress(address)}</span>
            {wrongNetwork ? (
              <button className="secondary-action" onClick={() => switchChain({ chainId: sepolia.id })} disabled={isSwitching}>
                {isSwitching ? "Switching…" : "Switch to Sepolia"}
              </button>
            ) : (
              <span className="network-status">Connected · Sepolia</span>
            )}
            <button className="secondary-action" onClick={() => disconnect()}>Disconnect</button>
          </>
        ) : (
          connectors.map((connector) => (
            <button
              className="primary-action"
              key={connector.uid}
              onClick={() => connect({ connector, chainId: sepolia.id })}
              disabled={isPending}
            >
              {isPending ? "Connecting…" : `Connect ${connector.name}`}
            </button>
          ))
        )}
      </div>
      {(connectError || switchError) && (
        <p className="error-message" role="alert">
          {(connectError || switchError)?.message}
        </p>
      )}
    </section>
  );
}
