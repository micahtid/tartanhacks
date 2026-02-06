from __future__ import annotations

import logging
from typing import Any

import httpx

from api.config import settings

logger = logging.getLogger(__name__)

BASE_URL_TEMPLATE = "https://api.{site}/api/v2"


def _base_url() -> str:
    return BASE_URL_TEMPLATE.format(site=settings.datadog_site)


def _headers() -> dict[str, str]:
    return {
        "DD-API-KEY": settings.datadog_api_key,
        "DD-APPLICATION-KEY": settings.datadog_app_key,
        "Content-Type": "application/json",
    }


async def fetch_logs(
    query: str,
    time_from: str = "now-1h",
    time_to: str = "now",
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Search DataDog logs matching *query* within a time window.

    Docs: https://docs.datadoghq.com/api/latest/logs/#search-logs
    """
    url = f"{_base_url()}/logs/events/search"
    body = {
        "filter": {
            "query": query,
            "from": time_from,
            "to": time_to,
        },
        "sort": "-timestamp",
        "page": {"limit": limit},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=_headers(), json=body)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])


async def fetch_metrics(
    query: str,
    time_from: int,
    time_to: int,
) -> dict[str, Any]:
    """Query DataDog time-series metrics.

    Docs: https://docs.datadoghq.com/api/latest/metrics/#query-timeseries-data
    """
    url = f"{_base_url().replace('/v2', '/v1')}/query"
    params = {"query": query, "from": time_from, "to": time_to}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=_headers(), params=params)
        resp.raise_for_status()
        return resp.json()


async def get_alert(alert_id: str) -> dict[str, Any] | None:
    """Fetch a single DataDog monitor/alert by ID.

    Docs: https://docs.datadoghq.com/api/latest/monitors/#get-a-monitor-s-details
    """
    url = f"{_base_url().replace('/v2', '/v1')}/monitor/{alert_id}"

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError:
            logger.warning("Failed to fetch DataDog alert %s", alert_id)
            return None


async def fetch_logs_for_service(
    service: str, limit: int = 50
) -> list[dict[str, Any]]:
    """Convenience wrapper: fetch recent error-level logs for a service."""
    query = f"service:{service} status:error"
    return await fetch_logs(query=query, limit=limit)
