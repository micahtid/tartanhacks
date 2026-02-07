from __future__ import annotations

# ROUTER REGISTRATION (Add to api/main.py):
# from api.routers.incidents import analyze
# app.include_router(analyze.router)

import base64
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.models.incident import get_incident, update_incident_status, IncidentStatus
from api.models.analysis import (
    create_analysis,
    get_latest_analysis_for_incident,
    AnalysisCreate,
)

# from api.services import github_service  # Uncomment when available
from api.services.llm_service import analyze_incident as llm_analyze

router = APIRouter(prefix="/incidents", tags=["incidents"])


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    force_reanalyze: bool = False
    include_files: list[str] = Field(default_factory=list)
    commit_depth: int = Field(default=10, ge=1, le=50)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/{incident_id}/analyze")
async def analyze_incident_endpoint(
    incident_id: int,
    request: AnalyzeRequest,
):
    """Analyze incident using LLM to determine root cause and suggest fix."""

    # 1. Validate incident exists
    incident = await get_incident(incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")

    # 2. Check for existing analysis (cache for 1 hour)
    if not request.force_reanalyze:
        existing = await get_latest_analysis_for_incident(incident_id)
        if existing and (datetime.now() - existing.created_at).total_seconds() < 3600:
            return {"analysis": existing, "next_step": "pr_creation"}

    # 3. Get repo info (placeholder until github_service exists)
    # repo_info = await github_service.get_repo_info(incident.app_name)
    # if not repo_info:
    #     raise HTTPException(404, "Repository not found for app")

    # 4. Fetch commits
    # commits = await github_service.fetch_commits(
    #     repo_info["owner"], repo_info["repo"], request.commit_depth
    # )
    commits: list[dict] = []  # Placeholder

    # 5. Extract file paths from stack trace
    file_paths = _extract_file_paths_from_stack_trace(incident.stack_trace)
    file_paths.extend(request.include_files)
    file_paths = list(set(file_paths))

    # 6. Fetch file contents
    files: dict[str, str] = {}
    # for path in file_paths:
    #     try:
    #         content = await github_service.fetch_file_content(
    #             repo_info["owner"], repo_info["repo"], path
    #         )
    #         files[path] = base64.b64decode(content["content"]).decode("utf-8")
    #     except Exception:
    #         pass  # Continue on errors

    # 7. Call LLM service (Sanos AI engine via OpenRouter)
    try:
        llm_response = await llm_analyze(
            incident=incident,
            commits=commits,
            files=files,
            config={"model": "anthropic/claude-3.5-sonnet"},
        )
    except RuntimeError as exc:
        raise HTTPException(502, f"LLM analysis failed: {exc}")

    # 8. Save analysis
    analysis = await create_analysis(
        AnalysisCreate(
            incident_id=incident_id,
            llm_model=llm_response["model"],
            root_cause=llm_response["root_cause"],
            suggested_fix=llm_response.get("suggested_fix"),
            files_analyzed=llm_response["files_analyzed"],
            commits_analyzed=llm_response["commits_analyzed"],
            tokens_used=llm_response["tokens_used"],
        )
    )

    # 9. Update incident status
    await update_incident_status(incident_id, IncidentStatus.FIX_PROPOSED)

    # 10. Return response
    return {"analysis": analysis, "next_step": "pr_creation"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_file_paths_from_stack_trace(stack_trace: str | None) -> list[str]:
    """Parse stack trace to extract file paths (Python/JS/Java)."""
    if not stack_trace:
        return []

    paths: list[str] = []

    # Python: File "/app/api/main.py", line 42
    paths.extend(re.findall(r'File "([^"]+)"', stack_trace))

    # JS: at Object.<anonymous> (/app/src/index.js:15:7)
    paths.extend(re.findall(r'at\s+(?:\S+\s+)?\(([^:)]+):\d+:\d+\)', stack_trace))

    # JS (no parens): at /app/src/index.js:15:7
    paths.extend(re.findall(r'at\s+([^:(]+):\d+:\d+', stack_trace))

    # Normalise: strip leading / and /app/ prefix
    normalised: list[str] = []
    for path in paths:
        path = path.strip().lstrip("/")
        if path.startswith("app/"):
            path = path[4:]
        normalised.append(path)

    return list(set(normalised))
