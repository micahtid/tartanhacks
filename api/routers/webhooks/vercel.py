from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from api.models.incident import (
    Incident,
    IncidentCreate,
    IncidentSource,
    IncidentStatus,
    IncidentType,
    create_incident,
    find_incident_by_source,
    update_incident_status,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Vercel error codes that indicate a build-time failure.
_BUILD_ERROR_CODES = {"BUILD_FAILED", "BUILD_TIMEOUT", "BUILD_COMMAND_FAILED"}


# ---------------------------------------------------------------------------
# Request / Response schemas  (mirrors Vercel webhook payloads)
# Ref: https://vercel.com/docs/observability/webhooks-overview
# ---------------------------------------------------------------------------

class DeploymentMeta(BaseModel):
    githubCommitSha: str | None = None
    githubCommitMessage: str | None = None


class DeploymentInfo(BaseModel):
    id: str
    url: str | None = None
    meta: DeploymentMeta | None = None


class ErrorInfo(BaseModel):
    code: str | None = None
    message: str | None = None


class VercelPayload(BaseModel):
    deployment: DeploymentInfo
    error: ErrorInfo | None = None


class VercelWebhookRequest(BaseModel):
    type: str  # e.g. "deployment.error", "deployment.succeeded"
    payload: VercelPayload


class VercelWebhookResponse(BaseModel):
    received: bool = True
    incident_id: int
    deployment_id: int | None = None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/vercel", response_model=VercelWebhookResponse)
async def receive_vercel_webhook(
    payload: VercelWebhookRequest,
    background_tasks: BackgroundTasks,
):
    """Receive Vercel deployment status changes and capture build failures.

    Captures build failures and runtime errors from Vercel, persists them as
    incidents, and triggers the analysis loop for failed deployments so the
    LLM-driven root-cause pipeline can begin automatically.
    """
    deployment = payload.payload.deployment
    error = payload.payload.error
    logger.info(
        "Vercel webhook received: type=%s deployment=%s",
        payload.type,
        deployment.id,
    )

    try:
        # Deduplicate by deployment ID
        existing = await find_incident_by_source("vercel", deployment.id)
        if existing:
            logger.info(
                "Incident already exists for deployment %s -> incident %d",
                deployment.id,
                existing.id,
            )
            return VercelWebhookResponse(
                incident_id=existing.id,
                deployment_id=existing.id,
            )

        # Classify: build_error vs runtime_error
        error_code = error.code if error else None
        if error_code and error_code.upper() in _BUILD_ERROR_CODES:
            incident_type = IncidentType.BUILD_ERROR
        elif payload.type in ("deployment.error", "deployment.check-rerequested"):
            incident_type = IncidentType.BUILD_ERROR
        else:
            incident_type = IncidentType.RUNTIME_ERROR

        # Build human-readable title
        label = error_code or payload.type
        title = f"Vercel {label}: {deployment.url or deployment.id}"

        meta = deployment.meta or DeploymentMeta()

        # Use the error message as a lightweight stack trace when available
        stack_trace = error.message if error else None

        incident_data = IncidentCreate(
            source=IncidentSource.VERCEL,
            source_id=deployment.id,
            incident_type=incident_type,
            title=title,
            description=error.message if error else None,
            severity="P2",
            status=IncidentStatus.OPEN,
            tags=[f"type:{payload.type}"],
            app_name=_app_name_from_url(deployment.url),
            deployment_id=deployment.id,
            commit_sha=meta.githubCommitSha,
            commit_message=meta.githubCommitMessage,
            error_code=error_code,
            error_message=error.message if error else None,
            stack_trace=stack_trace,
            raw_payload=payload.model_dump(),
        )

        incident = await create_incident(incident_data)
        logger.info(
            "Created incident %d from Vercel deployment %s",
            incident.id,
            deployment.id,
        )

        # Trigger the analysis loop in the background for failed deployments
        background_tasks.add_task(_trigger_analysis, incident)

        return VercelWebhookResponse(
            incident_id=incident.id,
            deployment_id=incident.id,
        )

    except Exception:
        logger.exception("Failed to process Vercel webhook")
        raise HTTPException(
            status_code=500,
            detail="Internal error processing Vercel webhook",
        )


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def _trigger_analysis(incident: Incident) -> None:
    """Kick off the analysis loop for a failed deployment.

    Transitions the incident to INVESTIGATING and hands off to the
    analysis pipeline (routers/incidents/analyze.py) once that module
    is implemented.
    """
    await update_incident_status(incident.id, IncidentStatus.INVESTIGATING)

    logger.info(
        "Analysis loop triggered for incident %d "
        "(type=%s, deployment=%s, commit=%s)",
        incident.id,
        incident.incident_type.value,
        incident.deployment_id or "unknown",
        incident.commit_sha or "unknown",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _app_name_from_url(url: str | None) -> str | None:
    """Best-effort extraction of app name from a Vercel deployment URL."""
    if not url:
        return None
    # Typical pattern: "my-app-abc123.vercel.app"
    host = url.split("/")[0]
    parts = host.split(".")
    if len(parts) >= 2:
        return parts[0].rsplit("-", 1)[0]
    return host
