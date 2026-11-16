# Student Attendance DApp

[![Contracts CI](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/workflows/contracts-ci.yml/badge.svg)](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/workflows/contracts-ci.yml)
[![Web CI](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/workflows/web-ci.yml/badge.svg)](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/workflows/web-ci.yml)

A wallet-based attendance system built on **Ethereum Sepolia**. Instructors create time-bounded attendance sessions and issue signed QR authorizations. Registered students scan or enter the QR payload and submit attendance transactions using their own wallets.

> **Project status:** Phases 1–9 have been merged. Sepolia deployment tooling is available, but **the contract has not been deployed**. This repository is a testnet-stage project, not an independently audited or production-ready system.

---

## Contents

- [Overview](#overview)
- [Core capabilities](#core-capabilities)
- [How attendance works](#how-attendance-works)
- [Architecture and technology](#architecture-and-technology)
- [Smart-contract security model](#smart-contract-security-model)
- [Known limitations and residual risks](#known-limitations-and-residual-risks)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Validation and tests](#validation-and-tests)
- [Sepolia deployment](#sepolia-deployment)
- [Delivery progress](#delivery-progress)
- [Contributing](#contributing)

## Overview

The application uses wallet identity and smart-contract rules to record attendance without placing student names, email addresses, or matriculation numbers on-chain.

The contract is the source of truth for instructor permissions, student registration, session state, QR authorization, and attendance records. The web application provides the user interface for those contract interactions.

### Intended roles

| Role | Main responsibilities |
|---|---|
| Administrator | Authorize and revoke instructors; propose and accept administrator handover |
| Instructor | Create sessions, register or revoke student wallets, manage owned sessions, issue QR authorizations |
| Student | Connect a wallet, scan or enter an authorization, submit attendance, check personal attendance status |

Role-specific controls are shown based on contract state. All state-changing operations require a connected wallet on Sepolia and a configured contract address.

## Core capabilities

- **Wallet connection:** connect an injected EVM wallet and enforce the Sepolia network.
- **Instructor authorization:** administrator-controlled instructor access.
- **Student registration:** instructors register or revoke student wallet addresses.
- **Session management:** create time-bounded sessions, pause or resume sessions, and rotate QR nonces.
- **EIP-712 authorization:** instructors sign typed attendance messages bound to the chain, contract, session, nonce, and expiry.
- **QR attendance:** generate QR codes for students to scan; manual payload entry is available as a camera alternative.
- **On-chain validation:** the contract checks instructor authorization, student registration, session state and timing, signature validity, nonce, and duplicate attendance.
- **Transaction feedback:** the interface waits for transaction receipts and provides Sepolia Etherscan links.
- **Governance safeguards:** administrator handover requires a proposal followed by acceptance from the nominated wallet; instructor revocation invalidates new attendance for that instructor's sessions.

## How attendance works

1. The instructor connects an authorized wallet on Sepolia.
2. The instructor creates a session with a start and end time.
3. The application reads the session's current QR nonce and prepares an EIP-712 authorization.
4. The instructor signs the authorization with their wallet. The signed payload is encoded into a QR code.
5. The registered student scans the QR code or enters its payload manually.
6. The student reviews and submits the attendance transaction.
7. The contract validates the authorization and records attendance for that student and session.

A QR authorization can be used by multiple registered students until it expires or its nonce is rotated. Duplicate attendance is prevented per student per session; the QR itself is deliberately not consumed by the first student.

## Architecture and technology

| Layer | Technology | Responsibility |
|---|---|---|
| Web application | Next.js App Router, React, TypeScript | User interface and role-based workflows |
| Wallet integration | wagmi, viem | Wallet connection, chain checks, typed-data signing, contract reads and writes |
| Smart contracts | Solidity, Foundry | Authorization rules and attendance state |
| QR generation | qrcode.react | Render signed attendance payloads |
| QR scanning | html5-qrcode | Camera scanning with manual-entry fallback |
| Automation | GitHub Actions | Contract and web validation workflows |
| Network | Ethereum Sepolia | Testnet execution |

### Application flow

```text
Instructor wallet
      |
      v
Create session -> EIP-712 signature -> QR payload
                                      |
                                      v
Student wallet -> Scan / paste -> Contract validation
                                      |
                                      v
                              Attendance recorded
                                      |
                                      v
                              Transaction receipt
```

## Smart-contract security model

The contract is the enforcement boundary. Frontend validation improves usability but is not a security control.

### Attendance authorization

The EIP-712 domain uses:

- Name: `StudentAttendance`
- Version: `1`
- Chain ID: the active deployment chain
- Verifying contract: the deployed attendance contract

The signed message contains:

- `sessionId` — the attendance session identifier
- `qrNonce` — the session's current QR nonce
- `expiresAt` — the authorization expiry timestamp

The contract also checks that the signing instructor remains authorized, the student is registered, the session is active and within its time window, the nonce is current, and that the student has not already attended that session.

### Governance and revocation

- The current administrator nominates a successor using `proposeAdmin`.
- Only the nominated wallet can complete the transfer using `acceptAdmin`.
- The accepted administrator is granted instructor access.
- The previous administrator retains instructor access until separately revoked.
- Revoking an instructor prevents new attendance submissions for that instructor's sessions and prevents the revoked instructor from managing those sessions.
- Previously recorded attendance is not erased or rewritten.

Administrator handover is **not** key recovery. If the current administrator loses access before nominating a successor, the contract does not provide a recovery mechanism.

### Privacy principles

- Do not store student names, emails, matriculation numbers, or other direct identifiers on-chain.
- Never request or store wallet private keys or seed phrases.
- Wallet addresses and transaction histories are public and pseudonymous, not anonymous.
- Attendance records are append-only in the current contract; there is no silent delete or edit operation.

## Known limitations and residual risks

- **QR sharing:** a student can photograph or forward a QR code. Expiry and nonce rotation reduce exposure but do not prove physical presence.
- **No physical-presence attestation:** scanning a QR code alone cannot establish that a student is physically in the classroom.
- **Global role scope:** instructor and student permissions are not currently scoped to an institution, department, course, or class.
- **No enumerable roster:** the contract does not expose a complete student directory or attendance enumeration/count. The dashboard therefore supports direct wallet and session lookups rather than inventing roster data or totals.
- **Administrator trust:** the administrator remains a privileged trust anchor. Multisig administration should be considered before any production deployment.
- **External assurance:** an independent smart-contract audit, browser-level integration testing, and dependency advisory triage remain outstanding.

These limitations must be considered before using the system for consequential academic records.

## Repository structure

```text
.
├── .github/
│   └── workflows/
│       ├── contracts-ci.yml
│       └── web-ci.yml
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   │   ├── globals.css
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   └── providers.tsx
│       │   ├── components/
│       │   │   ├── AuthorizationSigner.tsx
│       │   │   ├── RoleDashboard.tsx
│       │   │   ├── StudentAttendanceScanner.tsx
│       │   │   └── WalletPanel.tsx
│       │   └── lib/
│       │       ├── contract/abi.ts
│       │       ├── qr/attendance-payload.ts
│       │       └── wallet/config.ts
│       ├── package.json
│       └── tsconfig.json
├── contracts/
│   ├── script/
│   │   └── DeployStudentAttendance.s.sol
│   ├── src/
│   │   └── StudentAttendance.sol
│   ├── test/
│   │   ├── StudentAttendance.t.sol
│   │   └── StudentAttendanceInvariant.t.sol
│   └── foundry.toml
├── docs/
│   ├── DEPLOYMENT.md
│   ├── PHASE-7-SECURITY-VALIDATION.md
│   └── SECURITY.md
├── .env.example
└── README.md
```

## Getting started

### Prerequisites

- Node.js and npm
- Foundry (for smart-contract development and tests)
- An injected EVM wallet for browser-based wallet interaction
- Sepolia test ETH for testnet transactions

### Install and run the web application

From the repository root:

```bash
cd apps/web
npm install
npm run dev
```

The development server is available at `http://localhost:3000`.

Useful web checks:

```bash
npm run lint
npm run typecheck
npm run build
```

### Build and test the contracts

From the repository root:

```bash
cd contracts
forge fmt --check
forge build
forge test
forge test --fuzz-runs 1000
```

## Configuration

Copy the example environment file and configure the frontend locally:

```bash
cp .env.example apps/web/.env.local
```

The frontend uses public configuration values such as:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | Expected network; Sepolia is `11155111` |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Deployed attendance contract address |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | Optional browser-accessible Sepolia RPC endpoint |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional WalletConnect project configuration placeholder |

The deployment script uses server-side/deployment environment values documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Do not commit `.env.local`, private keys, seed phrases, RPC credentials, or other secrets. Never paste a private key or seed phrase into chat or a frontend environment variable.

**Important:** `NEXT_PUBLIC_CONTRACT_ADDRESS` is intentionally not populated with a live address. Set it only after a successful Sepolia deployment and independent verification.

## Validation and tests

GitHub Actions runs separate workflows for:

- Solidity formatting, compilation, Foundry tests, fuzz tests, and invariant tests.
- Web dependency installation, ESLint, TypeScript type-checking, and Next.js production build.

Workflow results:

- [Contracts CI](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/workflows/contracts-ci.yml)
- [Web CI](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/workflows/web-ci.yml)

Passing CI demonstrates that the configured automated checks passed for a commit. It is not a substitute for an independent security audit or live end-to-end testing.

## Sepolia deployment

A Sepolia-only Foundry deployment script and controlled deployment runbook are included.

**No live deployment is currently claimed.** Before broadcasting a deployment transaction:

1. Review [docs/SECURITY.md](docs/SECURITY.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
2. Confirm the deployment script, contract behavior, and governance assumptions.
3. Use a dedicated wallet funded only with Sepolia test ETH.
4. Verify the RPC endpoint reports chain ID `11155111`.
5. Confirm the expected deployer address before broadcasting.
6. Verify the deployed source and address on Sepolia Etherscan.
7. Run the documented post-deployment checks before configuring the frontend.

The deployer becomes the initial administrator. Protect that wallet carefully; administrator handover is possible only while the current administrator can authorize a proposal.

## Delivery progress

| Phase | Scope | Status |
|---:|---|---|
| 1 | Architecture, threat model, repository foundation | Merged |
| 2 | Attendance contract, EIP-712 verification, security tests | Merged |
| 3 | Next.js application foundation and web CI | Merged |
| 4 | Sepolia wallet connection and typed-data signing | Merged |
| 5 | QR generation, scanning, and attendance transaction flow | Merged |
| 6 | Role-aware dashboards and contract-backed management | Merged |
| 7 | Fuzz, invariant, and security validation | Merged |
| 8 | Sepolia deployment tooling and deployment runbook | Merged |
| 9 | Two-step admin handover and instructor-revocation enforcement | Merged |

### Remaining release work

- Complete browser-level and Anvil end-to-end integration tests.
- Triage and resolve dependency security advisories.
- Review operational controls and consider multisig administration.
- Obtain an independent smart-contract security audit.
- Perform a controlled Sepolia deployment and verify the deployed contract.
- Configure and test the frontend against the verified deployment.

## Contributing

Contributions should preserve the contract as the source of truth and maintain the privacy and security principles above.

1. Create a focused branch for the change.
2. Add or update tests for contract and application behavior.
3. Run the relevant formatting, test, lint, type-check, and build commands.
4. Describe security implications and known limitations in the pull request.

Avoid introducing mock contract behavior, fabricated attendance data, or claims of deployment and audit that are not supported by evidence.

---

For implementation details and operational procedures, see the `docs/` directory.
