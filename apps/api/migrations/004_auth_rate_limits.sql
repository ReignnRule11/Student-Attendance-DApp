-- Atomic fixed-window limits for wallet authentication endpoints.
-- Subjects are SHA-256 digests; raw IP addresses and wallet identifiers are not stored.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    scope TEXT NOT NULL CHECK (scope IN ('nonce_ip', 'nonce_wallet', 'verify_ip', 'verify_wallet')),
    subject_hash CHAR(64) NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    PRIMARY KEY (scope, subject_hash)
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_started_at);
