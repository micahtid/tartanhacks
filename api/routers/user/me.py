from fastapi import APIRouter, Depends

from api.utils.auth import get_current_user
from api.services.github_service import get_user_repos

router = APIRouter()


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": user.id,
        "github_id": user.github_id,
        "username": user.username,
        "avatar_url": user.avatar_url,
    }


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
