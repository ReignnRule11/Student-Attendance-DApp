# Student Attendance DApp

A wallet-based attendance application targeting **Ethereum Sepolia**. Authorized instructors issue short-lived EIP-712 QR authorizations; registered students scan the code and submit attendance from their own wallet.

> **Project status:** Phases 1–4 are merged. Phase 5 QR generation and student check-in implementation is under review. No contract deployment, live transaction, independent audit, or production-readiness claim is made.

## Product workflow

1. An instructor connects an authorized wallet on Sepolia.
2. The instructor enters a session ID, current QR nonce, and expiry.
3. The web app reads the session from the configured contract and checks that the connected wallet created the active session, the nonce is current, and expiry does not exceed the session end.
4. The instructor signs the exact EIP-712 `AttendanceAuthorization(uint256 sessionId,uint256 qrNonce,uint256 expiresAt)` typed data and displays the resulting QR code.
5. A registered student connects their wallet, scans the QR with the camera or pastes its payload, and submits attendance.
6. The app checks student registration, session state, nonce, expiry, and previous attendance for usability. The contract independently enforces all security rules and records attendance.

The QR is reusable by multiple students until expiry or nonce rotation. It is not a single-use token; the contract enforces one attendance per student per session.

## Architecture

- **Web:** Next.js App Router, TypeScript, responsive CSS.
- **Wallet and chain client:** wagmi and viem, injected wallet connection, Sepolia chain enforcement.
- **QR generation:** `qrcode.react`.
- **Camera scanning:** `html5-qrcode`; camera access begins only after the student explicitly starts scanning. Manual payload entry is also available.
- **Contract access:** typed ABI for the deployed `StudentAttendance` contract.
- **Smart contracts:** Solidity and Foundry.
- **Verification:** contract-enforced authorization and replay protection; frontend checks are for usability and are never treated as security boundaries.
- **CI:** GitHub Actions for contract and frontend checks.

### QR payload

The versioned QR payload contains:
- schema version (`1`)
- Sepolia chain ID (`11155111`)
- verifying contract address
- session ID
- QR nonce
- expiry timestamp (Unix seconds)
- 65-byte EIP-712 signature

The signature covers the session ID, nonce, and expiry. The EIP-712 domain binds it to the `StudentAttendance` contract name/version, Sepolia chain ID, and verifying contract address. No student names, emails, matriculation numbers, or other student personal data are included.

### Trust boundaries and limitations

The smart contract is authoritative for instructor permissions, student registration, session validity, QR authorization, expiry, and duplicate prevention. The frontend pre-checks can become stale; the contract revalidates when the transaction executes.

A QR code is a bearer artifact: someone may photograph or share it. Short expiry and instructor-controlled nonce rotation reduce this risk, but QR scanning alone **does not prove physical presence**. Institutions requiring stronger presence assurance need a supervised process or additional controls.

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
│   └── foundry.toml
├── docs/
│   ├── DEPLOYMENT.md
│   ├── SECURITY.md
│   └── . . .
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
- Document transaction costs, public wallet activity, and the limitations of pseudonymous on-chain records.
- Treat QR codes as shareable bearer artifacts, not proof of physical presence.

## Delivery phases

1. Architecture, threat model, and repository foundation — **complete**.
2. Attendance contract, EIP-712 verification, and adversarial Foundry tests — **merged; CI passed**.
3. Next.js web foundation and frontend CI — **merged; CI passed**.
4. Sepolia wallet connection and EIP-712 signing foundation — **merged; CI passed**.
5. Instructor QR generation, student camera/manual scanning, contract-state pre-checks, and attendance transaction flow — **implementation under review**.
6. Instructor/student dashboards, session creation and student registration UI.
7. End-to-end, fuzz, invariant, and security validation.
8. Sepolia deployment, explorer verification, and deployment documentation.

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

Copy `.env.example` to `apps/web/.env.local` for local frontend configuration. Set `NEXT_PUBLIC_CONTRACT_ADDRESS` only after a verified Sepolia deployment; optionally provide `NEXT_PUBLIC_SEPOLIA_RPC_URL`. Never commit private keys, seed phrases, RPC credentials, or other secrets.

## Current implementation status

The Phase 5 branch adds signed QR generation, QR payload validation, camera/manual scanning, preflight reads for registration/session/duplicate status, and a `markAttendance` transaction flow. These features require a deployed `StudentAttendance` contract address and an available Sepolia RPC endpoint. Until those are configured, the UI intentionally disables live QR generation and student check-in. No deployment or live attendance transaction is claimed. Features and test results will be reported as complete only after CI and deployment-backed verification.
