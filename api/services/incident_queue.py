import asyncio

from api.database import SessionLocal
from api.models.incident import Incident
from api.routers.incidents.analyze import _run_incident_analysis

_app_queues: dict[int, asyncio.Queue] = {}
_app_workers: dict[int, asyncio.Task] = {}


def enqueue_incident(
    app_id: int,
    incident_id: int,
    github_token: str,
    repo_owner: str,
    repo_name: str,
    error_message: str,
    stack_trace: str | None,
    logs: dict | list | None,
):
    """Add an incident to the per-app queue and ensure the worker is running."""
    if app_id not in _app_queues:
        _app_queues[app_id] = asyncio.Queue()

    _app_queues[app_id].put_nowait({
        "incident_id": incident_id,
        "app_id": app_id,
        "github_token": github_token,
        "repo_owner": repo_owner,
        "repo_name": repo_name,
        "error_message": error_message,
        "stack_trace": stack_trace,
        "logs": logs,
    })

    # Start worker if not already running
    if app_id not in _app_workers or _app_workers[app_id].done():
        _app_workers[app_id] = asyncio.create_task(_worker(app_id))


async def _worker(app_id: int):
    """Process incidents sequentially for a single app."""
    queue = _app_queues[app_id]
    try:
        while not queue.empty():
            item = queue.get_nowait()

            # Deduplication: skip if an open/analyzing/pr_created incident
            # with the same app_id + source + error_message already exists
            skip = False
            db = SessionLocal()
            try:
                existing = (
                    db.query(Incident)
                    .filter(
                        Incident.app_id == item["app_id"],
                        Incident.error_message == item["error_message"],
                        Incident.id != item["incident_id"],
                        Incident.status.in_(["open", "analyzing", "pr_created"]),
                    )
                    .first()
                )
                if existing:
                    skip = True
            finally:
                db.close()

            if skip:
                print(f"[IncidentQueue] Skipping duplicate incident {item['incident_id']} for app {app_id}")
                continue

            await _run_incident_analysis(
                incident_id=item["incident_id"],
                app_id=item["app_id"],
                github_token=item["github_token"],
                repo_owner=item["repo_owner"],
                repo_name=item["repo_name"],
                error_message=item["error_message"],
                stack_trace=item["stack_trace"],
                logs=item["logs"],
            )
    finally:
        _app_workers.pop(app_id, None)
