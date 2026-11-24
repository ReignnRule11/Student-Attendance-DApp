# Secure wallet identity

The server issues a five-minute challenge and exact EIP-191 message. The signature
is recovered and bound to the requested wallet address. The message binds domain,
URI, chain ID, nonce, issued-at and expiration values.

Apply the schema before deployment:
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_secure_identity.sql`

Routes:
- `POST /auth/nonce`: issue one-time challenge.
- `POST /auth/verify`: verify signature, consume challenge and create session.
- `GET /auth/me`: return wallet and active organization memberships.
- `POST /auth/logout`: revoke session; requires CSRF cookie echoed in
  `X-CSRF-Token`.

Opaque session tokens are random; only SHA-256 digests are stored. The session
cookie is HttpOnly. Production/staging cookies are Secure. Set an explicit
SIWE_DOMAIN and SIWE_URI. Do not use wildcard origins with credentialed requests.

Organization onboarding and membership mutation are not exposed. New wallets have
no organization privileges until an authorized workflow grants membership. No
academic or attendance endpoints are exposed in this phase. Blockchain attendance
remains authoritative.
