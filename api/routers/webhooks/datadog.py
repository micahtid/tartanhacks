from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

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
from api.services.datadog_service import fetch_logs_for_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Mapping from DataDog alert_type values to our IncidentType enum.
_ALERT_TYPE_MAP: dict[str, IncidentType] = {
    "metric_alert": IncidentType.METRIC_BREACH,
    "metric alert": IncidentType.METRIC_BREACH,
    "query_alert": IncidentType.METRIC_BREACH,
    "service_check": IncidentType.RUNTIME_ERROR,
    "error_tracking": IncidentType.RUNTIME_ERROR,
    "log_alert": IncidentType.RUNTIME_ERROR,
}


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class DatadogWebhookRequest(BaseModel):
    """Payload sent by a DataDog webhook notification.

    Reference: https://docs.datadoghq.com/integrations/webhooks/
    """
    alert_id: str
    alert_type: str | None = None
    title: str
    body: str | None = None
    priority: str | None = "P3"
    tags: list[str] = Field(default_factory=list)


class DatadogWebhookResponse(BaseModel):
    received: bool = True
    incident_id: int
    status: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/datadog", response_model=DatadogWebhookResponse)
async def receive_datadog_alert(
    payload: DatadogWebhookRequest,
    background_tasks: BackgroundTasks,
):
    """Receive a DataDog alert webhook, create an incident, and kick off analysis.

    Automatically creates new incidents in Patchwork when performance thresholds
    are breached or specific errors are logged.  Log enrichment and analysis are
    dispatched as background tasks so the webhook returns immediately.
    """
    logger.info(
        "DataDog webhook received: alert_id=%s title=%s",
        payload.alert_id,
        payload.title,
    )

    try:
        # Deduplicate: check if we already have an incident for this alert
        existing = await find_incident_by_source("datadog", payload.alert_id)
        if existing:
            logger.info(
                "Incident already exists for alert %s -> incident %d",
                payload.alert_id,
                existing.id,
            )
            return DatadogWebhookResponse(
                incident_id=existing.id,
                status="existing",
            )

        # Derive incident type from the DataDog alert_type field
        incident_type = _ALERT_TYPE_MAP.get(
            payload.alert_type or "", IncidentType.RUNTIME_ERROR
        )

        app_name = _extract_tag(payload.tags, "service")

        incident_data = IncidentCreate(
            source=IncidentSource.DATADOG,
            source_id=payload.alert_id,
            incident_type=incident_type,
            title=payload.title,
            description=payload.body,
            severity=payload.priority or "P3",
            status=IncidentStatus.OPEN,
            tags=payload.tags,
            app_name=app_name,
            raw_payload=payload.model_dump(),
        )

        incident = await create_incident(incident_data)
        logger.info(
            "Created incident %d from DataDog alert %s",
            incident.id,
            payload.alert_id,
        )

        # Dispatch enrichment (fetch logs) and analysis as background work
        background_tasks.add_task(_enrich_and_analyze, incident, app_name)

        return DatadogWebhookResponse(
            incident_id=incident.id,
            status="created",
        )

    except Exception:
        logger.exception("Failed to process DataDog webhook")
        raise HTTPException(
            status_code=500,
            detail="Internal error processing DataDog webhook",
        )


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def _enrich_and_analyze(incident: Incident, app_name: str | None) -> None:
    """Fetch supporting logs from DataDog, then trigger the analysis loop."""
    # 1. Pull recent error logs for context
    if app_name:
        try:
            log_data = await fetch_logs_for_service(app_name, limit=20)
            logger.info(
                "Fetched %d log entries for incident %d (service=%s)",
                len(log_data),
                incident.id,
                app_name,
            )
        except Exception:
            logger.warning(
                "Could not fetch DataDog logs for incident %d, service=%s",
                incident.id,
                app_name,
            )

    # 2. Move incident into investigating state
    await update_incident_status(incident.id, IncidentStatus.INVESTIGATING)

    # 3. Trigger analysis — will call into routers/incidents/analyze.py once
    #    that module is implemented.  For now, log the hand-off point.
    logger.info(
        "Analysis loop triggered for incident %d (type=%s, source=datadog)",
        incident.id,
        incident.incident_type.value,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_tag(tags: list[str], key: str) -> str | None:
    """Pull the value of a 'key:value' tag from a DataDog tag list."""
    for tag in tags:
        if tag.startswith(f"{key}:"):
            return tag.split(":", 1)[1]
    return None
