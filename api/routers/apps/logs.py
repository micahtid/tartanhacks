"""API endpoints for fetching Dedalus and Vercel logs."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DBSession

from api.config import settings
from api.database import get_db
from api.models.app import App
from api.models.user import User
from api.services.log_store import log_store
from api.utils.auth import get_current_user

router = APIRouter()


@router.get("/apps/{app_id}/logs/dedalus")
async def get_dedalus_logs(
    app_id: int,
    limit: int = Query(default=50, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """Get Dedalus integration logs for an app.
    
    Returns the most recent log lines from the Dedalus agent process.
    """
    # Verify user owns this app
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    
    logs = log_store.get_logs(app_id, "dedalus", limit=limit)
    
    return {
        "app_id": app_id,
        "log_type": "dedalus",
        "logs": logs,
        "count": len(logs),
    }


@router.get("/apps/{app_id}/logs/vercel")
async def get_vercel_logs(
    app_id: int,
    limit: int = Query(default=50, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """Get Vercel build logs for an app.
    
    Fetches build logs from the Vercel API for the app's project.
    Falls back to cached logs if available.
    """
    # Verify user owns this app
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")
    
    # First check if we have cached logs
    cached_logs = log_store.get_logs(app_id, "vercel", limit=limit)
    
    # If app has a vercel_project_id and is deploying, try to fetch fresh logs
    if app.vercel_project_id and app.pipeline_step == "deploying":
        fresh_logs = await _fetch_vercel_deployment_logs(app.vercel_project_id)
        if fresh_logs:
            # Store in log_store for caching
            log_store.clear(app_id, "vercel")
            log_store.append_lines(app_id, "vercel", fresh_logs)
            cached_logs = log_store.get_logs(app_id, "vercel", limit=limit)
    
    return {
        "app_id": app_id,
        "log_type": "vercel",
        "logs": cached_logs,
        "count": len(cached_logs),
    }


async def _fetch_vercel_deployment_logs(project_id: str) -> str | None:
    """Fetch the latest deployment logs from Vercel for a project."""
    vercel_token = settings.vercel_token
    if not vercel_token:
        return None
    
    headers = {"Authorization": f"Bearer {vercel_token}"}
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # First get the latest deployment for this project
            deployments_response = await client.get(
                f"https://api.vercel.com/v6/deployments",
                headers=headers,
                params={"projectId": project_id, "limit": 1}
            )
            
            if deployments_response.status_code != 200:
                return None
            
            deployments = deployments_response.json().get("deployments", [])
            if not deployments:
                return None
            
            deployment_id = deployments[0].get("uid")
            if not deployment_id:
                return None
            
            # Fetch deployment events/logs
            events_response = await client.get(
                f"https://api.vercel.com/v2/deployments/{deployment_id}/events",
                headers=headers,
            )
            
            if events_response.status_code != 200:
                return f"Failed to fetch logs: {events_response.status_code}"
            
            events = events_response.json()
            if not events:
                return "Build starting..."
            
            # Extract log messages from events
            log_lines = []
            for event in events:
                if isinstance(event, dict):
                    text = event.get("text") or event.get("payload", {}).get("text", "")
                    if text:
                        log_lines.append(text)
            
            return "\n".join(log_lines) if log_lines else "Build in progress..."
            
    except Exception as e:
        return f"Error fetching logs: {type(e).__name__}: {e}"
