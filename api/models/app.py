import secrets
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from api.database import Base


class App(Base):
    __tablename__ = "apps"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    repo_owner = Column(String, nullable=False)
    repo_name = Column(String, nullable=False)
    vercel_project_id = Column(String, nullable=True)
    live_url = Column(String, nullable=True)
    status = Column(String, default="pending")
    instrumented = Column(Boolean, default=False)
    webhook_key = Column(String, unique=True, default=lambda: secrets.token_urlsafe(24))
    pipeline_step = Column(String, default="pending")
    pr_url = Column(String, nullable=True)
    pr_number = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="apps")
    incidents = relationship("Incident", back_populates="app")
