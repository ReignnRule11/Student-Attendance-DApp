import Link from "next/link";
import { AttendanceWorkspace } from "../components/AttendanceWorkspace";
import { DeploymentStatus } from "../components/DeploymentStatus";
import { PwaControls } from "../components/PwaControls";
import { WalletPanel } from "../components/WalletPanel";

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Student Attendance home">
          <span className="brand-mark">SA</span>
          <span>Student Attendance</span>
        </Link>
        <div className="topbar-tools">
          <DeploymentStatus />
          <WalletPanel />
          <PwaControls />
        </div>
      </header>

      <AttendanceWorkspace />

      <footer className="footer">
        <span>Student Attendance DApp</span>
        <span>Ethereum Sepolia · Wallet-verified check-in</span>
      </footer>
    </main>
  );
}
