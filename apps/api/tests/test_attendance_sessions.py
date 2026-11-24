import asyncio
from pathlib import Path

import asyncpg
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi import encode
from eth_utils import keccak
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings
import app.attendance_sessions as attendance_sessions


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
            audit_table_exists = await connection.fetchval("SELECT to_regclass('organization_audit_events') IS NOT NULL")
            if audit_table_exists:
                await connection.execute("TRUNCATE organization_audit_events")
            migrations = Path(__file__).parents[1] / "migrations"
            for migration in ("001_secure_identity.sql", "002_tenant_authorization.sql",
                              "003_membership_management.sql", "004_auth_rate_limits.sql",
                              "005_attendance_sessions.sql"):
                await connection.execute((migrations / migration).read_text(encoding="utf-8"))
            await connection.execute(
                "TRUNCATE attendance_sessions, organization_audit_events, auth_rate_limits, "
                "auth_sessions, auth_challenges, organization_memberships, users, organizations "
                "RESTART IDENTITY CASCADE"
            )
        finally:
            await connection.close()

    asyncio.run(prepare_database())
    with TestClient(app) as test_client:
        yield test_client


async def add_org(account, role):
    connection = await asyncpg.connect(settings.database_url)
    try:
        user_id = await connection.fetchval(
            "SELECT id FROM users WHERE wallet_address = $1", account.address.lower()
        )
        org_id = await connection.fetchval(
            "INSERT INTO organizations (name) VALUES ('Session Test School') RETURNING id"
        )
        await connection.execute(
            "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)",
            org_id, user_id, role,
        )
        return org_id
    finally:
        await connection.close()


def test_instructor_can_register_only_a_verified_chain_session(client, monkeypatch):
    instructor = Account.create()
    csrf = login(client, instructor)
    organization_id = asyncio.run(add_org(instructor, "instructor"))

    async def verified(*args):
        return {"starts_at": 1900000000, "ends_at": 1900003600,
                "qr_nonce": 1, "creation_block": 12345}

    monkeypatch.setattr(attendance_sessions, "verify_session_creation", verified)
    payload = {
        "session_id": "17",
        "title": "CS101 Lecture",
        "creation_tx_hash": "0x" + "a" * 64,
    }
    response = client.post(
        f"/organizations/{organization_id}/attendance-sessions",
        json=payload, headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["session_id"] == "17"
    assert body["instructor_wallet"] == instructor.address.lower()
    assert body["starts_at"] == 1900000000
    assert body["qr_nonce"] == 1

    listed = client.get(f"/organizations/{organization_id}/attendance-sessions")
    assert listed.status_code == 200
    assert len(listed.json()["sessions"]) == 1

    duplicate = client.post(
        f"/organizations/{organization_id}/attendance-sessions",
        json=payload, headers={"X-CSRF-Token": csrf},
    )
    assert duplicate.status_code == 409


def test_student_cannot_register_attendance_sessions(client, monkeypatch):
    student = Account.create()
    csrf = login(client, student)
    organization_id = asyncio.run(add_org(student, "student"))

    async def should_not_verify(*args):
        pytest.fail("Non-instructor request must be rejected before RPC verification")

    monkeypatch.setattr(attendance_sessions, "verify_session_creation", should_not_verify)
    response = client.post(
        f"/organizations/{organization_id}/attendance-sessions",
        json={"session_id": "2", "title": "Lecture", "creation_tx_hash": "0x" + "b" * 64},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 403


def test_chain_verifier_accepts_expected_session_created_event(monkeypatch):
    instructor = Account.create()
    contract = settings.attendance_contract_address.lower()
    session_id = 23
    event_topic = "0x" + keccak(text="SessionCreated(uint256,address,uint64,uint64,uint64)").hex()
    session_topic = "0x" + f"{session_id:064x}"
    instructor_topic = "0x" + ("0" * 24) + instructor.address.lower().removeprefix("0x")
    event_data = "0x" + encode(["uint64", "uint64", "uint64"], [1900000000, 1900003600, 4]).hex()
    tx_hash = "0x" + "c" * 64
    responses = [
        "0xaa36a7",
        {"to": contract, "from": instructor.address.lower()},
        {"status": "0x1", "to": contract, "blockNumber": "0x3039",
         "logs": [{"address": contract, "topics": [event_topic, session_topic, instructor_topic],
                   "data": event_data}]},
    ]

    async def fake_rpc(method, params):
        return responses.pop(0)

    monkeypatch.setattr(attendance_sessions, "_rpc", fake_rpc)
    result = asyncio.run(attendance_sessions.verify_session_creation(
        tx_hash, session_id, instructor.address.lower()
    ))
    assert result == {"starts_at": 1900000000, "ends_at": 1900003600,
                      "qr_nonce": 4, "creation_block": 12345}


def test_chain_verifier_rejects_transaction_from_another_wallet(monkeypatch):
    instructor, attacker = Account.create(), Account.create()
    contract = settings.attendance_contract_address.lower()
    responses = [
        "0xaa36a7",
        {"to": contract, "from": attacker.address.lower()},
        {"status": "0x1", "to": contract, "blockNumber": "0x1", "logs": []},
    ]

    async def fake_rpc(method, params):
        return responses.pop(0)

    monkeypatch.setattr(attendance_sessions, "_rpc", fake_rpc)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        asyncio.run(attendance_sessions.verify_session_creation(
            "0x" + "d" * 64, 1, instructor.address.lower()
        ))
    assert error.value.status_code == 403
