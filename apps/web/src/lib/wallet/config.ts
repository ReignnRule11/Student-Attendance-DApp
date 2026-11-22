import { fallback, http } from "viem";
import { createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";

const rpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

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

const connectors = [
  injected(),
  ...(walletConnectProjectId
    ? [
        walletConnect({
          projectId: walletConnectProjectId,
          showQrModal: true,
          metadata: {
            name: "Student Attendance DApp",
            description: "Wallet-based student attendance on Ethereum Sepolia.",
            url: "https://student-attendance-dapp.vercel.app",
            icons: [],
          },
        }),
      ]
    : []),
];

export const walletConfig = createConfig({
  chains: [sepolia],
  connectors,
  transports: {
    [sepolia.id]: fallback(rpcTransports),
  },
  ssr: true,
});
