from datetime import datetime, timezone

from app.auth import build_siwe_message, digest


def test_nonce_digest_is_stable_and_not_plaintext():
    assert digest("sample-nonce") == digest("sample-nonce")
    assert digest("sample-nonce") != "sample-nonce"


def test_siwe_message_binds_domain_chain_and_expiry(monkeypatch):
    from app import auth
    monkeypatch.setattr(auth.settings, "siwe_domain", "attendance.example")
    monkeypatch.setattr(auth.settings, "siwe_uri", "https://attendance.example")
    monkeypatch.setattr(auth.settings, "siwe_chain_id", 11155111)
    issued = datetime(2026, 11, 24, 7, 0, tzinfo=timezone.utc)
    expires = datetime(2026, 11, 24, 7, 5, tzinfo=timezone.utc)
    message = build_siwe_message("0x" + "a" * 40, "a-secure-nonce-value", issued, expires)
    assert "attendance.example wants you to sign in" in message
    assert "Chain ID: 11155111" in message
    assert "Nonce: a-secure-nonce-value" in message
    assert "Expiration Time: 2026-11-24T07:05:00Z" in message
