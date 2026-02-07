from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from api.config import settings

PROJECT_ROOT = Path(__file__).resolve().parent.parent

db_url = settings.database_url
connect_args = {}
if "sqlite" in db_url:
    connect_args["check_same_thread"] = False
    # Resolve relative SQLite paths against the project root
    prefix = "sqlite:///"
    raw_path = db_url[len(prefix):]
    resolved = (PROJECT_ROOT / raw_path).resolve()
    db_url = f"{prefix}{resolved}"

engine = create_engine(db_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
