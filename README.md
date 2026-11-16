# Student Attendance DApp

A full-stack, wallet-based attendance application targeting **Ethereum Sepolia**. Instructors create attendance sessions and display short-lived QR codes; registered students scan a code and submit an on-chain attendance transaction with their connected wallet.

> **Project status:** Initial architecture and repository setup. No contract deployment or production-readiness claim is made.

## Product workflow

1. An instructor connects an authorized wallet and creates an attendance session.
2. The application generates a short-lived, session-bound EIP-712 authorization payload and encodes it as a QR code.
3. A registered student scans the QR code and connects their wallet.
4. The student submits attendance to the Sepolia contract.
5. The contract validates the instructor signature, session, expiry, student registration, and duplicate status, then emits an attendance event.

## Architecture

- **Web:** Next.js, TypeScript, Tailwind CSS.
- **Wallet and chain client:** wagmi and viem; Ethereum Sepolia.
- **Smart contracts:** Solidity, Foundry, OpenZeppelin where appropriate.
- **QR:** browser camera scanning and QR generation in the web client.
- **Verification:** contract-enforced authorization and replay protection; UI checks are never treated as security boundaries.
- **CI:** GitHub Actions for contract and frontend checks.

### Trust boundaries

The smart contract is authoritative for instructor permissions, student registration, session validity, QR authorization, expiry, and duplicate prevention. The frontend only prepares and displays data and submits transactions; it cannot override contract rules.

The QR payload should be bound to the chain, verifying contract, session, expiry, and authorized instructor using an EIP-712 typed-data signature. A QR code is a bearer artifact: someone may photograph or share it. Short expiry and supervised rotating codes reduce this risk, but QR scanning alone **does not prove physical presence**.

## Privacy and security principles

- Do not put student names, emails, matriculation numbers, or other direct identifiers on-chain.
- Use wallet addresses and non-identifying application references where needed.
- Never request, collect, or store wallet private keys or seed phrases.
- Enforce instructor-only session creation and registration in the contract.
- Enforce registered-student-only attendance and one attendance record per student per session.
- Reject expired, forged, wrong-session, wrong-chain, and replayed authorizations.
- Do not provide an administrative path to silently erase or rewrite attendance history.
- Document transaction costs, public wallet activity, and the limitations of pseudonymous on-chain records.

## Planned repository layout

```text
apps/web/                 Next.js application
contracts/src/            Solidity contracts
contracts/test/           Foundry unit and security tests
contracts/script/         Deployment and configuration scripts
docs/                     Architecture, threat model, and deployment guides
.github/workflows/        Continuous integration
.env.example              Names of required public/configuration variables only
```


## Delivery phases

1. Architecture, threat model, and repository foundation.
2. Attendance contract, EIP-712 verification, and adversarial Foundry tests.
3. Wallet connection, instructor QR generation, and student QR scanning.
4. Instructor and student dashboards.
5. End-to-end and security validation.
6. Sepolia deployment, explorer verification, and deployment documentation.

## Security test baseline

The contract test suite must cover unauthorized instructor actions, unregistered students, duplicate attendance, expired and forged signatures, wrong-session and cross-session replay, wrong EIP-712 domain/chain, invalidated instructor authorization, and the absence of attendance mutation/deletion functionality.

## Development status

This repository is being initialized. Features, tests, CI, and deployment will be reported as complete only after their implementation and verification.
