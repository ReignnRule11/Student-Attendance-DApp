CREATE TABLE IF NOT EXISTS attendance_sessions (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    chain_id BIGINT NOT NULL CHECK (chain_id = 11155111),
    contract_address VARCHAR(42) NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
    session_id NUMERIC(78, 0) NOT NULL CHECK (session_id > 0),
    instructor_wallet VARCHAR(42) NOT NULL CHECK (instructor_wallet ~ '^0x[0-9a-f]{40}$'),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 160),
    starts_at BIGINT NOT NULL,
    ends_at BIGINT NOT NULL CHECK (ends_at > starts_at),
    qr_nonce BIGINT NOT NULL CHECK (qr_nonce > 0),
    creation_tx_hash VARCHAR(66) NOT NULL UNIQUE CHECK (creation_tx_hash ~ '^0x[0-9a-f]{64}$'),
    creation_block BIGINT NOT NULL,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain_id, contract_address, session_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_org_created
    ON attendance_sessions(organization_id, created_at DESC);

ALTER TABLE organization_audit_events
    DROP CONSTRAINT IF EXISTS organization_audit_events_event_type_check;
ALTER TABLE organization_audit_events
    ADD CONSTRAINT organization_audit_events_event_type_check
    CHECK (event_type IN (
        'organization.bootstrapped',
        'membership.role_changed',
        'membership.revoked',
        'membership.reactivated',
        'attendance.session_registered'
    ));
