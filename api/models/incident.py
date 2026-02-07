from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship

from api.database import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    app_id = Column(Integer, ForeignKey("apps.id"), nullable=False)
    type = Column(String, nullable=False)  # runtime_error, build_error, threshold_breach
    source = Column(String, nullable=False)  # server, client-global, datadog, vercel
    status = Column(String, default="open")  # open, analyzing, pr_created, resolved
    error_message = Column(Text, nullable=False)
    stack_trace = Column(Text, nullable=True)
    logs = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    resolved_at = Column(DateTime, nullable=True)

    app = relationship("App", back_populates="incidents")
    analyses = relationship("Analysis", back_populates="incident", cascade="all, delete-orphan")


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), nullable=False)
    llm_model = Column(String, nullable=True)  # gemini, claude
    prompt = Column(Text, nullable=True)
    root_cause = Column(Text, nullable=True)
    suggested_fix = Column(JSON, nullable=True)  # JSON with code changes
    files_analyzed = Column(JSON, nullable=True)  # JSON list of file paths
    commits_analyzed = Column(JSON, nullable=True)  # JSON list of commit SHAs
    pr_url = Column(String, nullable=True)
    pr_number = Column(Integer, nullable=True)
    branch_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    tokens_used = Column(Integer, nullable=True)

    incident = relationship("Incident", back_populates="analyses")
