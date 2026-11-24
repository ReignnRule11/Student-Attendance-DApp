# Wallet identity and organization authorization

The server issues a five-minute challenge and exact EIP-191 message. The signature
is recovered and bound to the requested wallet address. The message binds domain,
URI, chain ID, nonce, issued-at and expiration values.

Apply migrations in numeric order before deployment:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_secure_identity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_tenant_authorization.sql
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

- `POST /organizations/bootstrap`: creates the first organization only. Requires
  an authenticated session, matching CSRF cookie/header, and
  `X-Org-Bootstrap-Secret` matching the deployment-only `ORG_BOOTSTRAP_SECRET`.
  The bootstrap is serialized with a PostgreSQL advisory transaction lock; only
  one organization can be initialized through this route. The creator becomes owner.
- `GET /organizations/{id}/workspace`: requires active membership.
- `GET /organizations/{id}/admin`: requires active owner/admin membership.

Membership is resolved from PostgreSQL using both organization ID and authenticated
user ID. Request-supplied role values are never trusted. Non-members and revoked
memberships receive 404 to avoid disclosing tenant existence; insufficient roles
receive 403. Bootstrap writes an append-only audit event.

The bootstrap secret must be generated and configured through deployment secrets;
never commit it or expose it to browser code. This endpoint is for initial system
provisioning, not routine school onboarding. Membership invitation/management,
academic APIs, and attendance APIs remain out of scope for this phase. Blockchain
attendance remains authoritative.
