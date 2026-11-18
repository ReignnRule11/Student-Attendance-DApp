# Phase 16 — Live Sepolia runtime acceptance

## Objective

Verify that the frontend running the Next.js 16 / wagmi 3 dependency baseline can interact with the already-deployed StudentAttendance contract using real injected wallets. This is a manual testnet acceptance phase: CI and local Foundry tests cannot substitute for wallet prompts, typed-data signatures, QR capture, and live transaction receipts.

## Fixed deployment target

| Item | Expected value |
|---|---|
| Network | Ethereum Sepolia |
| Chain ID | `11155111` |
| Contract | `0x66d5E20AFEA78C97BefC47FaCd462D93b888C703` |
| Explorer | [Sepolia contract](https://sepolia.etherscan.io/address/0x66d5E20AFEA78C97BefC47FaCd462D93b888C703) |
| Frontend URL | Use the actual deployed URL, or the local URL from the production build; do not assume a hosted URL exists |

## Safety and test-wallet setup

- Use test wallets only. Never use a wallet holding real funds.
- Never share a seed phrase, private key, wallet export, or signing secret in chat, an issue, a screenshot, or a repository file.
- Wallet A must be the current contract administrator and initially authorized instructor.
- Wallet B must be a separate student wallet. Register B from the instructor dashboard before check-in.
- Fund both wallets with a small amount of Sepolia test ETH.
- Keep Wallet A and Wallet B in separate browser profiles or separate devices. Confirm the active address before every signature or transaction.
- For stale-QR and revoked-instructor scenarios, prepare additional registered student/instructor test wallets before starting. Do not revoke the only instructor or student needed for the core path.
- A signature prompt is not a transaction. The instructor's EIP-712 QR signature should not spend gas; student check-in and administrative/session actions are transactions.

## Preflight gate

Record the actual frontend URL and commit before testing. Then:

1. Open the frontend over HTTPS (or use the local production server).
2. Confirm the deployment panel identifies Sepolia, displays the fixed contract address, and successfully reads deployed bytecode plus the expected ABI fields.
3. Open the contract address on Sepolia Etherscan and confirm that it has deployed bytecode.
4. Connect Wallet A and verify the wallet address shown by the wallet matches the administrator address read from the contract.
5. Confirm the wallet network is Sepolia. If it is not, use the app's network-switch flow and approve the switch in the wallet.
6. Stop if the contract address, chain, or administrator identity differs from the expected deployment.

A successful bytecode/ABI read is a deployment connectivity check, not source verification or an audit.

## Core two-wallet acceptance

### A. Register the student

1. In Wallet A's instructor dashboard, enter Wallet B's public address and register it.
2. Confirm the transaction in Wallet A.
3. Wait for a successful receipt.
4. Use the student lookup to confirm Wallet B is registered.

**Pass evidence:** registration transaction hash and a successful on-chain registration read.

### B. Create and inspect a session

1. Create a session with a start time a few minutes in the future and an end time at least 15 minutes later.
2. Confirm the transaction in Wallet A and wait for its receipt.
3. Record the session ID returned by the interface.
4. Load that session and record its instructor, start/end times, active flag, and current QR nonce.
5. Wait until the session start time has passed.

**Pass evidence:** session-creation transaction hash and session state read from Sepolia.

### C. Sign and display the QR

1. In the instructor signing panel, enter the session ID and the exact current nonce read from the contract.
2. Set expiry to a future Unix timestamp that is no later than the session end.
3. Select **Sign and generate QR**.
4. Review the EIP-712 request in Wallet A and approve it.
5. Confirm the QR is displayed and its payload identifies chain ID `11155111`, the deployed contract, the expected session ID, nonce, and expiry.

**Pass evidence:** QR displayed and payload fields match the live session. Do not publish the signature or full QR payload in public evidence.

### D. Submit as the student

1. In the separate Wallet B profile/device, connect Wallet B.
2. Confirm the app shows Wallet B and Sepolia.
3. Scan the QR. If camera permission or scanning is unavailable, use the manual payload field; this is an accepted fallback.
4. Review the payload and submit attendance.
5. Confirm the transaction in Wallet B and wait for a successful receipt.
6. Record the transaction hash and open it on Sepolia Etherscan.
7. Return to Wallet A's dashboard and query Wallet B for the same session.

**Pass evidence:** successful transaction receipt, an `AttendanceRecorded` event, and `hasAttended(sessionId, WalletB) == true`.

### E. Duplicate protection

1. Attempt to submit the same QR again using Wallet B.
2. The frontend should detect that Wallet B has already attended and prevent a second successful check-in.
3. If testing the contract revert directly, record the revert reason `AlreadyAttended`; do not repeatedly submit transactions that are expected to fail.

**Pass evidence:** no second attendance record exists for Wallet B and the same session.

## Negative and authorization scenarios

Run these after the core path, using separate test accounts where needed.

| Scenario | Procedure | Expected result |
|---|---|---|
| Unregistered wallet | Submit a valid current QR from a wallet not registered for students | Contract rejects; no attendance record |
| Expired QR | Sign a QR with an expiry in the past only if the UI allows test construction, or use a previously expired QR | Frontend pre-check or contract rejects; no attendance record |
| Stale nonce | Rotate the session nonce, then try the old QR from a different registered student who has not attended | Old QR rejected; no attendance record |
| Paused session | Pause the session, then try a current QR from a registered student who has not attended | Contract rejects; no attendance record |
| Wrong network | Switch the student wallet away from Sepolia | State-changing flow is blocked until Sepolia is selected |
| Revoked instructor | Use a session created by a non-admin test instructor, revoke that instructor as admin, then submit a previously signed QR with a registered student | Contract rejects because the session instructor is no longer authorized |

Do not mark a negative case as passed merely because the UI displays an error. Where practical, confirm the contract state did not change. For a reverted transaction, record the revert reason or explorer evidence.

## Mobile execution notes

- Use two separate wallet app/browser contexts. On one Android phone, switch accounts deliberately and verify the active address before every action; two devices are safer.
- Camera scanning generally requires a secure HTTPS origin and browser camera permission. If camera access is unavailable, paste the complete QR payload into the manual field.
- Keep the instructor QR visible on a second screen or use a second device for the student scan.
- Use the wallet's public receive address for registration. Never copy the recovery phrase or private key.
- If the frontend is not yet hosted, a production build running locally is not automatically reachable from a second device. Do not record a local-only URL as a public deployment.

## Evidence record

Copy this table into the test report and fill it only with observed values.

| Field | Observed value |
|---|---|
| Test date/time (UTC) | Pending |
| Frontend URL | Pending |
| Frontend commit SHA | Pending |
| Contract address / chain ID | Fixed target above |
| Wallet A public address | Pending |
| Wallet B public address | Pending |
| Student registration tx | Pending |
| Session creation tx | Pending |
| Session ID | Pending |
| QR signing | Pending |
| QR scan or manual entry | Pending |
| Attendance tx | Pending |
| Attendance event and state read | Pending |
| Duplicate rejection | Pending |
| Negative scenarios completed | Pending |
| Overall result | NOT RUN |

Do not include private keys, seed phrases, student names, or other personal identifiers in the evidence record.

## Exit criteria

Phase 16 is complete only when:

- the core two-wallet flow passes on Sepolia;
- the attendance transaction has a successful receipt;
- the on-chain attendance state and event agree with the frontend;
- duplicate attendance is rejected;
- each executed negative scenario has recorded evidence;
- failures and skipped cases are explicitly listed.

If no live wallet test has been performed, the correct status is **NOT RUN**. A green CI workflow, a passing Playwright homepage smoke test, or passing Foundry tests must never be represented as live Sepolia acceptance.

## Related verification

- [Automated browser and earlier live-test procedure](./END-TO-END-TESTING.md)
- [Local multi-wallet contract acceptance tests](./PHASE-12-LOCAL-ACCEPTANCE.md)
- [Sepolia deployment runbook](./DEPLOYMENT.md)
