import asyncio

import asyncpg
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings


async def insert_org_and_membership(account, role="student", revoked=False):
    connection = await asyncpg.connect(settings.database_url)
    try:
        user_id = await connection.fetchval(
            "SELECT id FROM users WHERE wallet_address = $1", account.address.lower()
        )
        organization_id = await connection.fetchval(
            "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
            f"Tenant {account.address[-6:]}",
        )
        await connection.execute(
            """INSERT INTO organization_memberships
               (organization_id, user_id, role, revoked_at)
               VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)""",
            organization_id, user_id, role, revoked,
        )
        return organization_id
    finally:
        await connection.close()


def login(client, account):
    challenge_response = client.post("/auth/nonce", json={"address": account.address})
    assert challenge_response.status_code == 200
    challenge = challenge_response.json()
    signature = Account.sign_message(
        encode_defunct(text=challenge["message"]), private_key=account.key
    ).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature
    response = client.post("/auth/verify", json={
        "address": account.address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": signature,
    })
    assert response.status_code == 200
    return client.cookies.get("attendance_csrf")


@pytest.fixture
def client():
    async def prepare_database():
        connection = await asyncpg.connect(settings.database_url)
        try:
            migrations = __import__("pathlib").Path(__file__).parents[1] / "migrations"
            await connection.execute((migrations / "001_secure_identity.sql").read_text(encoding="utf-8"))
            await connection.execute((migrations / "002_tenant_authorization.sql").read_text(encoding="utf-8"))
            await connection.execute(
                "TRUNCATE organization_audit_events, auth_sessions, auth_challenges, organization_memberships, users, organizations RESTART IDENTITY CASCADE"
            )
        finally:
            await connection.close()

    asyncio.run(prepare_database())
    with TestClient(app) as test_client:
        yield test_client


def test_bootstrap_requires_secret_csrf_and_is_one_time(client, monkeypatch):
    monkeypatch.setattr(settings, "org_bootstrap_secret", "test-only-bootstrap-secret")
    account = Account.create()
    csrf = login(client, account)
    payload = {"name": "First School"}

    denied = client.post("/organizations/bootstrap", json=payload, headers={
        "X-Org-Bootstrap-Secret": "wrong", "X-CSRF-Token": csrf,
    })
    assert denied.status_code == 403

    no_csrf = client.post("/organizations/bootstrap", json=payload, headers={
        "X-Org-Bootstrap-Secret": "test-only-bootstrap-secret",
    })
    assert no_csrf.status_code == 403

    created = client.post("/organizations/bootstrap", json=payload, headers={
        "X-Org-Bootstrap-Secret": "test-only-bootstrap-secret", "X-CSRF-Token": csrf,
    })
    assert created.status_code == 201
    organization_id = created.json()["organization_id"]
    assert client.get(f"/organizations/{organization_id}/admin").status_code == 200

    second = client.post("/organizations/bootstrap", json={"name": "Second School"}, headers={
        "X-Org-Bootstrap-Secret": "test-only-bootstrap-secret", "X-CSRF-Token": csrf,
    })
    assert second.status_code == 409

    connection = asyncio.run(asyncpg.connect(settings.database_url))
    try:
        events = await connection.fetchval("SELECT count(*) FROM organization_audit_events")
        assert events == 1
    finally:
        await connection.close()


def test_tenant_isolation_and_role_enforcement(client):
    student = Account.create()
    other = Account.create()
    login(client, student)
    student_org = asyncio.run(insert_org_and_membership(student, role="student"))
    other_org = asyncio.run(insert_org_and_membership(other, role="owner"))

    own = client.get(f"/organizations/{student_org}/workspace")
    assert own.status_code == 200
    assert own.json()["role"] == "student"
    assert client.get(f"/organizations/{other_org}/workspace").status_code == 404
    assert client.get(f"/organizations/{student_org}/admin").status_code == 403


def test_revoked_membership_cannot_access_workspace(client):
    account = Account.create()
    login(client, account)
    organization_id = asyncio.run(insert_org_and_membership(account, role="owner", revoked=True))
    assert client.get(f"/organizations/{organization_id}/workspace").status_code == 404
