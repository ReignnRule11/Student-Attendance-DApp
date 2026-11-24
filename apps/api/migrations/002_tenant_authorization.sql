CREATE TABLE IF NOT EXISTS organization_audit_events (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('organization.bootstrapped')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_audit_events_org_created
    ON organization_audit_events(organization_id, created_at DESC);

-- Prevent ordinary application roles from rewriting or deleting audit history.
CREATE OR REPLACE FUNCTION reject_organization_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'organization audit events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS organization_audit_no_update ON organization_audit_events;
CREATE TRIGGER organization_audit_no_update
    BEFORE UPDATE OR DELETE ON organization_audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_organization_audit_mutation();
