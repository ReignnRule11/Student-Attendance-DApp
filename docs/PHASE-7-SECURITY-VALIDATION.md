# Phase 7 security validation

## Scope
Phase 7 adds adversarial and stateful validation. It is not an independent audit and does not establish production readiness.

## Contract properties
- Fuzzed valid expiry windows allow a registered student to check in.
- Repeated attendance by one wallet/session reverts.
- Repeated QR nonce rotations invalidate the original authorization.
- Session start is inclusive; session end is exclusive.
- Unauthorized wallets cannot pause sessions or rotate nonces.
- Revoked instructors cannot create new sessions.
- Stateful invariants check attendance flag/timestamp consistency, timestamp immutability through exposed actions, and nonzero QR nonce.

## Current trust-model decisions
- Instructor authorization is global to this deployment, not institution- or course-scoped.
- Student registration is global; any authorized instructor can revoke a registered wallet.
- Revoking an instructor blocks new instructor-only actions. The current contract still allows that instructor to manage sessions they created, and their signatures remain valid for those sessions. Resolve this policy before production.
- The contract admin is immutable and cannot be rotated. Production deployment needs a reviewed multisig/admin design.
- QR possession is not proof of physical presence.

## Execution
```bash
cd contracts
forge fmt --check
forge build --sizes
forge test -vvv
forge test --fuzz-runs 1000
```

CI runs formatting, compilation, the complete suite, and an elevated fuzz run.

## Not yet covered / release gates
- Browser tests for wallet rejection, RPC outages, failed receipts, and camera permission denial.
- Browser-to-contract integration on Anvil.
- Dependency advisory triage and lockfile reproducibility.
- Independent manual review and external audit.

No deployment, live Sepolia transaction, or audit is claimed by this phase.
