import httpx

from api.config import settings


async def exchange_code_for_token(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": settings.github_app_client_id,
                "client_secret": settings.github_app_client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        return response.json()


async def get_user_installations(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.github.com/user/installations",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        response.raise_for_status()
        return response.json()


async def get_installation_repos(access_token: str, installation_id: int) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/user/installations/{installation_id}/repositories",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        response.raise_for_status()
        return response.json()


async def get_user_repos(access_token: str) -> list:
    repos = []
    page = 1
    async with httpx.AsyncClient() as client:
        while True:
            response = await client.get(
                "https://api.github.com/user/repos",
                params={"per_page": 100, "page": page, "sort": "updated"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            response.raise_for_status()
            batch = response.json()
            if not batch:
                break
            repos.extend(batch)
            page += 1
    return repos


async def get_repo_details(access_token: str, owner: str, repo: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        response.raise_for_status()
        return response.json()


async def get_github_user(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        response.raise_for_status()
        return response.json()
