# Phase 12 — Local multi-wallet acceptance tests

## Purpose

This phase adds an integrated Foundry acceptance suite that exercises the attendance lifecycle with separate deterministic admin, instructor, student, second-student, and unregistered-wallet identities.

The suite runs entirely in a local EVM test environment. It does **not** connect to Sepolia, use browser wallets, submit live transactions, or prove that the deployed frontend works end to end. It is a repeatable contract-level acceptance gate while a second real wallet is unavailable.

## Run locally

From the repository root:

```bash
cd contracts
forge fmt --check
forge build --sizes
forge test --match-contract StudentAttendanceAcceptanceTest -vvv
forge test --fuzz-runs 1000
```

The existing Contracts CI workflow automatically discovers the new test contract through `forge test`.

## Acceptance scenarios

| Scenario | Expected result |
|---|---|
| Instructor authorizes two students and creates a session | Setup succeeds |
| First registered student submits a valid instructor signature | Attendance recorded |
| Second registered student uses the same valid QR authorization | Attendance recorded independently |
| First student submits a second time | Reverts with `AlreadyAttended` |
| Unregistered wallet submits | Reverts with `StudentNotRegistered` |
| Expired authorization submitted | Reverts with `AuthorizationExpired` |
| QR nonce rotated after signing | Old authorization reverts with `InvalidQrNonce` |
| Session paused | Submission reverts with `SessionNotActive` |
| Instructor revoked | Submission reverts with `Unauthorized` |
| Signature from a different wallet | Reverts with `InvalidSignature` |

## Evidence boundary

A passing test proves the tested contract behavior under Foundry's local EVM, deterministic identities, and controlled timestamps. It does not prove:
- the deployed Sepolia bytecode matches the current source;
- Etherscan source verification or an independent audit;
- frontend wallet connection, camera scanning, or browser behavior;
- successful live Sepolia transactions or gas behavior.

The live two-wallet procedure remains a separate release gate in [END-TO-END-TESTING.md](END-TO-END-TESTING.md). Do not enter private keys or seed phrases into test fixtures, chat, or repository files.
