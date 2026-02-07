from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from api.database import get_db
from api.models.user import User
from api.models.app import App
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

    app = App(user_id=user.id, repo_owner=repo_owner, repo_name=repo_name, status="active")
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
