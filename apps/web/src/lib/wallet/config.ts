import { createConfig, http } from "wagmi";
import { injected } from "@wagmi/core";
import { sepolia } from "wagmi/chains";

const rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

export const walletConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(rpcUrl || undefined),
  },
  ssr: true,
});
