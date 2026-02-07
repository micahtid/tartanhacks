"""In-memory log store for capturing and retrieving process logs.

This module provides a simple in-memory storage for logs from Dedalus
integration and Vercel deployment processes, keyed by app_id.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

LogType = Literal["dedalus", "vercel"]


@dataclass
class LogEntry:
    """A single log entry with timestamp and message."""
    timestamp: datetime
    message: str


@dataclass
class AppLogs:
    """Log storage for a single app."""
    dedalus: list[LogEntry] = field(default_factory=list)
    vercel: list[LogEntry] = field(default_factory=list)
    max_entries: int = 500  # Keep last 500 log lines per type


class LogStore:
    """In-memory log store for process logs, keyed by app_id."""

    def __init__(self):
        self._logs: dict[int, AppLogs] = defaultdict(AppLogs)

    def append(self, app_id: int, log_type: LogType, message: str) -> None:
        """Append a log message for the given app and type."""
        app_logs = self._logs[app_id]
        log_list = getattr(app_logs, log_type)
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc),
            message=message.rstrip()
        )
        log_list.append(entry)
        
        # Trim to max entries
        if len(log_list) > app_logs.max_entries:
            excess = len(log_list) - app_logs.max_entries
            del log_list[:excess]

    def append_lines(self, app_id: int, log_type: LogType, text: str) -> None:
        """Append multiple lines from a text block."""
        for line in text.splitlines():
            if line.strip():
                self.append(app_id, log_type, line)

    def get_logs(self, app_id: int, log_type: LogType, limit: int | None = None) -> list[str]:
        """Get log messages for the given app and type.
        
        Args:
            app_id: The app ID to get logs for
            log_type: Either "dedalus" or "vercel"
            limit: Optional limit on number of lines to return (most recent)
            
        Returns:
            List of log message strings (most recent last)
        """
        app_logs = self._logs.get(app_id)
        if not app_logs:
            return []
        
        log_list = getattr(app_logs, log_type)
        messages = [entry.message for entry in log_list]
        
        if limit is not None and limit > 0:
            return messages[-limit:]
        return messages

    def clear(self, app_id: int, log_type: LogType | None = None) -> None:
        """Clear logs for an app, optionally only for a specific type."""
        if app_id not in self._logs:
            return
        
        if log_type is None:
            del self._logs[app_id]
        else:
            setattr(self._logs[app_id], log_type, [])


# Global singleton instance
log_store = LogStore()
