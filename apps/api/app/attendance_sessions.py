import re
from decimal import Decimal
from typing import Any

import asyncpg
import httpx
from eth_abi import decode
from eth_utils import keccak
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import CSRF_COOKIE, connect, current_session
from app.organizations import require_csrf, require_org_membership
from app.settings import settings

router = APIRouter(prefix="/organizations", tags=["attendance sessions"])
SESSION_CREATED_TOPIC = "0x" + keccak(text="SessionCreated(uint256,address,uint64,uint64,uint64)").hex()


class SessionRegistration(BaseModel):
    session_id: str = Field(pattern=r"^[1-9][0-9]{0,77}$")
    title: str = Field(min_length=2, max_length=160)
    creation_tx_hash: str = Field(pattern=r"^0x[a-fA-F0-9]{64}$")


def _word_address(topic: str) -> str:
    raw = topic.removeprefix("0x")
    if len(raw) != 64:
        raise ValueError("Invalid indexed address")
    return "0x" + raw[-40:].lower()


async def _rpc(method: str, params: list[Any]) -> Any:
    if not settings.sepolia_rpc_url:
        raise HTTPException(status_code=503, detail="Sepolia RPC is not configured")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                settings.sepolia_rpc_url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail="Sepolia RPC request failed")
    if not isinstance(payload, dict) or payload.get("error") or "result" not in payload:
        raise HTTPException(status_code=502, detail="Sepolia RPC returned an invalid response")
    return payload["result"]


async def verify_session_creation(tx_hash: str, session_id: int, instructor_wallet: str) -> dict[str, int]:
    contract = (settings.attendance_contract_address or "").lower()
    if not re.fullmatch(r"0x[a-f0-9]{40}", contract):
        raise HTTPException(status_code=503, detail="Attendance contract is not configured correctly")

    chain_id = await _rpc("eth_chainId", [])
    try:
        if int(chain_id, 16) != 11155111:
            raise HTTPException(status_code=503, detail="Configured RPC is not Ethereum Sepolia")
    except (TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Sepolia RPC returned an invalid chain ID")

    tx = await _rpc("eth_getTransactionByHash", [tx_hash])
    receipt = await _rpc("eth_getTransactionReceipt", [tx_hash])
    if not tx or not receipt:
        raise HTTPException(status_code=422, detail="Session creation transaction was not found")
    if receipt.get("status") != "0x1":
        raise HTTPException(status_code=422, detail="Session creation transaction failed")
    if (tx.get("to") or "").lower() != contract or (receipt.get("to") or "").lower() != contract:
        raise HTTPException(status_code=422, detail="Transaction does not target the configured attendance contract")
    if (tx.get("from") or "").lower() != instructor_wallet.lower():
        raise HTTPException(status_code=403, detail="Transaction sender does not match the authenticated instructor")

    expected_session = f"0x{session_id:064x}"
    for log in receipt.get("logs", []):
        topics = log.get("topics", [])
        if (log.get("address") or "").lower() != contract or len(topics) != 3:
            continue
        if topics[0].lower() != SESSION_CREATED_TOPIC.lower() or topics[1].lower() != expected_session.lower():
            continue
        try:
            event_instructor = _word_address(topics[2])
            starts_at, ends_at, qr_nonce = decode(
                ["uint64", "uint64", "uint64"], bytes.fromhex(log["data"].removeprefix("0x"))
            )
            block_number = int(receipt["blockNumber"], 16)
        except (ValueError, KeyError, TypeError):
            raise HTTPException(status_code=502, detail="SessionCreated event data is malformed")
        if event_instructor != instructor_wallet.lower():
            raise HTTPException(status_code=403, detail="SessionCreated event instructor mismatch")
        if starts_at >= ends_at or qr_nonce <= 0:
            raise HTTPException(status_code=422, detail="SessionCreated event contains invalid session values")
        return {
            "starts_at": int(starts_at), "ends_at": int(ends_at),
            "qr_nonce": int(qr_nonce), "creation_block": block_number,
        }
    raise HTTPException(status_code=422, detail="Transaction does not contain the expected SessionCreated event")


@router.post("/{organization_id}/attendance-sessions", status_code=201)
async def register_attendance_session(
    organization_id: int,
    payload: SessionRegistration,
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
    membership=Depends(require_org_membership("owner", "admin", "instructor")),
    session=Depends(current_session),
):
    require_csrf(session, csrf_cookie, csrf_header)
    session_id = int(payload.session_id)
    if session_id > (2**256 - 1):
        raise HTTPException(status_code=422, detail="Session ID exceeds uint256")
    verified = await verify_session_creation(
        payload.creation_tx_hash, session_id, session["wallet_address"]
    )
    contract = settings.attendance_contract_address.lower()
    connection = await connect()
    try:
        async with connection.transaction():
            row = await connection.fetchrow(
            """INSERT INTO attendance_sessions
               (organization_id, chain_id, contract_address, session_id, instructor_wallet,
                title, starts_at, ends_at, qr_nonce, creation_tx_hash, creation_block, created_by)
               VALUES ($1, 11155111, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               RETURNING id, organization_id, chain_id, contract_address, session_id,
                         instructor_wallet, title, starts_at, ends_at, qr_nonce,
                         creation_tx_hash, creation_block, created_at""",
            organization_id, contract, Decimal(session_id), session["wallet_address"],
            payload.title.strip(), Decimal(verified["starts_at"]), Decimal(verified["ends_at"]),
            Decimal(verified["qr_nonce"]), payload.creation_tx_hash.lower(),
            verified["creation_block"], session["user_id"],
            )
            await connection.execute(
                """INSERT INTO organization_audit_events
                   (organization_id, actor_user_id, event_type, metadata)
                   VALUES ($1, $2, 'attendance.session_registered',
                     jsonb_build_object('session_id', $3::text, 'tx_hash', $4::text))""",
                organization_id, session["user_id"], str(session_id), payload.creation_tx_hash.lower(),
            )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="This on-chain session or transaction is already registered")
    finally:
        await connection.close()
    result = dict(row)
    result["session_id"] = str(result["session_id"])
    for field in ("starts_at", "ends_at", "qr_nonce"):
        result[field] = int(result[field])
    return result


@router.get("/{organization_id}/attendance-sessions")
async def list_attendance_sessions(
    organization_id: int,
    membership=Depends(require_org_membership()),
):
    connection = await connect()
    try:
        rows = await connection.fetch(
            """SELECT id, organization_id, chain_id, contract_address, session_id,
                      instructor_wallet, title, starts_at, ends_at, qr_nonce,
                      creation_tx_hash, creation_block, created_at
               FROM attendance_sessions
               WHERE organization_id = $1
               ORDER BY created_at DESC, id DESC""",
            organization_id,
        )
    finally:
        await connection.close()
    sessions = []
    for row in rows:
        item = dict(row)
        item["session_id"] = str(item["session_id"])
        for field in ("starts_at", "ends_at", "qr_nonce"):
            item[field] = int(item[field])
        sessions.append(item)
    return {"organization_id": organization_id, "sessions": sessions}
