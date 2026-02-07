from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import httpx
from sqlalchemy.orm import Session as DBSession
import re

from api.config import settings
from api.models.user import User
from api.models.app import App
from api.database import get_db
from api.utils.auth import get_current_user

router = APIRouter()

class DeploymentRequest(BaseModel):
    repo_name: str  # Format: "owner/repo"
    branch: str | None = None  # Optional - will use repo's default branch if not specified

class DeploymentResponse(BaseModel):
    success: bool
    deployment_url: str | None = None
    inspector_url: str | None = None
    app_id: int | None = None
    message: str | None = None

@router.post("/deploy/create", response_model=DeploymentResponse)
async def create_deployment(
    request: DeploymentRequest,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    # Validate repo_name format
    if "/" not in request.repo_name:
        raise HTTPException(
            status_code=400,
            detail="repo_name must be in format 'owner/repo'"
        )

    repo_owner, repo_name_only = request.repo_name.split("/", 1)

    # Sanitize project name (Vercel requirements: lowercase, no special chars except hyphens)
    project_name = re.sub(r'[^a-z0-9-]', '-', repo_name_only.lower())[:100]

    # Get tokens
    vercel_token = settings.vercel_token
    github_token = current_user.access_token

    if not github_token:
        raise HTTPException(
            status_code=401,
            detail="User does not have a valid GitHub access token"
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Get Repository Details from GitHub
        repo_url = f"https://api.github.com/repos/{request.repo_name}"
        gh_headers = {
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Sanos-Deploy-Bot"
        }

        try:
            repo_response = await client.get(repo_url, headers=gh_headers)

            if repo_response.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail=f"Repository '{request.repo_name}' not found or you don't have access"
                )
            elif repo_response.status_code != 200:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to fetch repository: {repo_response.text}"
                )

            repo_data = repo_response.json()
            repo_id = repo_data["id"]
            default_branch = repo_data.get("default_branch", "main")
            deploy_branch = request.branch if request.branch else default_branch

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="GitHub API request timed out")
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"GitHub API request failed: {str(e)}")

        # 2. Create Vercel Project (or verify it exists)
        vercel_headers = {
            "Authorization": f"Bearer {vercel_token}",
            "Content-Type": "application/json"
        }

        project_payload = {
            "name": project_name,
            "gitRepository": {
                "type": "github",
                "repo": request.repo_name
            }
        }

        try:
            project_response = await client.post(
                "https://api.vercel.com/v10/projects",
                headers=vercel_headers,
                json=project_payload
            )

            # 409 means project already exists, which is fine
            if project_response.status_code == 409:
                pass
            elif project_response.status_code not in [200, 201]:
                error_text = project_response.text
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create Vercel project: {error_text}"
                )

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Vercel API request timed out")
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Vercel API request failed: {str(e)}")

        # 3. Create Deployment
        deployment_payload = {
            "name": project_name,
            "gitSource": {
                "type": "github",
                "repo": request.repo_name,
                "repoId": str(repo_id),
                "ref": deploy_branch
            },
            "target": "production"
        }

        try:
            deployment_response = await client.post(
                "https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1",
                headers=vercel_headers,
                json=deployment_payload
            )

            if deployment_response.status_code not in [200, 201]:
                error_text = deployment_response.text
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create Vercel deployment: {error_text}"
                )

            deployment_data = deployment_response.json()
            deployment_url = f"https://{deployment_data['url']}"

            aliases = deployment_data.get("alias", [])
            if aliases and len(aliases) > 0:
                production_url = f"https://{aliases[0]}"
            else:
                production_url = f"https://{project_name}.vercel.app"

            inspector_url = deployment_data.get("inspectorUrl")

        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Vercel deployment request timed out")
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Vercel deployment request failed: {str(e)}")

        # 4. Store in Database
        app = App(
            user_id=current_user.id,
            repo_owner=repo_owner,
            repo_name=repo_name_only,
            vercel_project_id=project_name,
            live_url=production_url,
            status="deploying"
        )
        db.add(app)
        db.commit()
        db.refresh(app)

        return DeploymentResponse(
            success=True,
            deployment_url=production_url,
            inspector_url=inspector_url,
            app_id=app.id,
            message=f"Deployment initiated for {request.repo_name}"
        )
