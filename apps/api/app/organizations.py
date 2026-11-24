import secrets
from typing import Any, Literal

import asyncpg
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import CSRF_COOKIE, connect, current_session, digest
from app.settings import settings

router = APIRouter(prefix="/organizations", tags=["organizations"])
MemberRole = Literal["admin", "instructor", "student", "viewer"]
ALL_ROLES = {"owner", "admin", "instructor", "student", "viewer"}
ADMIN_ASSIGNABLE_ROLES = {"instructor", "student", "viewer"}


class BootstrapRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)


class MembershipRequest(BaseModel):
    role: MemberRole


def require_org_membership(*allowed_roles: str):
    async def dependency(
        organization_id: int,
        session=Depends(current_session),
    ) -> dict[str, Any]:
        connection = await connect()
        try:
            membership = await connection.fetchrow(
                """SELECT m.organization_id, m.role, o.name
                   FROM organization_memberships m
                   JOIN organizations o ON o.id = m.organization_id
                   WHERE m.organization_id = $1 AND m.user_id = $2
                     AND m.revoked_at IS NULL""",
                organization_id,
                session["user_id"],
            )
        finally:
            await connection.close()
        if not membership:
            raise HTTPException(status_code=404, detail="Organization not found")
        if allowed_roles and membership["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient organization role")
        return dict(membership)

    return dependency


def require_csrf(
    session,
    csrf_cookie: str | None,
    csrf_header: str | None,
) -> None:
    if not csrf_cookie or not csrf_header:
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    if not secrets.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    if not secrets.compare_digest(session["csrf_hash"], digest(csrf_cookie)):
        raise HTTPException(status_code=403, detail="CSRF validation failed")


async def locked_actor_role(connection, organization_id: int, user_id: int) -> str:
    actor = await connection.fetchrow(
        """SELECT role FROM organization_memberships
           WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL
           FOR UPDATE""",
        organization_id,
        user_id,
    )
    if not actor or actor["role"] not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Insufficient organization role")
    return actor["role"]


async def write_membership_audit(
    connection,
    organization_id: int,
    actor_user_id: int,
    event_type: str,
    target_user_id: int,
    role: str | None = None,
) -> None:
    await connection.execute(
        """INSERT INTO organization_audit_events
           (organization_id, actor_user_id, event_type, metadata)
           VALUES ($1, $2, $3,
             jsonb_build_object('target_user_id', $4::bigint, 'role', $5::text))""",
        organization_id,
        actor_user_id,
        event_type,
        target_user_id,
        role,
    )


@router.post("/bootstrap", status_code=201)
async def bootstrap_organization(
    payload: BootstrapRequest,
    bootstrap_secret: str | None = Header(default=None, alias="X-Org-Bootstrap-Secret"),
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
    session=Depends(current_session),
):
    configured_secret = settings.org_bootstrap_secret
    if not configured_secret:
        raise HTTPException(status_code=503, detail="Organization bootstrap is not configured")
    if not bootstrap_secret or not secrets.compare_digest(bootstrap_secret, configured_secret):
        raise HTTPException(status_code=403, detail="Invalid bootstrap credential")
    require_csrf(session, csrf_cookie, csrf_header)

    connection = await connect()
    try:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(915240611)")
            exists = await connection.fetchval("SELECT EXISTS (SELECT 1 FROM organizations)")
            if exists:
                raise HTTPException(status_code=409, detail="Organization bootstrap already consumed")
            organization_id = await connection.fetchval(
                "INSERT INTO organizations (name) VALUES ($1) RETURNING id", payload.name.strip()
            )
            await connection.execute(
                """INSERT INTO organization_memberships (organization_id, user_id, role)
                   VALUES ($1, $2, 'owner')""",
                organization_id,
                session["user_id"],
            )
            await connection.execute(
                """INSERT INTO organization_audit_events
                   (organization_id, actor_user_id, event_type, metadata)
                   VALUES ($1, $2, 'organization.bootstrapped', '{}'::jsonb)""",
                organization_id,
                session["user_id"],
            )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="Organization bootstrap already consumed")
    finally:
        await connection.close()
    return {"organization_id": organization_id, "name": payload.name.strip(), "role": "owner"}


@router.get("/{organization_id}/workspace")
async def organization_workspace(membership=Depends(require_org_membership())):
    return {
        "organization_id": membership["organization_id"],
        "name": membership["name"],
        "role": membership["role"],
    }


@router.get("/{organization_id}/admin")
async def organization_admin_workspace(
    membership=Depends(require_org_membership("owner", "admin")),
):
    return {
        "organization_id": membership["organization_id"],
        "name": membership["name"],
        "role": membership["role"],
        "permissions": ["manage_members", "manage_settings"],
    }


@router.get("/{organization_id}/members")
async def list_organization_members(
    organization_id: int,
    membership=Depends(require_org_membership("owner", "admin")),
):
    connection = await connect()
    try:
        rows = await connection.fetch(
            """SELECT u.wallet_address, m.role, m.created_at, m.revoked_at
               FROM organization_memberships m
               JOIN users u ON u.id = m.user_id
               WHERE m.organization_id = $1
               ORDER BY m.created_at, u.wallet_address""",
            organization_id,
        )
    finally:
        await connection.close()
    return {"organization_id": organization_id, "members": [dict(row) for row in rows]}


@router.put("/{organization_id}/members/{wallet_address}", status_code=200)
async def upsert_organization_member(
    organization_id: int,
    wallet_address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$"),
    payload: MembershipRequest = ...,
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
    session=Depends(current_session),
):
    address = wallet_address.lower()
    connection = await connect()
    try:
        async with connection.transaction():
            actor_role = await locked_actor_role(connection, organization_id, session["user_id"])
            require_csrf(session, csrf_cookie, csrf_header)
            if address == session["wallet_address"]:
                raise HTTPException(status_code=409, detail="You cannot change your own membership")
            if payload.role == "owner":
                raise HTTPException(status_code=403, detail="Owner transfer requires a separate workflow")
            if actor_role == "admin" and payload.role not in ADMIN_ASSIGNABLE_ROLES:
                raise HTTPException(status_code=403, detail="Admins cannot grant admin privileges")

            target = await connection.fetchrow(
                """SELECT u.id AS user_id, m.role, m.revoked_at
                   FROM users u
                   LEFT JOIN organization_memberships m
                     ON m.user_id = u.id AND m.organization_id = $1
                   WHERE u.wallet_address = $2""",
                organization_id,
                address,
            )
            if not target:
                raise HTTPException(status_code=404, detail="Wallet has not authenticated")
            if target["role"] == "owner":
                raise HTTPException(status_code=403, detail="Owner membership is protected")
            if actor_role == "admin" and target["role"] == "admin":
                raise HTTPException(status_code=403, detail="Admins cannot manage other admins")

            if target["role"] is None:
                await connection.execute(
                    """INSERT INTO organization_memberships (organization_id, user_id, role)
                       VALUES ($1, $2, $3)""",
                    organization_id, target["user_id"], payload.role,
                )
                event_type = "membership.role_changed"
            else:
                was_revoked = target["revoked_at"] is not None
                await connection.execute(
                    """UPDATE organization_memberships
                       SET role = $3, revoked_at = NULL
                       WHERE organization_id = $1 AND user_id = $2""",
                    organization_id, target["user_id"], payload.role,
                )
                event_type = "membership.reactivated" if was_revoked else "membership.role_changed"

            await write_membership_audit(
                connection, organization_id, session["user_id"], event_type,
                target["user_id"], payload.role,
            )
    finally:
        await connection.close()
    return {"organization_id": organization_id, "wallet_address": address,
            "role": payload.role, "active": True}


@router.delete("/{organization_id}/members/{wallet_address}")
async def revoke_organization_member(
    organization_id: int,
    wallet_address: str,
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
    session=Depends(current_session),
):
    if not wallet_address.startswith("0x") or len(wallet_address) != 42:
        raise HTTPException(status_code=422, detail="Invalid wallet address")
    address = wallet_address.lower()
    connection = await connect()
    try:
        async with connection.transaction():
            actor_role = await locked_actor_role(connection, organization_id, session["user_id"])
            require_csrf(session, csrf_cookie, csrf_header)
            if address == session["wallet_address"]:
                raise HTTPException(status_code=409, detail="You cannot revoke your own membership")
            target = await connection.fetchrow(
                """SELECT u.id AS user_id, m.role, m.revoked_at
                   FROM users u JOIN organization_memberships m ON m.user_id = u.id
                   WHERE u.wallet_address = $1 AND m.organization_id = $2
                   FOR UPDATE OF m""",
                address, organization_id,
            )
            if not target or target["revoked_at"] is not None:
                raise HTTPException(status_code=404, detail="Active membership not found")
            if target["role"] == "owner":
                raise HTTPException(status_code=403, detail="Owner membership is protected")
            if actor_role == "admin" and target["role"] == "admin":
                raise HTTPException(status_code=403, detail="Admins cannot revoke other admins")
            await connection.execute(
                """UPDATE organization_memberships SET revoked_at = now()
                   WHERE organization_id = $1 AND user_id = $2""",
                organization_id, target["user_id"],
            )
            await write_membership_audit(
                connection, organization_id, session["user_id"], "membership.revoked",
                target["user_id"], target["role"],
            )
    finally:
        await connection.close()
    return {"organization_id": organization_id, "wallet_address": address, "revoked": True}
