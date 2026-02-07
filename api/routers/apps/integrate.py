import re
import traceback

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from api.database import SessionLocal, get_db
from api.models.app import App
from api.models.user import User
from api.utils.auth import get_current_user
from api.services.dedalus_service import run_dedalus_agent

router = APIRouter()


async def _run_integration(app_id: int, github_token: str, webhook_key: str, repo_owner: str, repo_name: str):
    db = SessionLocal()
    try:
        app = db.query(App).filter(App.id == app_id).first()
        if not app:
            return

        prompt = f"""You are integrating error monitoring into a Next.js application.

Repository: {repo_owner}/{repo_name}

CRITICAL RULES:
- If the project uses a `src/` directory (i.e. `src/app/` exists), ALL new files go inside `src/`. You must NEVER create a root-level `app/` directory. Next.js prioritizes root `app/` over `src/app/`, which causes all routes to 404.
- You are creating exactly THREE files and modifying ONE existing file. No more, no less.

Steps:
1. Detect the project structure: try to get the file `src/app/layout.tsx`.
   - If it EXISTS → this is a **src/-based** project. Remember the layout path as `src/app/layout.tsx`.
   - If it does NOT exist → this is a **root-based** project. The layout path is `app/layout.tsx`.

2. Create a new branch called `sanos/integrate-listeners` from the default branch (try `main` first, if that fails try `master`).

3. Create the instrumentation file (for SERVER-SIDE errors only).
   - src/-based project → create at `src/instrumentation.ts`
   - root-based project → create at `instrumentation.ts`

   This file exports both `register()` and `onRequestError()` directly (this is the Next.js convention — do NOT put onRequestError in a separate file):

```typescript
export async function register() {{
  // Called once when the server starts
}}

export async function onRequestError(
  error: {{ digest: string }} & Error,
  request: {{
    path: string;
    method: string;
    headers: {{ [key: string]: string | string[] }};
  }},
  context: {{
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "proxy";
    renderSource: string;
    revalidateReason: "on-demand" | "stale" | undefined;
    renderType: "dynamic" | "dynamic-resume";
  }}
) {{
  await fetch("http://localhost:8000/api/webhooks/logs", {{
    method: "POST",
    headers: {{ "Content-Type": "application/json" }},
    body: JSON.stringify({{
      webhook_key: "{webhook_key}",
      source: "server",
      error_message: error.message,
      stack_trace: error.stack || null,
      logs: {{
        digest: error.digest,
        path: request.path,
        method: request.method,
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        renderSource: context.renderSource,
      }},
    }}),
  }}).catch(() => {{}});
}}
```

4. Create the client-side error reporter component (for ALL client-side errors: event handlers, async errors, unhandled rejections, etc.).
   - src/-based project → create at `src/app/components/sanos-reporter.tsx`
   - root-based project → create at `app/components/sanos-reporter.tsx`

   NOTE: `global-error.tsx` only catches errors that crash the root layout. It does NOT catch event handler errors or async errors. This component uses `window.addEventListener` to catch ALL uncaught client-side errors.
   NOTE: This component uses `navigator.sendBeacon` instead of `fetch` so that error reports survive page navigations and unloads.

```tsx
"use client";

import {{ useEffect }} from "react";

export default function SanosReporter() {{
  useEffect(() => {{
    function reportError(source: string, message: string, stack?: string | null) {{
      const payload = JSON.stringify({{
        webhook_key: "{webhook_key}",
        source,
        error_message: message,
        stack_trace: stack || null,
      }});
      navigator.sendBeacon(
        "http://localhost:8000/api/webhooks/logs",
        new Blob([payload], {{ type: "application/json" }})
      );
    }}

    function handleError(event: ErrorEvent) {{
      reportError("client-error", event.message, event.error?.stack);
    }}

    function handleRejection(event: PromiseRejectionEvent) {{
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : null;
      reportError("client-rejection", message, stack);
    }}

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {{
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    }};
  }}, []);

  return null;
}}
```

5. Create the global error fallback UI at exactly ONE of these paths:
   - src/-based project → `src/app/global-error.tsx` (inside the EXISTING `src/app/` directory)
   - root-based project → `app/global-error.tsx` (inside the EXISTING `app/` directory)

   NEVER create a new directory for this file. The `app/` directory already exists.

   Check if the file already exists at that path. If it does, get its content and SHA, then update it to include the Sanos error reporting. If it does NOT exist, create it with this content:

```tsx
"use client";

export default function GlobalError({{
  error,
  reset,
}}: {{
  error: Error & {{ digest?: string }};
  reset: () => void;
}}) {{
  if (typeof window !== "undefined") {{
    const payload = JSON.stringify({{
      webhook_key: "{webhook_key}",
      source: "client-global",
      error_message: error.message,
      stack_trace: error.stack || null,
    }});
    navigator.sendBeacon(
      "http://localhost:8000/api/webhooks/logs",
      new Blob([payload], {{ type: "application/json" }})
    );
  }}

  return (
    <html>
      <body>
        <h2>Something went wrong!</h2>
        <button onClick={{() => reset()}}>Try again</button>
      </body>
    </html>
  );
}}
```

6. Modify the EXISTING root layout file to include the SanosReporter component.
   - Get the current content and SHA of the layout file (the path you identified in step 1).
   - Add `import SanosReporter from "./components/sanos-reporter";` to the imports.
   - Add `<SanosReporter />` as the first child inside the `<body>` tag.
   - Update the file with the modified content, preserving ALL existing code.

7. Create a pull request from `sanos/integrate-listeners` to the default branch with:
   - Title: "[Sanos] Add error monitoring instrumentation"
   - Body: "This PR adds automatic error monitoring for Sanos.\\n\\n- `instrumentation.ts` — captures server-side errors via the Next.js `onRequestError` hook\\n- `sanos-reporter.tsx` — catches all client-side errors (event handlers, async, unhandled rejections) via window error listeners\\n- `global-error.tsx` — fallback UI when the root layout crashes\\n\\nMerge this PR to enable error monitoring on your deployed app."

IMPORTANT: Every commit message you create MUST start with "[Sanos]". For example: "[Sanos] Add instrumentation.ts for server-side error capture"

IMPORTANT: After creating the PR, output the PR URL on its own line in this exact format (no other text on the line):
SANOS_PR=https://github.com/{repo_owner}/{repo_name}/pull/NUMBER
Replace NUMBER with the actual PR number. Example:
SANOS_PR=https://github.com/{repo_owner}/{repo_name}/pull/42
"""

        try:
            result = await run_dedalus_agent(github_token, prompt)
            agent_output = result.get("agent_output", "")

            # Parse PR URL — match the exact GitHub PR URL pattern
            # This handles any format: SANOS_PR=url, PR_URL: url, or bare url
            pr_match = re.search(
                r"https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/pull/(\d+)",
                agent_output,
            )

            if pr_match:
                app.pr_url = pr_match.group(0)
                app.pr_number = int(pr_match.group(1))
            else:
                print(f"[Integration Warning] Could not parse PR URL from agent output: {agent_output[-500:]}")

            app.pipeline_step = "pr_created"
            db.commit()
        except Exception as e:
            print(f"[Integration Error] {type(e).__name__}: {e}")
            print(traceback.format_exc())
            app.pipeline_step = "error"
            db.commit()
    finally:
        db.close()


@router.post("/apps/{app_id}/integrate")
async def integrate_app(
    app_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    app = db.query(App).filter(App.id == app_id, App.user_id == user.id).first()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    if app.pipeline_step not in ("pending", "error"):
        return {"status": "already_started", "pipeline_step": app.pipeline_step}

    app.pipeline_step = "integrating"
    db.commit()

    github_token = user.access_token
    if not github_token:
        raise HTTPException(status_code=401, detail="No GitHub access token")

    background_tasks.add_task(
        _run_integration,
        app_id=app.id,
        github_token=github_token,
        webhook_key=app.webhook_key,
        repo_owner=app.repo_owner,
        repo_name=app.repo_name,
    )

    return {"status": "integrating", "pipeline_step": "integrating"}
