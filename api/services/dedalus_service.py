import io
import os
import sys
import traceback

from dedalus_labs import AsyncDedalus, DedalusRunner

from api.config import settings
from api.tools.github import make_github_tools
from api.services.log_store import log_store


class LogCapture:
    """Context manager to capture stdout/stderr and send to log_store."""
    
    def __init__(self, app_id: int):
        self.app_id = app_id
        self._stdout = None
        self._stderr = None
        self._stdout_capture = None
        self._stderr_capture = None
    
    def __enter__(self):
        self._stdout = sys.stdout
        self._stderr = sys.stderr
        self._stdout_capture = _TeeWriter(self._stdout, self.app_id)
        self._stderr_capture = _TeeWriter(self._stderr, self.app_id)
        sys.stdout = self._stdout_capture
        sys.stderr = self._stderr_capture
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout = self._stdout
        sys.stderr = self._stderr
        return False


class _TeeWriter:
    """Writer that sends output to both original stream and log_store."""
    
    def __init__(self, original, app_id: int):
        self.original = original
        self.app_id = app_id
        self._buffer = ""
    
    def write(self, text: str):
        self.original.write(text)
        self._buffer += text
        # Flush complete lines to log store
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line.strip():
                log_store.append(self.app_id, "dedalus", line)
    
    def flush(self):
        self.original.flush()
        # Flush any remaining buffer
        if self._buffer.strip():
            log_store.append(self.app_id, "dedalus", self._buffer)
            self._buffer = ""


async def run_dedalus_agent(github_token: str, prompt: str, app_id: int | None = None) -> dict:
    """Run the Dedalus agent with the given prompt and GitHub tools.
    
    Args:
        github_token: GitHub access token for API calls
        prompt: The prompt to send to the agent
        app_id: Optional app ID to capture logs for
    """
    api_key = settings.dedalus_api_key
    client = AsyncDedalus(api_key=api_key)
    runner = DedalusRunner(client=client, verbose=True)
    tools = make_github_tools(github_token)

    # Log that we're starting
    if app_id:
        log_store.append(app_id, "dedalus", "[Dedalus] Starting agent...")

    try:
        if app_id:
            with LogCapture(app_id):
                result = await runner.run(
                    input=prompt,
                    model="anthropic/claude-sonnet-4-20250514",
                    tools=tools,
                )
        else:
            result = await runner.run(
                input=prompt,
                model="anthropic/claude-sonnet-4-20250514",
                tools=tools,
            )
    except Exception as e:
        error_msg = f"[Dedalus Error] {type(e).__name__}: {e}"
        print(error_msg)
        print(f"[Dedalus Error] Traceback:\n{traceback.format_exc()}")
        if app_id:
            log_store.append(app_id, "dedalus", error_msg)
        raise

    if app_id:
        log_store.append(app_id, "dedalus", "[Dedalus] Agent completed successfully.")

    # Collect all text content from the result - final output plus all tool results
    all_content = result.final_output or ""
    
    # Debug: Log the result structure
    print(f"[Dedalus Debug] Final output: {result.final_output[:500] if result.final_output else 'None'}")
    print(f"[Dedalus Debug] Has tool_results: {hasattr(result, 'tool_results')}")
    
    # Also extract text from tool results to find URLs
    if hasattr(result, 'tool_results') and result.tool_results:
        print(f"[Dedalus Debug] Number of tool_results: {len(result.tool_results)}")
        for i, tr in enumerate(result.tool_results):
            if isinstance(tr, dict):
                tool_name = tr.get('name', 'unknown')
                result_text = tr.get('result', '')
                print(f"[Dedalus Debug] Tool {i}: {tool_name} -> {str(result_text)[:200]}")
                
                # Log create_pull_request results specifically
                if tool_name == 'create_pull_request' and result_text:
                    log_store.append(app_id, "dedalus", f"[PR Created] {result_text}")
                
                if isinstance(result_text, str):
                    all_content += "\n" + result_text
    else:
        print("[Dedalus Debug] No tool_results found in result object")
        # Try other attributes
        for attr in dir(result):
            if not attr.startswith('_'):
                val = getattr(result, attr, None)
                if val:
                    print(f"[Dedalus Debug] result.{attr}: {str(val)[:200]}")

    return {
        "success": True,
        "agent_output": all_content if all_content.strip() else str(result),
    }

