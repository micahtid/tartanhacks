from __future__ import annotations

# ROUTER REGISTRATION (Add to api/main.py):
# from api.routers.repos import files
# app.include_router(files.router)

# GITHUB SERVICE REQUIRED (Add to api/services/github_service.py if missing):
# async def fetch_file_content(
#     owner: str, repo: str, path: str, ref: str = "main"
# ) -> dict:
#     """Fetch file from GitHub API.
#     Returns {name, path, sha, size, encoding, content} (content is base64).
#     """
#     pass

from fastapi import APIRouter, HTTPException, Query

# from api.services import github_service  # Uncomment when available

router = APIRouter(prefix="/repos", tags=["repos"])


@router.get("/{repo_id}/files/{path:path}")
async def get_file_content(
    repo_id: int,
    path: str,
    sha: str = Query(default=None, description="Commit SHA for a specific version"),
):
    """Fetch file content from a repository."""

    # 1. Map repo_id to owner/repo
    # repo_info = await github_service.get_repo_info(str(repo_id))
    # if not repo_info:
    #     raise HTTPException(404, "Repository not found")

    # 2. Fetch file content
    # ref = sha if sha else "main"
    # try:
    #     content = await github_service.fetch_file_content(
    #         repo_info["owner"], repo_info["repo"], path, ref=ref,
    #     )
    # except Exception:
    #     raise HTTPException(404, f"File not found: {path}")

    # 3. Return file content (placeholder until github_service ready)
    raise HTTPException(501, "GitHub service not yet configured")
