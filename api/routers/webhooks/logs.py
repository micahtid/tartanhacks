from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession
from fastapi import Depends

from api.database import get_db
from api.models.app import App
from api.models.incident import Incident
from api.services.incident_queue import enqueue_incident

router = APIRouter()


class ErrorPayload(BaseModel):
    webhook_key: str
    source: str  # server, client-global
    error_message: str
    stack_trace: str | None = None
    logs: dict | list | None = None


@router.post("/webhooks/logs")
async def receive_error_log(payload: ErrorPayload, db: DBSession = Depends(get_db)):
    app = db.query(App).filter(App.webhook_key == payload.webhook_key).first()
    if not app:
        raise HTTPException(status_code=404, detail="Unknown webhook key")

    # Deduplication: skip if open/analyzing incident exists with same app_id + source + error_message
    existing = (
        db.query(Incident)
        .filter(
            Incident.app_id == app.id,
            Incident.source == payload.source,
            Incident.error_message == payload.error_message,
            Incident.status.in_(["open", "analyzing", "pr_created"]),
        )
        .first()
    )
    if existing:
        return {"status": "duplicate", "incident_id": existing.id}

    incident = Incident(
        app_id=app.id,
        type="runtime_error",
        source=payload.source,
        status="open",
        error_message=payload.error_message,
        stack_trace=payload.stack_trace,
        logs=payload.logs,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)

    # Enqueue for sequential processing — need the app owner's GitHub token
    user = app.user
    if user and user.access_token:
        enqueue_incident(
            app_id=app.id,
            incident_id=incident.id,
            github_token=user.access_token,
            repo_owner=app.repo_owner,
            repo_name=app.repo_name,
            error_message=payload.error_message,
            stack_trace=payload.stack_trace,
            logs=payload.logs,
        )

    return {"status": "created", "incident_id": incident.id}
