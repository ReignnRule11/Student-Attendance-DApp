# Sepolia deployment guide

## Deployment status

The repository contains a Sepolia-only deployment script. **No live deployment is performed by CI or by opening this pull request.** Do not configure the frontend contract address until a deployment transaction has succeeded and the deployed bytecode has been verified.

## Release gates before using a real deployment wallet

- Review the two-step administrator handover. The current admin proposes a non-zero address; only that pending address can accept. The accepting admin is also granted instructor access. The previous admin retains instructor access until the new admin explicitly revokes it.
- Confirm instructor revocation blocks new attendance for that instructor's sessions and prevents the revoked instructor from pausing/resuming or rotating those sessions. Existing attendance records remain unchanged.
- Complete dependency advisory triage and browser/Anvil integration testing before treating the application as production-ready.
- Use a dedicated Sepolia-only deployer wallet. Fund it only with test ETH and keep its private key out of source control, chat, frontend variables, and shell history.
- Confirm the RPC endpoint reports chain ID `11155111` and independently confirm the deployer address before broadcasting.

These are testnet deployment gates, not a claim that the contract has been independently audited.

## Prerequisites

- Foundry installed and available on PATH.
- A Sepolia RPC endpoint.
- A dedicated deployer wallet funded with Sepolia test ETH.
- An Etherscan API key for source verification.

## Validate first

From the repository root:

```bash
cd contracts
forge fmt --check
forge build --sizes
forge test -vvv
forge test --fuzz-runs 1000
```

All commands must pass before deployment. The GitHub Contracts CI workflow runs these checks for contract changes.

## Configure environment

Set values in your local shell or a trusted secret manager. Do not commit a populated `.env` file.

```bash
export SEPOLIA_RPC_URL="https://your-sepolia-rpc"
export DEPLOYER_PRIVATE_KEY="your-sepolia-test-wallet-private-key"
export EXPECTED_DEPLOYER_ADDRESS="0xYourExpectedDeployerAddress"
export ETHERSCAN_API_KEY="your-etherscan-api-key"
```

`EXPECTED_DEPLOYER_ADDRESS` is an additional safety check. The script refuses to broadcast if the private key resolves to a different address. The script also refuses to run on any chain other than Sepolia.

Never paste a private key or seed phrase into chat. Do not use a wallet holding mainnet assets.

## Deploy

From the `contracts` directory:

```bash
forge script script/DeployStudentAttendance.s.sol:DeployStudentAttendance \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast
```

Review the Foundry output and broadcast transaction. The script emits `ContractDeployed` with the contract address, admin address, and chain ID. Save the deployment transaction hash and contract address from the broadcast output.

Do not run this command until the release gates above have been reviewed. The script does not store or publish secrets.

## Verify source on Sepolia Etherscan

From the `contracts` directory, after confirming the deployed address:

```bash
export CONTRACT_ADDRESS="0xYourDeployedContractAddress"
forge verify-contract "$CONTRACT_ADDRESS" \
  src/StudentAttendance.sol:StudentAttendance \
  --chain sepolia \
  --etherscan-api-key "$ETHERSCAN_API_KEY"
```

Wait for explorer verification to complete. Confirm the verified source, compiler version, optimizer settings, constructor arguments (none), and deployed bytecode match the local build.

## Post-deployment validation

1. Confirm the explorer network is Sepolia and the contract address matches the broadcast receipt.
2. Read `admin()`, `pendingAdmin()`, and `instructors(admin)`; the admin should identify the expected deployer, pending admin should be the zero address, and the instructor flag should be true.
3. Read `nextSessionId()`; the initial value should be `1`.
4. Set `NEXT_PUBLIC_CONTRACT_ADDRESS` to the verified address in the web deployment environment. Set `NEXT_PUBLIC_SEPOLIA_RPC_URL` only to a public RPC endpoint intended for browser use.
5. Use separate test wallets to authorize an instructor, register a student, create a short test session, sign a QR authorization, and submit attendance. Confirm the receipt and event on Sepolia Etherscan.
6. Test duplicate attendance, expired QR, rotated nonce, unregistered student, and session boundary rejection.
7. Record the deployment transaction hash, block number, contract address, chain ID, deployer/admin address, compiler version, optimizer settings, verification URL, and test results in the project release record.

## Operational cautions

- Administrator transfer is two-step, not key recovery. If the current admin key is lost before proposing a transfer, governance actions cannot be performed. Protect the current admin wallet and rehearse handover with test wallets.
- Do not expose admin actions to student accounts.
- Wallet addresses and attendance transactions are public and pseudonymous, not anonymous.
- QR possession is not proof of physical presence.
- A successful Sepolia deployment is a testnet milestone, not production readiness or an independent security audit.
