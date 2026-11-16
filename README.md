# Student Attendance DApp

A full-stack, wallet-based attendance application targeting **Ethereum Sepolia**. Instructors create attendance sessions and display short-lived QR codes; registered students scan a code and submit an on-chain attendance transaction with their connected wallet.

> **Project status:** Phase 1 and Phase 2 are merged. Phase 3 web foundation is under review. No contract deployment or production-readiness claim is made.

## Product workflow

1. An instructor connects an authorized wallet and creates an attendance session.
2. The application generates a short-lived, session-bound EIP-712 authorization payload and encodes it as a QR code.
3. A registered student scans the QR code and connects their wallet.
4. The student submits attendance to the Sepolia contract.
5. The contract validates the instructor signature, session, expiry, student registration, and duplicate status, then emits an attendance event.

## Architecture

- **Web:** Next.js App Router, TypeScript, responsive CSS.
- **Wallet and chain client:** planned wagmi and viem integration; Ethereum Sepolia.
- **Smart contracts:** Solidity, Foundry, OpenZeppelin cryptographic utilities.
- **QR:** planned browser camera scanning and QR generation in the web client.
- **Verification:** contract-enforced authorization and replay protection; UI checks are never treated as security boundaries.
- **CI:** GitHub Actions for contract and frontend checks.

### Trust boundaries

The smart contract is authoritative for instructor permissions, student registration, session validity, QR authorization, expiry, and duplicate prevention. The frontend only prepares and displays data and submits transactions; it cannot override contract rules.

The QR payload should be bound to the chain, verifying contract, session, expiry, and authorized instructor using an EIP-712 typed-data signature. A QR code is a bearer artifact: someone may photograph or share it. Short expiry and supervised rotating codes reduce this risk, but QR scanning alone **does not prove physical presence**.

## Repository structure

```text
.
├── .github/
│   └── workflows/
│       ├── contracts-ci.yml       # Foundry format, build, and test checks
│       └── web-ci.yml             # Web lint, typecheck, and production build
├── apps/
│   └── web/
│       ├── src/
│       │   └── app/
│       │       ├── globals.css    # Responsive application styling
│       │       ├── layout.tsx     # Root layout and metadata
│       │       └── page.tsx        # Initial product landing/dashboard shell
│       ├── eslint.config.mjs
│       ├── next.config.ts
│       ├── next-env.d.ts
│       ├── package.json
│       └── tsconfig.json
├── contracts/
│   ├── src/
│   │   └── StudentAttendance.sol  # Attendance and EIP-712 authorization logic
│   ├── test/
│   │   └── StudentAttendance.t.sol
│   └── foundry.toml
├── docs/
│   ├── DEPLOYMENT.md
│   └── SECURITY.md
├── .env.example
├── .gitignore
└── README.md
```

### Planned web modules

The following modules are part of the intended architecture and will be added in later implementation steps; they are **not represented as implemented yet**:

- `src/components/` — reusable interface components.
- `src/features/instructor/` — session creation, student registration, and signed QR generation.
- `src/features/student/` — QR scanning and attendance submission.
- `src/lib/wallet/` — wallet connection and Sepolia client configuration.
- `src/lib/contract/` — contract ABI, typed contract access, and address configuration.
- `src/lib/qr/` — QR payload validation and encoding/decoding.
- `src/hooks/` — shared client hooks.
- `src/types/` — shared TypeScript domain types.
- `src/__tests__/` — frontend and integration tests.

## Privacy and security principles

- Do not put student names, emails, matriculation numbers, or other direct identifiers on-chain.
- Use wallet addresses and non-identifying application references where needed.
- Never request, collect, or store wallet private keys or seed phrases.
- Enforce instructor-only session creation and registration in the contract.
- Enforce registered-student-only attendance and one attendance record per student per session.
- Reject expired, forged, wrong-session, wrong-chain, and replayed authorizations.
- Do not provide an administrative path to silently erase or rewrite attendance history.
- Document transaction costs, public wallet activity, and the limitations of pseudonymous on-chain records.

## Delivery phases

1. Architecture, threat model, and repository foundation — **complete**.
2. Attendance contract, EIP-712 verification, and adversarial Foundry tests — **merged; CI passed**.
3. Next.js web foundation and frontend CI — **under review**.
4. Wallet connection, instructor QR generation, and student QR scanning.
5. Instructor and student dashboards.
6. End-to-end and security validation.
7. Sepolia deployment, explorer verification, and deployment documentation.

## Security test baseline

The Foundry suite covers valid attendance, unauthorized registration, unregistered students, duplicate attendance, expired QR authorization, forged instructor signatures, cross-session replay, QR nonce rotation, chain-ID replay, paused sessions, and revoked students.

The test suite is a baseline, not an independent security audit. Further fuzzing, invariant testing, and review are required before production use.

## Development

Frontend commands:

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

Copy `.env.example` to a local environment file when configuration is introduced. Never commit private keys, seed phrases, RPC credentials, or other secrets.

## Current implementation status

The frontend foundation currently provides a responsive landing/dashboard shell and automated lint, TypeScript, and production-build checks. Wallet connection, QR generation/scanning, a deployed contract address, and live Sepolia transactions are not implemented in this phase. Features and test results will be reported as complete only after implementation and verification.
