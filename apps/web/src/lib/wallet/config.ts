import { fallback, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "@wagmi/core";
import { sepolia } from "wagmi/chains";

const rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

const rpcOptions = {
  timeout: 6_000,
  retryCount: 0,
};

// Prefer the configured endpoint when supplied, then fail over to independent
// public Sepolia providers. Public RPCs remain rate-limited and are intended
// for testnet use; production deployments should configure a dedicated RPC.
const rpcTransports = [
  ...(rpcUrl ? [http(rpcUrl, rpcOptions)] : []),
  http("https://ethereum-sepolia-rpc.publicnode.com", rpcOptions),
  http("https://sepolia.gateway.tenderly.co", rpcOptions),
];

export const walletConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: fallback(rpcTransports),
  },
  ssr: true,
});
