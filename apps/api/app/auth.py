import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from app.settings import settings

router = APIRouter(prefix="/auth", tags=["authentication"])
SESSION_COOKIE = "attendance_session"
CSRF_COOKIE = "attendance_csrf"
SESSION_TTL = timedelta(hours=12)
CHALLENGE_TTL = timedelta(minutes=5)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_siwe_message(address: str, nonce: str, issued_at: datetime, expires_at: datetime) -> str:
    return (
        f"{settings.siwe_domain} wants you to sign in with your Ethereum account:\n"
        f"{address}\n\n"
        "Sign in to Student Attendance DApp. This request will not trigger a blockchain transaction.\n\n"
        f"URI: {settings.siwe_uri}\nVersion: 1\nChain ID: {settings.siwe_chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at.isoformat().replace('+00:00', 'Z')}\n"
        f"Expiration Time: {expires_at.isoformat().replace('+00:00', 'Z')}"
    )


class NonceRequest(BaseModel):
    address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")


class VerifyRequest(BaseModel):
    address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")
    nonce: str = Field(min_length=16, max_length=128)
    message: str = Field(min_length=100, max_length=2000)
    signature: str = Field(pattern=r"^0x[a-fA-F0-9]{130}$")


async def connect() -> asyncpg.Connection:
    return await asyncpg.connect(settings.database_url)


def set_session_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    secure = settings.environment.lower() in {"production", "staging"}
    response.set_cookie(SESSION_COOKIE, session_token, httponly=True, secure=secure,
                        samesite="lax", max_age=int(SESSION_TTL.total_seconds()), path="/")
    response.set_cookie(CSRF_COOKIE, csrf_token, httponly=False, secure=secure,
                        samesite="lax", max_age=int(SESSION_TTL.total_seconds()), path="/")


@router.post("/nonce")
async def issue_nonce(payload: NonceRequest) -> dict[str, Any]:
    address = payload.address.lower()
    nonce = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    expires = now + CHALLENGE_TTL
    message = build_siwe_message(address, nonce, now, expires)
    connection = await connect()
    try:
        await connection.execute(
            """INSERT INTO auth_challenges (nonce_hash, wallet_address, message, expires_at)
               VALUES ($1, $2, $3, $4)""", digest(nonce), address, message, expires,
        )
    finally:
        await connection.close()
    return {"nonce": nonce, "message": message, "expires_at": expires.isoformat()}


@router.post("/verify")
async def verify_signature(payload: VerifyRequest, response: Response) -> dict[str, Any]:
    address = payload.address.lower()
    connection = await connect()
    try:
        challenge = await connection.fetchrow(
            """SELECT wallet_address, message, expires_at, consumed_at
               FROM auth_challenges WHERE nonce_hash = $1""", digest(payload.nonce)
        )
        if not challenge or challenge["consumed_at"] is not None:
            raise HTTPException(status_code=401, detail="Challenge is invalid or already used")
        if challenge["wallet_address"] != address or challenge["message"] != payload.message:
            raise HTTPException(status_code=401, detail="Signed message does not match challenge")
        if challenge["expires_at"] <= datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Challenge expired")
        try:
            recovered = Account.recover_message(
                encode_defunct(text=payload.message), signature=payload.signature
            ).lower()
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid wallet signature")
        if recovered != address:
            raise HTTPException(status_code=401, detail="Signature wallet mismatch")
        consumed = await connection.execute(
            """UPDATE auth_challenges SET consumed_at = now()
               WHERE nonce_hash = $1 AND consumed_at IS NULL AND expires_at > now()""",
            digest(payload.nonce),
        )
        if consumed != "UPDATE 1":
            raise HTTPException(status_code=401, detail="Challenge already consumed")
        await connection.execute(
            """INSERT INTO users (wallet_address) VALUES ($1)
               ON CONFLICT (wallet_address) DO NOTHING""", address
        )
        user = await connection.fetchrow("SELECT id FROM users WHERE wallet_address = $1", address)
        session_token, csrf_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + SESSION_TTL
        await connection.execute(
            """INSERT INTO auth_sessions (token_hash, csrf_hash, user_id, expires_at)
               VALUES ($1, $2, $3, $4)""",
            digest(session_token), digest(csrf_token), user["id"], expires_at,
        )
        memberships = await connection.fetch(
            """SELECT organization_id, role FROM organization_memberships
               WHERE user_id = $1 AND revoked_at IS NULL ORDER BY organization_id""", user["id"]
        )
    finally:
        await connection.close()
    set_session_cookies(response, session_token, csrf_token)
    return {"authenticated": True, "wallet_address": address, "expires_at": expires_at.isoformat(),
            "memberships": [dict(row) for row in memberships]}


async def current_session(session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE)):
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required")
    connection = await connect()
    try:
        row = await connection.fetchrow(
            """SELECT s.id, s.user_id, u.wallet_address, s.csrf_hash, s.expires_at
               FROM auth_sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()""",
            digest(session_token),
        )
        if not row:
            raise HTTPException(status_code=401, detail="Session expired or revoked")
        return row
    finally:
        await connection.close()


@router.get("/me")
async def me(session=Depends(current_session)):
    connection = await connect()
    try:
        memberships = await connection.fetch(
            """SELECT organization_id, role FROM organization_memberships
               WHERE user_id = $1 AND revoked_at IS NULL ORDER BY organization_id""",
            session["user_id"],
        )
    finally:
        await connection.close()
    return {"authenticated": True, "wallet_address": session["wallet_address"],
            "memberships": [dict(row) for row in memberships]}


@router.post("/logout")
async def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    csrf_token: str | None = Cookie(default=None, alias=CSRF_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
):
    if not session_token:
        response.delete_cookie(SESSION_COOKIE, path="/")
        response.delete_cookie(CSRF_COOKIE, path="/")
        return {"authenticated": False}
    if not csrf_token or not csrf_header or not secrets.compare_digest(csrf_token, csrf_header):
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    connection = await connect()
    try:
        row = await connection.fetchrow(
            "SELECT csrf_hash FROM auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL",
            digest(session_token),
        )
        if row and not secrets.compare_digest(row["csrf_hash"], digest(csrf_token)):
            raise HTTPException(status_code=403, detail="CSRF validation failed")
        await connection.execute(
            "UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
            digest(session_token),
        )
    finally:
        await connection.close()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"authenticated": False}
