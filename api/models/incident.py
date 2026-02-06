from __future__ import annotations

import json
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from api.database import get_db


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class IncidentType(str, Enum):
    BUILD_ERROR = "build_error"
    RUNTIME_ERROR = "runtime_error"
    METRIC_BREACH = "metric_breach"


class IncidentSource(str, Enum):
    DATADOG = "datadog"
    VERCEL = "vercel"


class IncidentStatus(str, Enum):
    OPEN = "open"
    INVESTIGATING = "investigating"
    IDENTIFIED = "identified"
    FIX_PROPOSED = "fix_proposed"
    RESOLVED = "resolved"
    CLOSED = "closed"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class IncidentBase(BaseModel):
    source: IncidentSource = Field(..., description="Origin system")
    source_id: str | None = Field(None, description="External alert / event ID")
    incident_type: IncidentType = Field(..., description="Category of the incident")
    title: str
    description: str | None = None
    severity: str = "P3"
    status: IncidentStatus = IncidentStatus.OPEN
    tags: list[str] = Field(default_factory=list)

    # Linked entities
    app_name: str | None = None
    deployment_id: str | None = None
    commit_sha: str | None = None
    commit_message: str | None = None

    # Error details
    error_code: str | None = None
    error_message: str | None = None
    stack_trace: str | None = Field(None, description="Full stack trace if available")
    log_data: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Associated log entries from DataDog or Vercel",
    )

    # Original webhook body
    raw_payload: dict[str, Any] | None = None


class IncidentCreate(IncidentBase):
    """Used when inserting a new incident."""
    pass


class Incident(IncidentBase):
    """Full incident record returned from the database."""
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

async def create_incident(data: IncidentCreate) -> Incident:
    """Insert a new incident row and return the full record."""
    db = await get_db()
    try:
        tags_json = json.dumps(data.tags) if data.tags else "[]"
        log_data_json = json.dumps(data.log_data) if data.log_data else "[]"
        payload_json = json.dumps(data.raw_payload) if data.raw_payload else None

        cursor = await db.execute(
            """
            INSERT INTO incidents
                (source, source_id, incident_type, title, description,
                 severity, status, tags, app_name, deployment_id,
                 commit_sha, commit_message, error_code, error_message,
                 stack_trace, log_data, raw_payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.source.value,
                data.source_id,
                data.incident_type.value,
                data.title,
                data.description,
                data.severity,
                data.status.value,
                tags_json,
                data.app_name,
                data.deployment_id,
                data.commit_sha,
                data.commit_message,
                data.error_code,
                data.error_message,
                data.stack_trace,
                log_data_json,
                payload_json,
            ),
        )
        await db.commit()
        incident_id = cursor.lastrowid

        row = await db.execute(
            "SELECT * FROM incidents WHERE id = ?", (incident_id,)
        )
        row = await row.fetchone()
        return _row_to_incident(row)
    finally:
        await db.close()


async def get_incident(incident_id: int) -> Incident | None:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM incidents WHERE id = ?", (incident_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return _row_to_incident(row)
    finally:
        await db.close()


async def find_incident_by_source(source: str, source_id: str) -> Incident | None:
    """Look up an existing incident by its external source + id."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM incidents WHERE source = ? AND source_id = ?",
            (source, source_id),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return _row_to_incident(row)
    finally:
        await db.close()


async def update_incident_status(
    incident_id: int, status: IncidentStatus
) -> Incident | None:
    db = await get_db()
    try:
        await db.execute(
            "UPDATE incidents SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status.value, incident_id),
        )
        await db.commit()
        return await get_incident(incident_id)
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _row_to_incident(row) -> Incident:
    """Convert an aiosqlite Row to an Incident model."""
    tags = json.loads(row["tags"]) if row["tags"] else []
    log_data = json.loads(row["log_data"]) if row["log_data"] else []
    raw_payload = json.loads(row["raw_payload"]) if row["raw_payload"] else None

    return Incident(
        id=row["id"],
        source=IncidentSource(row["source"]),
        source_id=row["source_id"],
        incident_type=IncidentType(row["incident_type"]),
        title=row["title"],
        description=row["description"],
        severity=row["severity"],
        status=IncidentStatus(row["status"]),
        tags=tags,
        app_name=row["app_name"],
        deployment_id=row["deployment_id"],
        commit_sha=row["commit_sha"],
        commit_message=row["commit_message"],
        error_code=row["error_code"],
        error_message=row["error_message"],
        stack_trace=row["stack_trace"],
        log_data=log_data,
        raw_payload=raw_payload,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
