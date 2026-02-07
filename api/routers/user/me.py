from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from api.utils.auth import get_current_user
from api.services.github_service import get_user_repos
from api.database import get_db

router = APIRouter()


class SettingsUpdate(BaseModel):
    vercel_token: str | None = None


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": user.id,
        "github_id": user.github_id,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "has_vercel_token": bool(user.vercel_token),
    }


@router.put("/me/settings")
async def update_settings(
    body: SettingsUpdate,
    user=Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    if body.vercel_token is not None:
        user.vercel_token = body.vercel_token if body.vercel_token else None
    db.add(user)
    db.commit()
    return {"ok": True, "has_vercel_token": bool(user.vercel_token)}


@router.get("/me/repos")
async def me_repos(user=Depends(get_current_user)):
    repos = await get_user_repos(user.access_token)
    return [
        {
            "full_name": r["full_name"],
            "name": r["name"],
            "private": r["private"],
            "url": r["html_url"],
        }
        for r in repos
    ]
