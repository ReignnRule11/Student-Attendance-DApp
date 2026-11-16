# Student Attendance DApp

A wallet-based attendance application targeting **Ethereum Sepolia**. Authorized instructors create time-bounded sessions, issue EIP-712 QR authorizations, and registered students submit attendance from their own wallets.

> **Project status:** Phases 1–6 are merged. Phase 7 security hardening and adversarial validation are under review. No contract deployment, live transaction, independent audit, or production-readiness claim is made.

## Phase 6 dashboard

- **Role detection:** reads the immutable contract admin, instructor authorization, and student registration for the connected wallet.
- **Instructor workspace:** creates sessions, registers or revokes student wallets, loads sessions by ID, pauses/resumes sessions, and rotates QR nonces.
- **Admin workspace:** authorizes or revokes instructors. The contract admin cannot revoke its own instructor role.
- **Student workspace:** shows the connected wallet's registration role and supports per-session attendance checks.
- **Transaction feedback:** waits for Sepolia receipts and links submitted transactions to Sepolia Etherscan.
- **Grounded data:** session and role information is read from the contract. The contract has no student directory or attendance enumeration method, so the UI does not fabricate student lists or attendance totals.

All transaction controls require a connected wallet on Sepolia and a configured deployed contract address. The contract remains authoritative; frontend checks are not security boundaries.

## Product workflow

1. An instructor connects an authorized wallet on Sepolia.
2. An instructor creates a time-bounded session through the dashboard.
3. The instructor reads the session's current QR nonce, signs the exact EIP-712 attendance authorization, and displays the resulting QR.
4. A registered student scans the QR or pastes its payload, then confirms the attendance transaction.
5. The contract enforces registration, session state, signature, expiry, nonce validity, and one attendance per student/session.

The QR is reusable by multiple students until expiry or nonce rotation. It is not a single-use token; the contract enforces one attendance per student per session.

## Architecture

- **Web:** Next.js App Router, TypeScript, responsive CSS.
- **Wallet and chain client:** wagmi and viem, injected wallet connection, Sepolia chain enforcement.
- **QR generation:** `qrcode.react`.
- **Camera scanning:** `html5-qrcode`; camera access begins only after the student explicitly starts scanning. Manual payload entry is also available.
- **Contract access:** typed ABI matching `contracts/src/StudentAttendance.sol`.
- **Smart contracts:** Solidity and Foundry.
- **CI:** GitHub Actions for contract and frontend checks.

### Trust boundaries and limitations

A QR code is a bearer artifact: someone may photograph or share it. Short expiry and instructor-controlled nonce rotation reduce this risk, but QR scanning alone **does not prove physical presence**.

The contract does not expose an enumerable student roster or an attendance count. The dashboard therefore supports direct wallet and session lookups rather than implying a complete roster or total.

## Repository structure

```text
.
├── .github/workflows/
│   ├── contracts-ci.yml
│   └── web-ci.yml
├── apps/web/
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── components/
│   │   │   ├── AuthorizationSigner.tsx
│   │   │   ├── RoleDashboard.tsx
│   │   │   ├── StudentAttendanceScanner.tsx
│   │   │   └── WalletPanel.tsx
│   │   └── lib/
│   │       ├── contract/abi.ts
│   │       ├── qr/attendance-payload.ts
│   │       └── wallet/config.ts
│   ├── eslint.config.mjs
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
├── contracts/
│   ├── src/StudentAttendance.sol
│   ├── test/StudentAttendance.t.sol
│   ├── test/StudentAttendanceInvariant.t.sol\n│   ├── test/StudentAttendanceInvariant.t.sol
│   └── foundry.toml
├── docs/
│   ├── DEPLOYMENT.md
│   ├── SECURITY.md
│   └── PHASE-7-SECURITY-VALIDATION.md
├── .env.example
└── README.md
```

## Privacy and security principles

- Do not put student names, emails, matriculation numbers, or other direct identifiers on-chain.
- Never request, collect, or store wallet private keys or seed phrases.
- Enforce instructor-only session creation and registration in the contract.
- Enforce registered-student-only attendance and one attendance record per student per session.
- Reject expired, forged, wrong-session, wrong-chain, and replayed authorizations.
- Do not provide an administrative path to silently erase or rewrite attendance history.
- Treat QR codes as shareable bearer artifacts, not proof of physical presence.
- Remember that wallet addresses and transaction histories are public and pseudonymous, not anonymous.

## Delivery phases

1. Architecture, threat model, and repository foundation — **complete**.
2. Attendance contract, EIP-712 verification, and adversarial Foundry tests — **merged; CI passed**.
3. Next.js web foundation and frontend CI — **merged; CI passed**.
4. Sepolia wallet connection and EIP-712 signing foundation — **merged; CI passed**.
5. Instructor QR generation, student camera/manual scanning, and attendance transaction flow — **merged**.
6. Instructor/student dashboards, session creation, student registration, and session controls — **merged; post-merge web CI passed**.
7. Fuzz, invariant, and security validation — **implementation under review**.
8. Sepolia deployment, explorer verification, and deployment documentation.

## Development

```bash
cd apps/web
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

Contract commands (from the repository root):

```bash
cd contracts
forge fmt --check
forge build
forge test
```

Copy `.env.example` to `apps/web/.env.local` for local frontend configuration. Set `NEXT_PUBLIC_CONTRACT_ADDRESS` only after a verified Sepolia deployment; optionally provide `NEXT_PUBLIC_SEPOLIA_RPC_URL`. Never commit private keys, seed phrases, RPC credentials, or other secrets.

## Current implementation status

Phase 6 adds role-aware dashboard views, contract-backed role detection, session creation and lookup, student registration/revocation, admin instructor authorization/revocation, session pause/resume, QR nonce rotation, and per-wallet attendance checks. Phase 6 is merged and its post-merge web CI passed. These workflows still require a deployed contract address and Sepolia RPC endpoint. Phase 7 adds fuzz and stateful invariant tests; see `docs/PHASE-7-SECURITY-VALIDATION.md`. Browser-level integration tests, dependency advisory triage, deployment, and independent audit remain outstanding. No deployment or live transaction is claimed.