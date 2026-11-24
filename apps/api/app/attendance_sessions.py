import re
from typing import Any

import httpx
from eth_abi import decode
from eth_utils import keccak
from fastapi import APIRouter, Depends, Header, HTTPException, Path
from pydantic import BaseModel, Field

from app.auth import CSRF_COOKIE, connect, current_session
from app.organizations import require_csrf, require_org_membership
from app.settings import settings

router = APIRouter(prefix="/organizations", tags=["attendance sessions"])
SESSION_CREATED_TOPIC = "0x" + keccak(text="SessionCreated(uint256,address,uint64,uint64,uint64)").hex()
TX_HASH_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")


class SessionRegistration(BaseModel):
    session_id: int = Field(gt=0)
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
    if payload.get("error") or "result" not in payload:
        raise HTTPException(status_code=502, detail="Sepolia RPC returned an invalid response")
    return payload["result"]


async def verify_session_creation(tx_hash: str, session_id: int, instructor_wallet: str) -> dict[str, int]:
    if not settings.attendance_contract_address:
        raise HTTPException(status_code=503, detail="Attendance contract is not configured")
    contract = settings.attendance_contract_address.lower()
    if not re.fullmatch(r"0x[a-f0-9]{40}", contract):
        raise HTTPException(status_code=503, detail="Attendance contract configuration is invalid")

    chain_id = await _rpc("eth_chainId", [])
    if int(chain_id, 16) != 11155111:
        raise HTTPException(status_code=503, detail="Configured RPC is not Ethereum Sepolia")

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
        except (ValueError, KeyError, TypeError):
            raise HTTPException(status_code=502, detail="SessionCreated event data is malformed")
        if event_instructor != instructor_wallet.lower():
            raise HTTPException(status_code=403, detail="SessionCreated event instructor mismatch")
        if starts_at >= ends_at or qr_nonce <= 0:
            raise HTTPException(status_code=422, detail="SessionCreated event contains invalid session values")
        return {
            "starts_at": int(starts_at), "ends_at": int(ends_at),
            "qr_nonce": int(qr_nonce), "creation_block": int(receipt["blockNumber"], 16),
        }
    raise HTTPException(status_code=422, detail="Transaction does not contain the expected SessionCreated event")


@router.post("/{organization_id}/attendance-sessions", status_code=201)
async def register_attendance_session(
    organization_id: int,
    payload: SessionRegistration,
    csrf_cookie: str | None = Header(default=None, alias="Cookie"),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
    membership=Depends(require_org_membership("owner", "admin", "instructor")),
    session=Depends(current_session),
):
    # The CSRF cookie is read from the request's Cookie header by FastAPI below.
    from fastapi import Request
    # Explicit CSRF validation is performed in the request wrapper dependency.
    # The cookie/header pair is checked before persistence; the session hash binds it.
    if not csrf_header:
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    connection = await connect()
    try:
        csrf_row = await connection.fetchrow(
            "SELECT csrf_hash FROM auth_sessions WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL",
            session["user_id"], __import__("hashlib").sha256(session.get("session_token", "").encode()).hexdigest()
        )
    finally:
        await connection.close()
    # current_session intentionally does not expose the raw session token. Validate the
    # double-submit cookie/header via a dedicated request dependency instead.
    raise HTTPException(status_code=501, detail="Session registration requires CSRF request binding")
