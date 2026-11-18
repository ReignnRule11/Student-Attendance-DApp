# End-to-End Verification

## Scope and evidence levels

This project uses two distinct test levels:

1. **Automated browser smoke tests** verify that the production Next.js application renders its primary workflows and the configured Sepolia contract details. They do not connect a real wallet, sign typed data, or submit blockchain transactions.
2. **Live Sepolia acceptance testing** verifies the actual wallet-to-contract workflow with two separate wallets. Record transaction hashes and observed on-chain state for every completed step.

A passing browser smoke test is not evidence that attendance has been recorded. Do not describe the full workflow as end-to-end verified until the live acceptance test below has been completed.

## Automated browser tests

From `apps/web`:

```bash
npm install
npx playwright install chromium
npm run build
npm run test:e2e
```

The Playwright suite checks:

- Home page and core workflow headings render.
- The configured Sepolia contract address and Etherscan link are present.
- Student attendance submission is disabled when no wallet is connected.

The CI browser suite builds the production app and runs these checks in Chromium. The deployment status panel may independently report an RPC failure if the public Sepolia RPC is unavailable; the browser smoke tests deliberately do not treat an RPC outage as a UI rendering failure.

## Live Sepolia acceptance test

### Required setup

- The deployed contract: `0x66d5E20AFEA78C97BefC47FaCd462D93b888C703`.
- Wallet A: current contract administrator (also initially authorized as an instructor).
- Wallet B: a separate student wallet.
- Both wallets configured for Ethereum Sepolia and funded with a small amount of Sepolia test ETH.
- A hosted or local frontend build configured with the deployed contract address.
- A second browser profile/device for Wallet B is recommended to keep the wallet identities separate.

Never share or paste either wallet's private key or recovery phrase. Never place a private key in a frontend environment variable.

### Acceptance sequence

1. **Verify deployment**
   - Open the app and confirm the contract status panel reports bytecode and ABI reads successfully.
   - Confirm the chain is Ethereum Sepolia (chain ID `11155111`).
   - Cross-check the contract address on [Sepolia Etherscan](https://sepolia.etherscan.io/address/0x66d5E20AFEA78C97BefC47FaCd462D93b888C703).
   - Record the displayed administrator address. It should match Wallet A.

2. **Verify administrator/instructor role**
   - Connect Wallet A.
   - Confirm the dashboard shows Admin and Instructor.
   - Do not proceed if the connected account or network is unexpected.

3. **Register the student**
   - Copy Wallet B's public address from its wallet UI.
   - In Wallet A's instructor dashboard, register Wallet B.
   - Confirm the transaction in Wallet A.
   - Wait for the transaction receipt.
   - Check that Wallet B is shown as registered using the student lookup.

4. **Create an attendance session**
   - While connected as Wallet A, choose a start time a few minutes in the future and an end time sufficiently later.
   - Create the session and confirm the transaction.
   - Record the session ID from the UI and transaction receipt.
   - Load the session and confirm its instructor, time range, active state, and current QR nonce.

5. **Wait until the session starts and sign the QR**
   - Wait until the session start time has passed.
   - In the instructor signing panel, enter the confirmed session ID and current QR nonce.
   - Set an expiry in the future but no later than the session end.
   - Sign the EIP-712 message in Wallet A. This is a signature request, not an on-chain transaction.
   - Confirm the generated QR payload uses chain ID `11155111` and the deployed contract address.

6. **Submit attendance as the student**
   - Switch to the separate browser profile/device and connect Wallet B.
   - Confirm Wallet B is on Sepolia and is registered.
   - Scan the QR or paste its complete payload.
   - Submit attendance and confirm the transaction in Wallet B.
   - Wait for the receipt and record the transaction hash.
   - Confirm the UI reports attendance confirmed.

7. **Verify on-chain state**
   - Return to Wallet A's dashboard and check Wallet B against the same session ID.
   - Confirm registration is true and attendance is recorded.
   - Independently inspect the transaction receipt and `AttendanceRecorded` event on Sepolia Etherscan.

8. **Verify duplicate rejection**
   - Attempt to submit the same QR again from Wallet B.
   - The UI should pre-check and reject the duplicate. If a duplicate transaction is forced outside the UI, the contract must revert with `AlreadyAttended`.
   - No second attendance record should be created.

9. **Verify QR invalidation**
   - As Wallet A, rotate the session QR nonce.
   - Confirm the nonce increments.
   - Attempt to submit the old QR using a different registered test student wallet if available.
   - The old QR must be rejected because its nonce is stale. Do not revoke the only test student before completing the duplicate test.

10. **Record outcome**
    - Record session ID, both public wallet addresses, registration transaction hash, session-creation transaction hash, attendance transaction hash, and the duplicate/nonce rejection outcomes.
    - Do not record private keys, recovery phrases, or unnecessary student identity information.

## Acceptance criteria

| Scenario | Expected result |
|---|---|
| Wrong network | State-changing controls refuse to proceed until Sepolia is selected |
| Unregistered wallet | Contract rejects attendance |
| Valid registered student + valid instructor QR | One attendance record is created |
| Duplicate check-in | Contract rejects with `AlreadyAttended` |
| Expired QR | Contract rejects with `AuthorizationExpired` |
| Rotated QR nonce | Contract rejects old QR with `InvalidQrNonce` |
| Revoked instructor | New attendance for that instructor's sessions is rejected |
| Paused or out-of-window session | Contract rejects attendance |

## Test evidence template

| Evidence | Value |
|---|---|
| Test date/time (UTC) | Pending |
| Frontend URL and commit | Pending |
| Contract address | `0x66d5E20AFEA78C97BefC47FaCd462D93b888C703` |
| Wallet A public address | Pending |
| Wallet B public address | Pending |
| Session ID | Pending |
| Registration transaction | Pending |
| Session creation transaction | Pending |
| Attendance transaction | Pending |
| Duplicate rejection | Pending |
| Stale QR rejection | Pending |
| Overall live acceptance result | Not yet executed |

A failed scenario must be recorded as failed with its transaction/error evidence; do not silently skip it or mark it passed.
