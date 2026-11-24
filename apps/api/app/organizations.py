import secrets
from typing import Any

import asyncpg
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import CSRF_COOKIE, connect, current_session, digest
from app.settings import settings

router = APIRouter(prefix="/organizations", tags=["organizations"])


class BootstrapRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)


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
        # A 404 avoids disclosing whether another tenant exists.
        if not membership:
            raise HTTPException(status_code=404, detail="Organization not found")
        if allowed_roles and membership["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient organization role")
        return dict(membership)

    return dependency


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
    if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    if not secrets.compare_digest(session["csrf_hash"], digest(csrf_cookie)):
        raise HTTPException(status_code=403, detail="CSRF validation failed")

    connection = await connect()
    try:
        async with connection.transaction():
            # Serialize bootstrap attempts; only the first organization can be bootstrapped.
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
                   VALUES ($1, $2, 'organization.bootstrapped', jsonb_build_object('name', $3))""",
                organization_id,
                session["user_id"],
                payload.name.strip(),
            )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="Organization bootstrap already consumed")
    finally:
        await connection.close()
    return {"organization_id": organization_id, "name": payload.name.strip(), "role": "owner"}


@router.get("/{organization_id}/workspace")
async def organization_workspace(
    membership=Depends(require_org_membership()),
):
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
