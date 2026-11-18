# Sepolia deployment guide

## Deployment status

The contract has been deployed to Ethereum Sepolia by the guarded GitHub Actions workflow.

- Network: Ethereum Sepolia (chain ID `11155111`)
- Contract: [`0x66d5E20AFEA78C97BefC47FaCd462D93b888C703`](https://sepolia.etherscan.io/address/0x66d5E20AFEA78C97BefC47FaCd462D93b888C703)
- Deployment workflow: [run #23 — successful](https://github.com/ReignnRule11/Student-Attendance-DApp/actions/runs/44317302407)

The workflow completed the Foundry validation suite and reported successful on-chain execution. The frontend is configured with this address and checks runtime bytecode plus `admin()` and `nextSessionId()` reads. Etherscan source verification and live browser end-to-end tests remain separate release tasks.

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

Wait for explorer verification to complete. Confirm the verified source, compiler version, optimizer settings, constructor arguments (none), and deployed bytecode match the local build. Do not describe the source as verified until Etherscan explicitly reports successful verification.

## Post-deployment validation

1. Confirm the explorer network is Sepolia and the contract address matches the broadcast receipt.
2. Read `admin()`, `pendingAdmin()`, and `instructors(admin)`; the admin should identify the expected deployer, pending admin should be the zero address, and the instructor flag should be true.
3. Read `nextSessionId()`; the initial value should be `1`.
4. Set `NEXT_PUBLIC_CONTRACT_ADDRESS=0x66d5E20AFEA78C97BefC47FaCd462D93b888C703` in the web deployment environment. This is already the value in the repository's `.env.example`. Set `NEXT_PUBLIC_SEPOLIA_RPC_URL` only to a browser-safe public RPC endpoint.
5. Use separate test wallets to authorize an instructor, register a student, create a short test session, sign a QR authorization, and submit attendance. Confirm the receipt and event on Sepolia Etherscan.
6. Test duplicate attendance, expired QR, rotated nonce, unregistered student, and session boundary rejection.
7. Record the deployment transaction hash, block number, contract address, chain ID, deployer/admin address, compiler version, optimizer settings, verification URL, and test results in the project release record.

## Operational cautions

- Administrator transfer is two-step, not key recovery. If the current admin key is lost before proposing a transfer, governance actions cannot be performed. Protect the current admin wallet and rehearse handover with test wallets.
- Do not expose admin actions to student accounts.
- Wallet addresses and attendance transactions are public and pseudonymous, not anonymous.
- QR possession is not proof of physical presence.
- A successful Sepolia deployment is a testnet milestone, not production readiness or an independent security audit.
