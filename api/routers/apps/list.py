from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
import httpx

from api.config import settings
from api.database import get_db
from api.models.user import User
from api.models.app import App
from api.models.incident import Incident
from api.utils.auth import get_current_user
from api.services.github_service import get_repo_details

router = APIRouter()


@router.get("/apps")
async def list_apps(user: User = Depends(get_current_user), db: DBSession = Depends(get_db)):
    apps = db.query(App).filter(App.user_id == user.id).all()
    results = []
    for app in apps:
        permissions = {}
        private = False
        try:
            repo_data = await get_repo_details(user.access_token, app.repo_owner, app.repo_name)
            permissions = repo_data.get("permissions", {})
            private = repo_data.get("private", False)
        except Exception:
            pass
        results.append({
            "id": app.id,
            "repo_owner": app.repo_owner,
            "repo_name": app.repo_name,
            "full_name": f"{app.repo_owner}/{app.repo_name}",
            "status": app.status,
            "private": private,
            "permissions": permissions,
            "instrumented": app.instrumented,
            "live_url": app.live_url,
            "created_at": app.created_at.isoformat() if app.created_at else None,
        })
    return results


@router.post("/apps/connect")
async def connect_app(
    body: dict,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    full_name = body.get("full_name", "")
    parts = full_name.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid repository name, expected owner/repo")

    repo_owner, repo_name = parts

    existing = (
        db.query(App)
        .filter(App.user_id == user.id, App.repo_owner == repo_owner, App.repo_name == repo_name)
        .first()
    )
    if existing:
        return {
            "id": existing.id,
            "repo_owner": existing.repo_owner,
            "repo_name": existing.repo_name,
            "full_name": f"{existing.repo_owner}/{existing.repo_name}",
            "status": existing.status,
        }

    app = App(user_id=user.id, repo_owner=repo_owner, repo_name=repo_name, status="pending")
    db.add(app)
    db.commit()
    db.refresh(app)

    return {
        "id": app.id,
        "repo_owner": app.repo_owner,
        "repo_name": app.repo_name,
        "full_name": f"{app.repo_owner}/{app.repo_name}",
        "status": app.status,
    }


@router.delete("/apps/{app_id}")
async def disconnect_app(
    app_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="App not found")

    db.delete(app)
    db.commit()
    return {"ok": True}


@router.get("/apps/{app_id}")
async def get_app(
    app_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    return {
        "id": app.id,
        "repo_owner": app.repo_owner,
        "repo_name": app.repo_name,
        "full_name": f"{app.repo_owner}/{app.repo_name}",
        "status": app.status,
        "live_url": app.live_url,
        "vercel_project_id": app.vercel_project_id,
        "instrumented": app.instrumented,
        "pipeline_step": app.pipeline_step,
        "pr_url": app.pr_url,
        "pr_number": app.pr_number,
        "webhook_key": app.webhook_key,
        "created_at": app.created_at.isoformat() if app.created_at else None,
    }


@router.get("/apps/{app_id}/incidents")
async def get_app_incidents(
    app_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    incidents = (
        db.query(Incident)
        .filter(Incident.app_id == app_id)
        .order_by(Incident.created_at.desc())
        .all()
    )

    return [
        {
            "id": inc.id,
            "type": inc.type,
            "source": inc.source,
            "status": inc.status,
            "error_message": inc.error_message,
            "stack_trace": inc.stack_trace,
            "logs": inc.logs,
            "created_at": inc.created_at.isoformat() if inc.created_at else None,
            "resolved_at": inc.resolved_at.isoformat() if inc.resolved_at else None,
        }
        for inc in incidents
    ]


@router.get("/apps/{app_id}/status")
async def get_app_status(
    app_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    def _response():
        return {
            "status": app.status,
            "live_url": app.live_url,
            "pipeline_step": app.pipeline_step,
            "pr_url": app.pr_url,
            "pr_number": app.pr_number,
            "webhook_key": app.webhook_key,
            "instrumented": app.instrumented,
        }

    # Check if PR has been merged (GitHub API)
    if app.pipeline_step == "pr_created" and app.pr_number:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                gh_res = await client.get(
                    f"https://api.github.com/repos/{app.repo_owner}/{app.repo_name}/pulls/{app.pr_number}",
                    headers={
                        "Authorization": f"Bearer {user.access_token}",
                        "Accept": "application/vnd.github.v3+json",
                    },
                )
                if gh_res.status_code == 200:
                    pr_data = gh_res.json()
                    if pr_data.get("merged"):
                        app.pipeline_step = "pr_merged"
                        app.instrumented = True
                        db.commit()
                        db.refresh(app)
        except Exception:
            pass

    # If already terminal, return cached status
    if app.status in ("ready", "error", "canceled") and app.pipeline_step in ("ready", "error", None):
        return _response()

    # If no vercel project yet (just connected, deploy hasn't started), return as-is
    if not app.vercel_project_id:
        return _response()

    # Only poll Vercel when pipeline_step is "deploying"
    if app.vercel_project_id and app.pipeline_step == "deploying":
        vercel_token = user.vercel_token or settings.vercel_token
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    f"https://api.vercel.com/v6/deployments?projectId={app.vercel_project_id}&limit=1&target=production",
                    headers={"Authorization": f"Bearer {vercel_token}"},
                )
                if res.status_code == 200:
                    data = res.json()
                    deployments = data.get("deployments", [])
                    if deployments:
                        d = deployments[0]
                        vercel_state = d.get("state", d.get("readyState", ""))

                        status_map = {
                            "BUILDING": "deploying",
                            "INITIALIZING": "deploying",
                            "QUEUED": "deploying",
                            "READY": "ready",
                            "ERROR": "error",
                            "CANCELED": "error",
                        }
                        new_status = status_map.get(vercel_state.upper(), app.status)

                        if new_status != app.status:
                            app.status = new_status
                        if new_status == "ready":
                            app.pipeline_step = "ready"
                            # Fetch project domains for the stable production URL
                            live_url = None
                            try:
                                dom_res = await client.get(
                                    f"https://api.vercel.com/v9/projects/{app.vercel_project_id}/domains",
                                    headers={"Authorization": f"Bearer {vercel_token}"},
                                )
                                if dom_res.status_code == 200:
                                    domains = dom_res.json().get("domains", [])
                                    if domains:
                                        live_url = f"https://{domains[0]['name']}"
                            except Exception:
                                pass
                            # Fallback: try alias from deployment, then raw url
                            if not live_url:
                                aliases = d.get("alias", [])
                                if aliases:
                                    live_url = f"https://{aliases[0]}"
                                elif d.get("url"):
                                    live_url = f"https://{d['url']}"
                            if live_url:
                                app.live_url = live_url
                        db.commit()
                        db.refresh(app)
        except Exception:
            pass

    return _response()
