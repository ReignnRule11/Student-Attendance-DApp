# Wallet identity and organization authorization

The server issues a five-minute wallet challenge and verifies the exact EIP-191
message. The signature is recovered and bound to the requested wallet address.
The message binds domain, URI, chain ID, nonce, issued-at and expiration values.

Apply migrations in numeric order before deployment:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_secure_identity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_tenant_authorization.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_membership_management.sql
```

## Authentication routes

- `POST /auth/nonce`: issue one-time challenge.
- `POST /auth/verify`: verify signature, consume challenge and create session.
- `GET /auth/me`: return wallet and active organization memberships.
- `POST /auth/logout`: revoke session; requires CSRF cookie echoed in
  `X-CSRF-Token`.

Opaque session tokens are random; only SHA-256 digests are stored. The session
cookie is HttpOnly. Production/staging cookies are Secure. Set explicit
`SIWE_DOMAIN` and `SIWE_URI`. Do not use wildcard origins with credentialed requests.

## Organization routes

- `POST /organizations/bootstrap`: one-time first-organization provisioning.
  Requires an authenticated session, matching CSRF cookie/header, and the
  deployment-only `X-Org-Bootstrap-Secret`. Invoke this route only from a trusted
  operator-controlled environment; never expose the bootstrap secret to browser code.
- `GET /organizations/{id}/workspace`: requires active membership.
- `GET /organizations/{id}/admin`: requires active owner/admin membership.
- `GET /organizations/{id}/members`: owner/admin member directory.
- `PUT /organizations/{id}/members/{wallet_address}`: add an already-authenticated
  wallet, change its role, or reactivate its revoked membership. Requires CSRF.
- `DELETE /organizations/{id}/members/{wallet_address}`: revoke an active
  membership. Requires CSRF.

Only authenticated wallets can be added; invitations and email delivery are not
implemented. Owners may grant admin, instructor, student, or viewer roles. Admins
may grant only instructor, student, or viewer. Neither role can change or revoke
the owner; self-role changes and self-revocation are rejected. Owner transfer is
a separate future workflow. Reactivation updates the existing unique membership
row rather than inserting a duplicate.

Membership authorization is resolved from PostgreSQL using both organization ID
and authenticated user ID. Request-supplied role values are validated against the
role policy and never trusted as actor permissions. Non-members and revoked
memberships receive 404 to avoid disclosing tenant existence; insufficient roles
receive 403. Bootstrap and membership mutations write append-only audit events.

Academic APIs, attendance APIs, invitation workflows, rate limiting and production
migration execution remain out of scope for this phase. Blockchain attendance
remains authoritative.
