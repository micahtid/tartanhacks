import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from api.config import settings
from api.database import Base, engine
from api.models import Analysis, App, Incident, Session, User  # noqa: F401
from api.routers.apps.integrate import router as integrate_router
from api.routers.apps.list import router as apps_router
from api.routers.apps.logs import router as app_logs_router
from api.routers.auth.callback import router as github_callback_router
from api.routers.auth.github import router as github_login_router
from api.routers.deploy.create import router as deploy_router
from api.routers.incidents.analyze import router as incidents_router
from api.routers.playground import router as playground_router
from api.routers.user.me import router as me_router
from api.routers.user.permissions import router as permissions_router
from api.routers.webhooks.logs import router as logs_webhook_router
from api.routers.webhooks.vercel import router as vercel_webhook_router

Base.metadata.create_all(bind=engine)

# Migrate missing columns that create_all won't add to existing tables
with engine.connect() as conn:
    inspector = inspect(engine)
    for table_name, table in Base.metadata.tables.items():
        if not inspector.has_table(table_name):
            continue
        existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
        for col in table.columns:
            if col.name not in existing_cols:
                col_type = col.type.compile(engine.dialect)
                conn.execute(text(
                    f'ALTER TABLE {table_name} ADD COLUMN "{col.name}" {col_type}'
                ))
    conn.commit()

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
app.include_router(app_logs_router, prefix="/api")
app.include_router(deploy_router, prefix="/api")
app.include_router(logs_webhook_router, prefix="/api")
app.include_router(incidents_router, prefix="/api")
app.include_router(vercel_webhook_router, prefix="/api")


@app.get("/api/healthcheck")
async def healthcheck():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)
