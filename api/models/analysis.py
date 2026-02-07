from __future__ import annotations

# DATABASE SETUP (Add to api/database.py or migration):
# await db.execute("""
#     CREATE TABLE IF NOT EXISTS analyses (
#         id INTEGER PRIMARY KEY AUTOINCREMENT,
#         incident_id INTEGER NOT NULL,
#         llm_model TEXT NOT NULL,
#         root_cause TEXT NOT NULL,
#         suggested_fix TEXT,
#         files_analyzed TEXT,
#         commits_analyzed TEXT,
#         tokens_used INTEGER,
#         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
#         FOREIGN KEY (incident_id) REFERENCES incidents(id)
#     )
# """)

import json
from datetime import datetime

from pydantic import BaseModel, Field

from api.database import get_db


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SuggestedFix(BaseModel):
    file_path: str
    patch: str
    commit_message: str


class AnalysisBase(BaseModel):
    incident_id: int
    llm_model: str
    root_cause: str
    suggested_fix: SuggestedFix | None = None
    files_analyzed: list[str] = Field(default_factory=list)
    commits_analyzed: list[str] = Field(default_factory=list)
    tokens_used: int = 0


class AnalysisCreate(AnalysisBase):
    """Used when inserting a new analysis."""
    pass


class Analysis(AnalysisBase):
    """Full analysis record returned from the database."""
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

async def create_analysis(data: AnalysisCreate) -> Analysis:
    """Insert a new analysis row and return the full record."""
    db = await get_db()
    try:
        suggested_fix_json = (
            json.dumps(data.suggested_fix.model_dump())
            if data.suggested_fix
            else None
        )
        files_json = json.dumps(data.files_analyzed) if data.files_analyzed else "[]"
        commits_json = (
            json.dumps(data.commits_analyzed) if data.commits_analyzed else "[]"
        )

        cursor = await db.execute(
            """
            INSERT INTO analyses
                (incident_id, llm_model, root_cause, suggested_fix,
                 files_analyzed, commits_analyzed, tokens_used)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.incident_id,
                data.llm_model,
                data.root_cause,
                suggested_fix_json,
                files_json,
                commits_json,
                data.tokens_used,
            ),
        )
        await db.commit()
        analysis_id = cursor.lastrowid

        row = await db.execute(
            "SELECT * FROM analyses WHERE id = ?", (analysis_id,)
        )
        row = await row.fetchone()
        return _row_to_analysis(row)
    finally:
        await db.close()


async def get_latest_analysis_for_incident(incident_id: int) -> Analysis | None:
    """Return the most recent analysis for an incident, or None."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM analyses WHERE incident_id = ? ORDER BY created_at DESC LIMIT 1",
            (incident_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return _row_to_analysis(row)
    finally:
        await db.close()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _row_to_analysis(row) -> Analysis:
    """Convert an aiosqlite Row to an Analysis model."""
    suggested_fix = (
        SuggestedFix(**json.loads(row["suggested_fix"]))
        if row["suggested_fix"]
        else None
    )
    files_analyzed = (
        json.loads(row["files_analyzed"]) if row["files_analyzed"] else []
    )
    commits_analyzed = (
        json.loads(row["commits_analyzed"]) if row["commits_analyzed"] else []
    )

    return Analysis(
        id=row["id"],
        incident_id=row["incident_id"],
        llm_model=row["llm_model"],
        root_cause=row["root_cause"],
        suggested_fix=suggested_fix,
        files_analyzed=files_analyzed,
        commits_analyzed=commits_analyzed,
        tokens_used=row["tokens_used"],
        created_at=row["created_at"],
    )
