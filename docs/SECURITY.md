# Security model and threat considerations

## Contract trust boundaries

The contract is the enforcement boundary. Client-side checks are convenience only and must never be relied on to authorize instructors, register students, validate QR codes, or prevent duplicate attendance.

### Authorization

- The deployer is the immutable administrator.
- Only the administrator can grant or revoke instructor privileges.
- Only an authorized instructor can register or revoke students.
- Only the instructor who created a session or the administrator can pause/resume it or rotate its QR nonce.
- Only registered students can submit attendance.

## QR authorization

The QR signature uses EIP-712 typed data:

```text
AttendanceAuthorization(
  uint256 sessionId,
  uint256 qrNonce,
  uint256 expiresAt
)
```

The domain is:

- name: `StudentAttendance`
- version: `1`
- chainId: current `block.chainid`
- verifyingContract: this contract address

The contract verifies the signature against the instructor recorded on the session. The QR expiry must not be in the past or later than the session end. Rotating the session nonce invalidates all previously issued QR authorizations for that session.

The same valid QR is intentionally usable by multiple registered students. Per-student, per-session attendance state prevents an individual student from submitting twice. The contract does not implement global one-time QR consumption because that would allow the first student to invalidate the code for everyone else.

## Threats addressed

- Unauthorized instructor management and session creation.
- Unregistered or revoked students.
- Duplicate attendance.
- Expired QR authorizations.
- Forged signatures and malformed/malleable ECDSA signatures.
- Cross-session replay.
- Cross-chain replay through the EIP-712 chain ID.
- Old QR replay after instructor nonce rotation.
- Paused or out-of-window sessions.

## Residual risks and limitations

- **QR sharing does not prove physical presence.** A student can photograph or forward a QR code. Short expiries, frequent nonce rotation, and instructor supervision reduce but do not eliminate this risk.
- The administrator is a privileged trust anchor. Production deployments should consider multisig administration and documented key-recovery procedures.
- Wallet addresses are pseudonymous, not anonymous. On-chain attendance and transaction metadata are public and persistent.
- Student registration and revocation are currently global rather than scoped to a course or institution.
- Attendance is append-only in this contract: there is no delete or edit function. Incorrect records require an explicit, separately designed correction process rather than silent mutation.
- A student pays the transaction gas for submitting attendance on Sepolia/mainnet.
- Smart-contract review and independent audit are required before handling consequential attendance records.

## Operational controls

- Keep deployer/admin keys in a secure wallet; never place private keys or seed phrases in the repository or frontend environment.
- Use a separate test wallet on Sepolia.
- Verify the deployed bytecode and constructor configuration on a block explorer.
- Do not put names, emails, student numbers, or other direct identifiers in transaction calldata, events, or contract storage.
