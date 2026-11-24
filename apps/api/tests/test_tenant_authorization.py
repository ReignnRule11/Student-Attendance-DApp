import asyncio
from pathlib import Path

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
        "address": account.address, "nonce": challenge["nonce"],
        "message": challenge["message"], "signature": signature,
    })
    assert response.status_code == 200
    return client.cookies.get("attendance_csrf")


@pytest.fixture
def client():
    async def prepare_database():
        connection = await asyncpg.connect(settings.database_url)
        try:
            migrations = Path(__file__).parents[1] / "migrations"
            for migration in ("001_secure_identity.sql", "002_tenant_authorization.sql",
                              "003_membership_management.sql", "004_auth_rate_limits.sql", "005_attendance_sessions.sql"):
                await connection.execute((migrations / migration).read_text(encoding="utf-8"))
            await connection.execute(
                "TRUNCATE attendance_sessions, organization_audit_events, auth_rate_limits, auth_sessions, auth_challenges, organization_memberships, users, organizations RESTART IDENTITY CASCADE"
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

    async def count_audit_events():
        connection = await asyncpg.connect(settings.database_url)
        try:
            return await connection.fetchval("SELECT count(*) FROM organization_audit_events")
        finally:
            await connection.close()
    assert asyncio.run(count_audit_events()) == 1


def test_tenant_isolation_and_role_enforcement(client):
    student, other = Account.create(), Account.create()
    login(client, student)
    student_org = asyncio.run(insert_org_and_membership(student, role="student"))
    login(client, other)
    other_org = asyncio.run(insert_org_and_membership(other, role="owner"))
    login(client, student)
    assert client.get(f"/organizations/{student_org}/workspace").status_code == 200
    assert client.get(f"/organizations/{other_org}/workspace").status_code == 404
    assert client.get(f"/organizations/{student_org}/admin").status_code == 403


def test_revoked_membership_cannot_access_workspace(client):
    account = Account.create()
    login(client, account)
    organization_id = asyncio.run(insert_org_and_membership(account, role="owner", revoked=True))
    assert client.get(f"/organizations/{organization_id}/workspace").status_code == 404


def test_owner_can_manage_members_and_admin_cannot_escalate(client):
    owner, admin, student, outsider = (Account.create() for _ in range(4))
    owner_csrf = login(client, owner)
    organization_id = asyncio.run(insert_org_and_membership(owner, role="owner"))
    login(client, admin)
    asyncio.run(add_membership_fixture(organization_id, admin, "admin"))
    login(client, student)
    asyncio.run(add_membership_fixture(organization_id, student, "student"))
    owner_csrf = login(client, owner)
    headers = {"X-CSRF-Token": owner_csrf}

    granted = client.put(
        f"/organizations/{organization_id}/members/{admin.address}",
        json={"role": "admin"}, headers=headers,
    )
    assert granted.status_code == 200
    assert client.get(f"/organizations/{organization_id}/members").status_code == 200

    # An admin can add lower-privilege roles, but cannot grant admin.
    admin_csrf = login(client, admin)
    escalated = client.put(
        f"/organizations/{organization_id}/members/{outsider.address}",
        json={"role": "admin"}, headers={"X-CSRF-Token": admin_csrf},
    )
    assert escalated.status_code == 403

    # Authenticate outsider first so their wallet exists, then restore the admin session.
    login(client, outsider)
    admin_csrf = login(client, admin)
    lower_role = client.put(
        f"/organizations/{organization_id}/members/{outsider.address}",
        json={"role": "student"}, headers={"X-CSRF-Token": admin_csrf},
    )
    assert lower_role.status_code == 200

    # An admin cannot revoke the owner.
    admin_csrf = login(client, admin)
    protected = client.delete(
        f"/organizations/{organization_id}/members/{owner.address}",
        headers={"X-CSRF-Token": admin_csrf},
    )
    assert protected.status_code == 403


async def add_membership_fixture(organization_id, account, role):
    connection = await asyncpg.connect(settings.database_url)
    try:
        user_id = await connection.fetchval(
            "SELECT id FROM users WHERE wallet_address = $1", account.address.lower()
        )
        await connection.execute(
            """INSERT INTO organization_memberships (organization_id, user_id, role)
               VALUES ($1, $2, $3)""", organization_id, user_id, role,
        )
    finally:
        await connection.close()


def test_revoke_reactivate_and_audit_history(client):
    owner, member = Account.create(), Account.create()
    owner_csrf = login(client, owner)
    organization_id = asyncio.run(insert_org_and_membership(owner, role="owner"))
    login(client, member)
    asyncio.run(add_membership_fixture(organization_id, member, "student"))
    owner_csrf = login(client, owner)

    revoke = client.delete(
        f"/organizations/{organization_id}/members/{member.address}",
        headers={"X-CSRF-Token": owner_csrf},
    )
    assert revoke.status_code == 200
    assert client.get(f"/organizations/{organization_id}/workspace").status_code == 200
    login(client, member)
    assert client.get(f"/organizations/{organization_id}/workspace").status_code == 404

    owner_csrf = login(client, owner)
    reactivate = client.put(
        f"/organizations/{organization_id}/members/{member.address}",
        json={"role": "instructor"},
        headers={"X-CSRF-Token": owner_csrf},
    )
    assert reactivate.status_code == 200
    login(client, member)
    assert client.get(f"/organizations/{organization_id}/workspace").json()["role"] == "instructor"

    async def read_events():
        connection = await asyncpg.connect(settings.database_url)
        try:
            return await connection.fetch(
                "SELECT event_type FROM organization_audit_events WHERE organization_id = $1 ORDER BY id",
                organization_id,
            )
        finally:
            await connection.close()
    events = [row["event_type"] for row in asyncio.run(read_events())]
    assert events == ["membership.revoked", "membership.reactivated"]
