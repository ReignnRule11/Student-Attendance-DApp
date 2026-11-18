import { createConfig, http } from "wagmi";
import { injected } from "@wagmi/core";
import { sepolia } from "wagmi/chains";

const rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

export const walletConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    // Bound each RPC request and disable automatic retries so a failed public
    // endpoint cannot leave deployment checks waiting through retry backoff.
    [sepolia.id]: http(rpcUrl || undefined, {
      timeout: 6_000,
      retryCount: 0,
    }),
  },
  ssr: true,
});
