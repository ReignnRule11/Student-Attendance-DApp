ALTER TABLE organization_audit_events
    DROP CONSTRAINT IF EXISTS organization_audit_events_event_type_check;
ALTER TABLE organization_audit_events
    ADD CONSTRAINT organization_audit_events_event_type_check
    CHECK (event_type IN (
        'organization.bootstrapped',
        'membership.role_changed',
        'membership.revoked',
        'membership.reactivated'
    ));
