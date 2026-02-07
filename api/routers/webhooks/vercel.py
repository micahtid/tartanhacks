"""Vercel webhook handler for deployment events.

This router handles incoming webhooks from Vercel, specifically
`deployment.error` events, to create incidents and enqueue them
for automatic fix attempts via the shared incident queue.
"""

import hashlib
import hmac

import httpx
from fastapi import APIRouter, Header, HTTPException, Request

from api.config import settings
from api.database import SessionLocal
from api.models.app import App
from api.models.incident import Incident
from api.models.user import User
from api.services.incident_queue import enqueue_incident

router = APIRouter()


def _verify_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify the Vercel webhook signature."""
    if not secret:
        return True

    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha1,
    ).hexdigest()

    return hmac.compare_digest(expected, signature)


async def _fetch_vercel_logs(deployment_id: str, vercel_token: str) -> str:
    """Fetch build logs from Vercel for a given deployment."""
    headers = {"Authorization": f"Bearer {vercel_token}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(
                f"https://api.vercel.com/v2/deployments/{deployment_id}/events",
                headers=headers,
            )

            if response.status_code != 200:
                return f"Failed to fetch logs: {response.status_code} - {response.text}"

            events = response.json()

            log_lines = []
            for event in events:
                if event.get("type") in ("stdout", "stderr"):
                    text = event.get("payload", {}).get("text", "")
                    if text:
                        log_lines.append(text)
                elif event.get("text"):
                    log_lines.append(event["text"])

            if not log_lines:
                return "No build logs available."

            # Limit to last 200 lines to avoid token limits
            return "\n".join(log_lines[-200:])

        except Exception as e:
            return f"Error fetching logs: {type(e).__name__}: {e}"


@router.post("/webhooks/vercel")
async def vercel_webhook(
    request: Request,
    x_vercel_signature: str = Header(None),
):
    """Handle incoming Vercel webhook events."""
    payload = await request.body()

    # Verify signature if secret is configured
    secret = getattr(settings, "vercel_webhook_secret", None)
    if secret and x_vercel_signature:
        if not _verify_signature(payload, x_vercel_signature, secret):
            raise HTTPException(status_code=401, detail="Invalid signature")

    data = await request.json()

    event_type = data.get("type")
    deployment = data.get("payload", {})

    # Only process deployment.error events
    if event_type != "deployment.error":
        return {"status": "ignored", "event_type": event_type}

    deployment_id = deployment.get("id") or deployment.get("deployment", {}).get("id")
    project_name = deployment.get("name") or deployment.get("project", {}).get("name")
    deployment_url = deployment.get("url") or ""

    if not deployment_id or not project_name:
        return {"status": "ignored", "reason": "missing deployment info"}

    # Look up app + user
    db = SessionLocal()
    try:
        app = db.query(App).filter(App.vercel_project_id == project_name).first()
        if not app:
            return {"status": "ignored", "reason": "app not found"}

        user = db.query(User).filter(User.id == app.user_id).first()
        if not user or not user.access_token:
            return {"status": "ignored", "reason": "no github token"}

        # Fetch Vercel build logs
        vercel_token = settings.vercel_token
        build_logs = await _fetch_vercel_logs(deployment_id, vercel_token)

        error_message = f"Vercel deployment failed (deployment {deployment_id})"

        # Deduplication: skip if an open/analyzing/pr_created incident exists
        existing = (
            db.query(Incident)
            .filter(
                Incident.app_id == app.id,
                Incident.source == "vercel",
                Incident.error_message == error_message,
                Incident.status.in_(["open", "analyzing", "pr_created"]),
            )
            .first()
        )
        if existing:
            return {"status": "duplicate", "incident_id": existing.id}

        # Create incident record
        incident = Incident(
            app_id=app.id,
            type="build_error",
            source="vercel",
            status="open",
            error_message=error_message,
            stack_trace=None,
            logs={"build_logs": build_logs, "deployment_url": deployment_url},
        )
        db.add(incident)
        db.commit()
        db.refresh(incident)

        # Enqueue through the shared incident queue
        enqueue_incident(
            app_id=app.id,
            incident_id=incident.id,
            github_token=user.access_token,
            repo_owner=app.repo_owner,
            repo_name=app.repo_name,
            error_message=error_message,
            stack_trace=None,
            logs={"build_logs": build_logs, "deployment_url": deployment_url},
        )

        return {"status": "created", "incident_id": incident.id}

    finally:
        db.close()
