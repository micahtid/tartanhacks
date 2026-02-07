import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.database import engine, Base
from api.models import User, Session, App, Incident, Analysis  # noqa: F401
from api.routers.auth.github import router as github_login_router
from api.routers.auth.callback import router as github_callback_router
from api.routers.user.me import router as me_router
from api.routers.user.permissions import router as permissions_router
from api.routers.playground import router as playground_router
from api.routers.apps.list import router as apps_router
from api.routers.apps.integrate import router as integrate_router
from api.routers.deploy.create import router as deploy_router
from api.routers.webhooks.logs import router as webhooks_router
from api.routers.incidents.analyze import router as incidents_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Sanos API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github_login_router, prefix="/api")
app.include_router(github_callback_router, prefix="/api")
app.include_router(me_router, prefix="/api")
app.include_router(permissions_router, prefix="/api")
app.include_router(playground_router, prefix="/api")
app.include_router(apps_router, prefix="/api")
app.include_router(integrate_router, prefix="/api")
app.include_router(deploy_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
app.include_router(incidents_router, prefix="/api")


@app.get("/api/healthcheck")
async def healthcheck():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)
