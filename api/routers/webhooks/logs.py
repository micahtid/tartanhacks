from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession
from fastapi import Depends

from api.database import get_db
from api.models.app import App
from api.models.incident import Incident

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

    # Deduplication: skip if open incident exists with same app_id + source + error_message
    existing = (
        db.query(Incident)
        .filter(
            Incident.app_id == app.id,
            Incident.source == payload.source,
            Incident.error_message == payload.error_message,
            Incident.status == "open",
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

    return {"status": "created", "incident_id": incident.id}
