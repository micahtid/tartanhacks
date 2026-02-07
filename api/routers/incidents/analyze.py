import re
import traceback
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from api.database import SessionLocal, get_db
from api.models.app import App
from api.models.incident import Analysis, Incident
from api.models.user import User
from api.services.dedalus_service import run_dedalus_agent
from api.utils.auth import get_current_user

router = APIRouter()


async def _run_incident_analysis(incident_id: int, app_id: int, github_token: str,
                                  repo_owner: str, repo_name: str,
                                  error_message: str, stack_trace: str | None,
                                  logs: dict | list | None):
    """Background task: analyze an incident using Dedalus, create a fix branch + PR."""
    db = SessionLocal()
    try:
        incident = db.query(Incident).filter(Incident.id == incident_id).first()
        if not incident:
            return

        incident.status = "analyzing"
        db.commit()

        logs_str = str(logs) if logs else "No additional logs"
        stack_str = stack_trace or "No stack trace available"

        prompt = f"""You are analyzing a production incident for a Next.js application and creating a fix.

Repository: {repo_owner}/{repo_name}

INCIDENT DETAILS:
- Error Message: {error_message}
- Stack Trace: {stack_str}
- Logs: {logs_str}

STEPS:

1. First, list the recent commits on the default branch (try `main`, if that fails try `master`). You need to find the last 3 commits that do NOT have "[Sanos]" in their commit message. These are user commits that may have introduced the bug.

2. For each of those 3 commits, use `get_commit_diff` to see what files were changed and what the changes were.

3. Analyze the error message, stack trace, and logs against the diffs from those 3 commits. Determine which commit and which file change is most likely responsible for the incident.

4. Once you identify the problematic file(s), use `get_file_content` to read the current version of each file.

5. Create a new branch called `sanos/fix-incident-{incident_id}` from the default branch.
   If branch creation FAILS because the branch already exists, do NOT stop or skip the task. Instead, retry with a numbered suffix: `sanos/fix-incident-{incident_id}-2`, then `-3`, etc. until it succeeds. Use whichever branch name succeeds for all subsequent steps (including the PR).

6. Fix the issue by updating the problematic file(s). Every commit message MUST start with "[Sanos]".
   For example: "[Sanos] Fix null reference in user handler"

7. Create a pull request from `sanos/fix-incident-{incident_id}` to the default branch with:
   - Title: "[Sanos] Fix: {error_message[:80]}"
   - Body explaining the root cause and the fix

IMPORTANT: After creating the PR, output your analysis in this exact format:

ROOT_CAUSE: <one-paragraph explanation of what caused the error>
FILES_ANALYZED: <comma-separated list of file paths you examined>
COMMITS_ANALYZED: <comma-separated list of short SHAs you examined>
SANOS_PR=https://github.com/{repo_owner}/{repo_name}/pull/NUMBER

Replace NUMBER with the actual PR number.
"""

        try:
            result = await run_dedalus_agent(github_token, prompt)
            agent_output = result.get("agent_output", "")

            # Parse root cause
            root_cause = None
            rc_match = re.search(r"ROOT_CAUSE:\s*(.+?)(?=\nFILES_ANALYZED:|$)", agent_output, re.DOTALL)
            if rc_match:
                root_cause = rc_match.group(1).strip()

            # Parse files analyzed
            files_analyzed = None
            fa_match = re.search(r"FILES_ANALYZED:\s*(.+?)(?=\nCOMMITS_ANALYZED:|$)", agent_output, re.DOTALL)
            if fa_match:
                files_analyzed = [f.strip() for f in fa_match.group(1).strip().split(",") if f.strip()]

            # Parse commits analyzed
            commits_analyzed = None
            ca_match = re.search(r"COMMITS_ANALYZED:\s*(.+?)(?=\nSANOS_PR=|$)", agent_output, re.DOTALL)
            if ca_match:
                commits_analyzed = [c.strip() for c in ca_match.group(1).strip().split(",") if c.strip()]

            # Parse PR URL
            pr_url = None
            pr_number = None
            pr_match = re.search(
                r"https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/pull/(\d+)",
                agent_output,
            )
            if pr_match:
                pr_url = pr_match.group(0)
                pr_number = int(pr_match.group(1))

            analysis = Analysis(
                incident_id=incident_id,
                llm_model="claude-sonnet-4",
                prompt=prompt,
                root_cause=root_cause or "Analysis completed but root cause could not be parsed.",
                suggested_fix={"agent_output": agent_output[-2000:]},
                files_analyzed=files_analyzed,
                commits_analyzed=commits_analyzed,
                pr_url=pr_url,
                pr_number=pr_number,
                branch_name=f"sanos/fix-incident-{incident_id}",
            )
            db.add(analysis)

            if pr_url:
                incident.status = "pr_created"
            else:
                incident.status = "analyzing"
                print(f"[Incident Analysis Warning] No PR URL parsed from output: {agent_output[-500:]}")

            db.commit()

        except Exception as e:
            print(f"[Incident Analysis Error] {type(e).__name__}: {e}")
            print(traceback.format_exc())
            # Still create analysis record with error info
            analysis = Analysis(
                incident_id=incident_id,
                llm_model="claude-sonnet-4",
                prompt=prompt,
                root_cause=f"Analysis failed: {type(e).__name__}: {e}",
                suggested_fix=None,
                files_analyzed=None,
                commits_analyzed=None,
            )
            db.add(analysis)
            incident.status = "open"  # Reset to open so it can be retried
            db.commit()

    finally:
        db.close()


@router.delete("/apps/{app_id}/incidents/{incident_id}")
async def delete_incident(
    app_id: int,
    incident_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    incident = db.query(Incident).filter(Incident.id == incident_id, Incident.app_id == app_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    db.delete(incident)
    db.commit()
    return {"ok": True}


@router.get("/apps/{app_id}/incidents/{incident_id}/analyses")
async def get_incident_analyses(
    app_id: int,
    incident_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    analyses = (
        db.query(Analysis)
        .filter(Analysis.incident_id == incident_id)
        .order_by(Analysis.created_at.desc())
        .all()
    )

    return [
        {
            "id": a.id,
            "incident_id": a.incident_id,
            "llm_model": a.llm_model,
            "root_cause": a.root_cause,
            "suggested_fix": a.suggested_fix,
            "files_analyzed": a.files_analyzed,
            "commits_analyzed": a.commits_analyzed,
            "pr_url": a.pr_url,
            "pr_number": a.pr_number,
            "branch_name": a.branch_name,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "tokens_used": a.tokens_used,
        }
        for a in analyses
    ]


@router.post("/apps/{app_id}/incidents/{incident_id}/resolve")
async def resolve_incident(
    app_id: int,
    incident_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    incident = db.query(Incident).filter(Incident.id == incident_id, Incident.app_id == app_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Try to merge the PR on GitHub if one exists
    analysis = (
        db.query(Analysis)
        .filter(Analysis.incident_id == incident_id, Analysis.pr_number.isnot(None))
        .order_by(Analysis.created_at.desc())
        .first()
    )

    merge_status = None
    if analysis and analysis.pr_number:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.put(
                    f"https://api.github.com/repos/{app.repo_owner}/{app.repo_name}/pulls/{analysis.pr_number}/merge",
                    headers={
                        "Authorization": f"Bearer {user.access_token}",
                        "Accept": "application/vnd.github.v3+json",
                    },
                    json={
                        "commit_title": f"[Sanos] Merge fix for incident #{incident_id}",
                        "merge_method": "squash",
                    },
                )
                if res.status_code == 200:
                    merge_status = "merged"
                else:
                    merge_status = f"merge_failed: {res.status_code}"
                    print(f"[PR Merge Warning] {res.status_code}: {res.text[:200]}")
        except Exception as e:
            merge_status = f"merge_error: {e}"
            print(f"[PR Merge Error] {type(e).__name__}: {e}")

    incident.status = "resolved"
    incident.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(incident)

    return {
        "ok": True,
        "incident_id": incident.id,
        "status": incident.status,
        "resolved_at": incident.resolved_at.isoformat(),
        "merge_status": merge_status,
    }
