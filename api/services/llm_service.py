from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from api.config import settings

logger = logging.getLogger(__name__)

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "anthropic/claude-3.5-sonnet"


# ---------------------------------------------------------------------------
# Public API  –  Sanos AI Engine
# ---------------------------------------------------------------------------

async def analyze_incident(
    incident: Any,
    commits: list[dict[str, Any]],
    files: dict[str, str],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Core Sanos analysis: diagnose an incident and generate a code fix.

    Aggregates incident context (logs, stack traces), recent commits, and
    source files, then sends them to an LLM via OpenRouter to determine root
    cause and produce a patch.

    Parameters
    ----------
    incident : Incident model from ``api.models.incident``
    commits  : Recent commit objects (sha, message, author, files_changed)
    files    : Mapping of file paths → decoded source content
    config   : Optional overrides; recognised keys: ``model``

    Returns
    -------
    dict with keys: model, root_cause, suggested_fix, files_analyzed,
    commits_analyzed, tokens_used
    """
    config = config or {}
    model = config.get("model", DEFAULT_MODEL)

    system_prompt = _build_system_prompt()
    user_message = _build_user_message(incident, commits, files)

    try:
        response = await _call_openrouter(model, system_prompt, user_message)
    except httpx.HTTPStatusError as exc:
        logger.error("OpenRouter API error %s: %s", exc.response.status_code, exc.response.text)
        raise RuntimeError(f"LLM service returned {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        logger.error("OpenRouter request failed: %s", exc)
        raise RuntimeError("Failed to reach LLM service") from exc

    # Parse structured JSON from the LLM response
    llm_text = _extract_text(response)
    parsed = _parse_llm_json(llm_text)

    files_analyzed = list(files.keys())
    commits_analyzed = [c.get("sha", "")[:7] for c in commits]

    # Token usage from OpenRouter response
    usage = response.get("usage", {})
    tokens_used = usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0)

    return {
        "model": model,
        "root_cause": parsed.get("root_cause", "Unable to determine root cause"),
        "suggested_fix": parsed.get("suggested_fix"),
        "files_analyzed": files_analyzed,
        "commits_analyzed": commits_analyzed,
        "tokens_used": tokens_used,
    }


# ---------------------------------------------------------------------------
# OpenRouter API call
# ---------------------------------------------------------------------------

async def _call_openrouter(
    model: str,
    system: str,
    user_message: str,
) -> dict[str, Any]:
    """Send a chat completion request to OpenRouter and return raw JSON."""
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "max_tokens": 4096,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ],
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(OPENROUTER_API_URL, headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the AI engine of Sanos, an automated DevOps incident-response \
platform. Given an incident report, recent git commits, and relevant source \
code, you must:

1. Identify the root cause of the incident.
2. Suggest a concrete code fix as a unified diff patch.

Cross-reference the stack trace and error details with recent commits to \
pinpoint which change likely introduced the regression. Focus on files that \
appear in both the stack trace and recent commit diffs.

Respond with ONLY valid JSON (no markdown fences) in this exact schema:
{
  "root_cause": "<concise explanation: what broke, which commit caused it, and why>",
  "suggested_fix": {
    "file_path": "<path of the file to patch>",
    "patch": "<unified diff patch>",
    "commit_message": "<conventional commit message, e.g. fix: ...>"
  }
}

If you cannot determine a fix, set "suggested_fix" to null but always \
provide a "root_cause".
"""


def _build_system_prompt() -> str:
    return SYSTEM_PROMPT


def _build_user_message(
    incident: Any,
    commits: list[dict[str, Any]],
    files: dict[str, str],
) -> str:
    """Assemble the user message from incident context."""
    sections: list[str] = []

    # --- Incident details ---
    sections.append("## Incident")
    sections.append(f"Title: {incident.title}")
    if incident.description:
        sections.append(f"Description: {incident.description}")
    sections.append(f"Severity: {incident.severity}")
    sections.append(f"Type: {incident.incident_type}")
    if incident.error_message:
        sections.append(f"Error message: {incident.error_message}")
    if incident.stack_trace:
        sections.append(f"Stack trace:\n```\n{incident.stack_trace}\n```")
    if incident.log_data:
        log_snippet = json.dumps(incident.log_data[:10], indent=2)
        sections.append(f"Recent logs:\n```json\n{log_snippet}\n```")

    # --- Commits ---
    if commits:
        sections.append("\n## Recent Commits")
        for c in commits:
            sha = c.get("sha", "?")[:7]
            msg = c.get("message", "")
            author = c.get("author", {}).get("name", "unknown")
            changed = ", ".join(c.get("files_changed", []))
            sections.append(f"- `{sha}` ({author}): {msg}")
            if changed:
                sections.append(f"  Files: {changed}")

    # --- Source files ---
    if files:
        sections.append("\n## Source Files")
        for path, content in files.items():
            truncated = content[:12_000]
            if len(content) > 12_000:
                truncated += "\n... (truncated)"
            sections.append(f"### {path}\n```\n{truncated}\n```")

    return "\n".join(sections)


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _extract_text(response: dict[str, Any]) -> str:
    """Pull text from an OpenRouter chat completion response."""
    choices = response.get("choices", [])
    if choices:
        return choices[0].get("message", {}).get("content", "")
    return ""


def _parse_llm_json(text: str) -> dict[str, Any]:
    """Best-effort parse of JSON from LLM output."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM JSON, returning raw text as root_cause")
        return {"root_cause": text, "suggested_fix": None}
