from __future__ import annotations

# ROUTER REGISTRATION (Add to api/main.py):
# from api.routers.repos import commits
# app.include_router(commits.router)

# GITHUB SERVICE REQUIRED (Add to api/services/github_service.py if missing):
# async def get_repo_info(app_name: str) -> dict:
#     """Map app_name to {'owner': str, 'repo': str}"""
#     APP_MAP = {"my-app": {"owner": "micahtid", "repo": "tartanhacks"}}
#     return APP_MAP.get(app_name, {})
#
# async def fetch_commits(owner: str, repo: str, depth: int = 10) -> list[dict]:
#     """Fetch commits from GitHub API, return list of commit objects"""
#     pass

from fastapi import APIRouter, HTTPException, Query

# from api.services import github_service  # Uncomment when available

router = APIRouter(prefix="/repos", tags=["repos"])


@router.get("/{repo_id}/commits")
async def get_commits(
    repo_id: int,
    depth: int = Query(default=10, ge=1, le=100),
):
    """Fetch recent commits for a repository."""

    # 1. Map repo_id to app (placeholder: assume repo_id = app_name for now)
    # repo_info = await github_service.get_repo_info(str(repo_id))
    # if not repo_info:
    #     raise HTTPException(404, "Repository not found")

    # 2. Fetch commits from GitHub
    # commits = await github_service.fetch_commits(
    #     repo_info["owner"], repo_info["repo"], depth
    # )

    commits: list[dict] = []  # Placeholder until github_service ready

    return {"commits": commits}
