# Database migrations

Apply SQL migrations in numeric order against the configured PostgreSQL database.
For the identity foundation run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_secure_identity.sql
```

Do not expose authentication routes in a deployed environment until this migration
has been applied. Migration execution is intentionally not performed automatically
by application startup.
