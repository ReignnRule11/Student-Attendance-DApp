const capabilities = [
  {
    number: "01",
    title: "Instructor-led sessions",
    description:
      "Authorized instructors will create time-bound attendance sessions and issue signed QR codes.",
  },
  {
    number: "02",
    title: "Wallet-based check-in",
    description:
      "Registered students will scan a session code and submit attendance from their own wallet.",
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
        <a className="brand" href="/" aria-label="Student Attendance home">
          <span className="brand-mark">SA</span>
          <span>Student Attendance</span>
        </a>
        <span className="network-pill">
          <span className="status-dot" />
          Sepolia testnet target
        </span>
      </header>

      <section className="hero">
        <p className="eyebrow">DECENTRALIZED ATTENDANCE</p>
        <h1>Attendance that is <span>verifiable.</span></h1>
        <p className="hero-copy">
          A wallet-based attendance workflow connecting instructor-authorized
          sessions, QR check-ins, and tamper-resistant on-chain records.
        </p>
        <div className="hero-actions">
          <a className="primary-action" href="#workflow">Explore the workflow <span aria-hidden="true">↗</span></a>
          <span className="phase-note">Phase 3 · Web foundation</span>
        </div>
      </section>

      <section className="status-panel" aria-label="Project integration status">
        <div>
          <p className="panel-label">CURRENT BUILD STATUS</p>
          <h2>Frontend foundation</h2>
          <p className="muted">The contract baseline is merged. Wallet and QR integrations are the next implementation steps.</p>
        </div>
        <div className="status-list">
          <span><i className="complete" /> Solidity contract baseline</span>
          <span><i className="complete" /> Foundry security test baseline</span>
          <span><i className="pending" /> Wallet connection</span>
          <span><i className="pending" /> QR issue and scan flow</span>
        </div>
      </section>

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
        <span>Prototype · Not yet connected to a deployed contract</span>
      </footer>
    </main>
  );
}
