import asyncio
from pathlib import Path

import asyncpg
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings


@pytest.fixture
def client():
    migrations = Path(__file__).parents[1] / "migrations"

    async def prepare_database():
        connection = await asyncpg.connect(settings.database_url)
        try:
            for name in ("001_secure_identity.sql", "004_auth_rate_limits.sql"):
                await connection.execute((migrations / name).read_text(encoding="utf-8"))
            await connection.execute(
                "TRUNCATE auth_rate_limits, auth_sessions, auth_challenges, organization_memberships, users, organizations RESTART IDENTITY CASCADE"
            )
        finally:
            await connection.close()

    asyncio.run(prepare_database())
    with TestClient(app) as test_client:
        yield test_client


def issue_and_sign(client: TestClient, account):
    response = client.post("/auth/nonce", json={"address": account.address})
    assert response.status_code == 200
    challenge = response.json()
    signature = Account.sign_message(
        encode_defunct(text=challenge["message"]), private_key=account.key
    ).signature.hex()
    # HexBytes versions differ on whether .hex() includes the 0x prefix.
    if not signature.startswith("0x"):
        signature = "0x" + signature
    return challenge, signature


def test_wallet_login_and_nonce_replay_rejected(client):
    account = Account.create()
    challenge, signature = issue_and_sign(client, account)
    payload = {
        "address": account.address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": signature,
    }

    verified = client.post("/auth/verify", json=payload)
    assert verified.status_code == 200
    assert verified.json()["authenticated"] is True
    assert verified.json()["wallet_address"] == account.address.lower()
    assert client.get("/auth/me").status_code == 200

    replay = client.post("/auth/verify", json=payload)
    assert replay.status_code == 401


def test_signature_from_another_wallet_is_rejected(client):
    requested = Account.create()
    attacker = Account.create()
    challenge, _ = issue_and_sign(client, requested)
    signature = Account.sign_message(
        encode_defunct(text=challenge["message"]), private_key=attacker.key
    ).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    payload = {
        "address": requested.address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": signature,
    }
    response = client.post("/auth/verify", json=payload)
    assert response.status_code == 401


def test_expired_challenge_is_rejected(client):
    account = Account.create()
    challenge, signature = issue_and_sign(client, account)

    async def expire_challenge():
        connection = await asyncpg.connect(settings.database_url)
        try:
            await connection.execute(
                "UPDATE auth_challenges SET expires_at = now() - interval '1 minute' WHERE nonce_hash = $1",
                __import__("hashlib").sha256(challenge["nonce"].encode()).hexdigest(),
            )
        finally:
            await connection.close()

    asyncio.run(expire_challenge())
    response = client.post("/auth/verify", json={
        "address": account.address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": signature,
    })
    assert response.status_code == 401


def test_logout_requires_csrf_and_revokes_session(client):
    account = Account.create()
    challenge, signature = issue_and_sign(client, account)
    response = client.post("/auth/verify", json={
        "address": account.address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": signature,
    })
    assert response.status_code == 200
    csrf = client.cookies.get("attendance_csrf")
    assert csrf

    rejected = client.post("/auth/logout", headers={"X-CSRF-Token": "incorrect"})
    assert rejected.status_code == 403
    assert client.get("/auth/me").status_code == 200

    logged_out = client.post("/auth/logout", headers={"X-CSRF-Token": csrf})
    assert logged_out.status_code == 200
    assert client.get("/auth/me").status_code == 401


def test_nonce_rate_limit_persists_after_limit_is_reached(client):
    account = Account.create()
    statuses = [
        client.post("/auth/nonce", json={"address": account.address}).status_code
        for _ in range(6)
    ]
    assert statuses == [200, 200, 200, 200, 200, 429]

    async def inspect_limiter():
        connection = await asyncpg.connect(settings.database_url)
        try:
            row = await connection.fetchrow(
                "SELECT subject_hash, request_count FROM auth_rate_limits WHERE scope = 'nonce_wallet'"
            )
            return row
        finally:
            await connection.close()

    row = asyncio.run(inspect_limiter())
    assert row["request_count"] == 5
    assert row["subject_hash"] != account.address.lower()
    assert len(row["subject_hash"].strip()) == 64


def test_failed_signature_attempts_consume_verification_limit(client):
    account = Account.create()
    challenge, _ = issue_and_sign(client, account)
    payload = {
        "address": account.address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": "0x" + ("0" * 130),
    }
    statuses = [client.post("/auth/verify", json=payload).status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
