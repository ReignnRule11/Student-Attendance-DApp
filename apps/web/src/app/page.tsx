import Link from "next/link";
import { WalletPanel } from "../components/WalletPanel";
import { AuthorizationSigner } from "../components/AuthorizationSigner";

const capabilities = [
  {
    number: "01",
    title: "Instructor-led sessions",
    description:
      "Authorized instructors create time-bound sessions and issue signed QR authorizations.",
  },
  {
    number: "02",
    title: "Wallet-based check-in",
    description:
      "Registered students scan a session code and submit attendance from their own wallet.",
  },
  {
    number: "03",
    title: "Verifiable records",
    description:
      "The smart contract enforces eligibility, expiry, replay protection, and one check-in per session.",
  },
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Student Attendance home">
          <span className="brand-mark">SA</span>
          <span>Student Attendance</span>
        </Link>
        <span className="network-pill"><span className="status-dot" /> Ethereum Sepolia</span>
      </header>

      <section className="hero">
        <p className="eyebrow">DECENTRALIZED ATTENDANCE</p>
        <h1>Attendance that is <span>verifiable.</span></h1>
        <p className="hero-copy">
          Instructor-authorized sessions, wallet-based check-ins, and tamper-resistant
          attendance records on Ethereum.
        </p>
        <div className="hero-actions">
          <Link className="primary-action" href="#wallet">Connect wallet <span aria-hidden="true">↗</span></Link>
          <span className="phase-note">Phase 4 · Wallet and signing integration</span>
        </div>
      </section>

      <WalletPanel />
      <AuthorizationSigner />

      <section className="workflow" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">CORE WORKFLOW</p>
          <h2>Three parts. One verifiable record.</h2>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="capability-card" key={item.number}>
              <span className="card-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>Student Attendance DApp</span>
        <span>Testnet integration · No contract deployment claimed</span>
      </footer>
    </main>
  );
}
