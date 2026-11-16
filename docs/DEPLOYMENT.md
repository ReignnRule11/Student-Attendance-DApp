# Deployment guide

## Current status

The contract is intended for Ethereum Sepolia. It has not been deployed by this repository setup. Do not publish an address until a deployment transaction has succeeded and the resulting bytecode has been verified.

## Prerequisites

- Foundry installed.
- A Sepolia RPC endpoint.
- A dedicated Sepolia deployer wallet funded with test ETH.
- A block-explorer API key if explorer verification is desired.

## Local validation

From the repository root:

```bash
cd contracts
forge fmt --check
forge build --sizes
forge test -vvv
```

## Environment

Set secrets in your local shell or CI secret store. Never commit them.

```bash
export SEPOLIA_RPC_URL="https://your-sepolia-rpc"
export DEPLOYER_PRIVATE_KEY="your-test-wallet-private-key"
```

Do not paste private keys into chat, source files, command history, or frontend environment variables.

## Deployment

A deployment script will be added after contract tests and review are complete. Before deployment, confirm the selected RPC reports chain ID `11155111`, confirm the deployer address, and review the constructor/admin model. After deployment, record the transaction hash, contract address, chain ID, compiler version, and verified source URL in a deployment record.

## Post-deployment checks

- Confirm the contract address and chain ID.
- Confirm the deployer is the expected administrator and is authorized as an instructor.
- Grant instructor roles deliberately; do not expose admin operations in student UI.
- Run a complete session flow with test wallets.
- Verify source code and compiler settings on the explorer.
- Keep the admin key separate from application users and monitor privileged events.
