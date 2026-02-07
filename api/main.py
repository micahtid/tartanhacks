import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.database import engine, Base
from api.models import User, Session, App, Deployment, Incident, Analysis, PullRequest  # noqa: F401
from api.routers.auth.github import router as github_login_router
from api.routers.auth.callback import router as github_callback_router
from api.routers.user.me import router as me_router
from api.routers.user.permissions import router as permissions_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Sanos API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github_login_router, prefix="/api")
app.include_router(github_callback_router, prefix="/api")
app.include_router(me_router, prefix="/api")
app.include_router(permissions_router, prefix="/api")


@app.get("/api/healthcheck")
async def healthcheck():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)
