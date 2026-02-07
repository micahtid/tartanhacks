"""GitHub tool functions for Dedalus runner.

Each tool interacts with the GitHub REST API using the user's OAuth token.
Call `make_github_tools(token)` to get a list of bound tool functions.
"""

import base64
import json
from typing import Callable

import httpx

GITHUB_API = "https://api.github.com"


def make_github_tools(github_token: str) -> list[Callable]:
    """Return a list of tool functions bound to the given GitHub token."""

    headers = {
        "Authorization": f"token {github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    def get_file_content(owner: str, repo: str, path: str, ref: str = "main") -> str:
        """Get the contents of a file from a GitHub repository. Returns the decoded file content and its SHA."""
        r = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
            headers=headers,
            params={"ref": ref},
        )
        if r.status_code != 200:
            try:
                error_data = r.json()
                error_msg = error_data.get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        data = r.json()
        content = base64.b64decode(data["content"]).decode()
        return json.dumps({"content": content, "sha": data["sha"], "path": data["path"]})

    def create_branch(owner: str, repo: str, new_branch: str, source_branch: str = "main") -> str:
        """Create a new branch in a GitHub repository from an existing branch."""
        # Get the SHA of the source branch
        r = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{source_branch}",
            headers=headers,
        )
        if r.status_code != 200:
            try:
                error_msg = r.json().get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        sha = r.json()["object"]["sha"]

        # Create the new branch
        r = httpx.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/git/refs",
            headers=headers,
            json={"ref": f"refs/heads/{new_branch}", "sha": sha},
        )
        if r.status_code not in [200, 201]:
            try:
                error_msg = r.json().get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        return json.dumps({"message": f"Branch '{new_branch}' created from '{source_branch}'", "sha": sha})

    def update_file(owner: str, repo: str, path: str, content: str, message: str, branch: str, sha: str) -> str:
        """Update an existing file in a GitHub repository. Requires the file's current SHA."""
        encoded = base64.b64encode(content.encode()).decode()
        r = httpx.put(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
            headers=headers,
            json={
                "message": message,
                "content": encoded,
                "sha": sha,
                "branch": branch,
            },
        )
        if r.status_code not in [200, 201]:
            try:
                error_msg = r.json().get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        data = r.json()
        return json.dumps({
            "message": f"File '{path}' updated on branch '{branch}'",
            "commit_sha": data["commit"]["sha"],
        })

    def create_file(owner: str, repo: str, path: str, content: str, message: str, branch: str) -> str:
        """Create a new file in a GitHub repository."""
        encoded = base64.b64encode(content.encode()).decode()
        r = httpx.put(
            f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
            headers=headers,
            json={
                "message": message,
                "content": encoded,
                "branch": branch,
            },
        )
        if r.status_code not in [200, 201]:
            try:
                error_msg = r.json().get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        data = r.json()
        return json.dumps({
            "message": f"File '{path}' created on branch '{branch}'",
            "commit_sha": data["commit"]["sha"],
        })

    def list_commits(owner: str, repo: str, branch: str = "main", per_page: int = 5) -> str:
        """List recent commits on a branch of a GitHub repository."""
        r = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/commits",
            headers=headers,
            params={"sha": branch, "per_page": per_page},
        )
        if r.status_code != 200:
            try:
                error_msg = r.json().get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        commits = [
            {"sha": c["sha"][:7], "message": c["commit"]["message"], "author": c["commit"]["author"]["name"]}
            for c in r.json()
        ]
        return json.dumps(commits)

    def create_pull_request(owner: str, repo: str, title: str, head: str, base: str = "main", body: str = "") -> str:
        """Create a pull request in a GitHub repository."""
        r = httpx.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
            headers=headers,
            json={"title": title, "head": head, "base": base, "body": body},
        )
        if r.status_code not in [200, 201]:
            try:
                error_msg = r.json().get("message", r.text)
            except Exception:
                error_msg = r.text
            raise Exception(f"GitHub API error {r.status_code}: {error_msg}")
        data = r.json()
        return json.dumps({
            "message": f"Pull request #{data['number']} created",
            "url": data["html_url"],
            "number": data["number"],
        })

    def get_commit_diff(owner: str, repo: str, sha: str) -> str:
        """Get the diff/patch for a specific commit, showing which files changed and what changed."""
        r = httpx.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/commits/{sha}",
            headers={**headers, "Accept": "application/vnd.github.v3.diff"},
            timeout=15.0,
        )
        r.raise_for_status()
        diff = r.text
        # Truncate very large diffs
        if len(diff) > 15000:
            diff = diff[:15000] + "\n... [truncated]"
        return diff

    return [get_file_content, create_branch, update_file, create_file, list_commits, create_pull_request, get_commit_diff]
