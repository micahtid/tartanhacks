# Sanos

## The Issue

You push a commit. The build fails. You open Vercel, scroll through logs, trace it back to a file you changed three commits ago. Fixed. Push again. Now there's a runtime error in production.. But you only find out because a user reports it. You open Inspect Element on their screenshot, try to reproduce locally, dig through the server logs, cross-reference with your recent changes. Thirty minutes later, it was a typo in an API route.

This is the developer debugging loop: fragmented, manual, and scattered across a dozen tabs. Every context switch is lost time. Every missed error is a degraded user experience sitting in production.

**Sanos closes the loop.** It monitors your entire Next.js stack, traces errors to the commits that introduced them, and ships the fix as a reviewed pull request.. Automatically.

https://github.com/user-attachments/assets/99a8d86d-9985-4cc6-a55b-614877bfcd7f

---

## How It Works

### 1. Authenticate with GitHub

Sign in through GitHub OAuth. Sanos requests repository access so it can read your codebase and open pull requests on your behalf.

### 2. Select a Repository

Choose any Next.js repository from your GitHub account. Sanos creates an internal project record and generates a unique webhook key for secure error reporting.

### 3. Integrate Error Listeners

Sanos opens a pull request on your repository that adds three layers of monitoring:

- **`instrumentation.ts:`** Hooks into Next.js server-side `onRequestError` to capture every unhandled exception with full request context (path, method, route type).
- **`sanos-reporter.tsx:`** A client-side component that listens for `window.error` and `unhandledrejection` events, reporting them via `navigator.sendBeacon` so nothing is lost on page unload.
- **`global-error.tsx:`** A React error boundary at the root layout level, catching catastrophic rendering failures.

You review and merge this PR. The listeners are now live.

### 4. Deploy to Vercel

Once the instrumentation PR is merged, Sanos provisions a Vercel project linked to your repository and triggers a production deployment. A Vercel webhook is registered to catch build failures before they ever reach your users.

### 5. Errors Are Detected and Queued

From this point forward, every error (client-side crashes, server exceptions, and failed Vercel builds!) is reported to Sanos in real time. Incoming incidents are deduplicated (same error + same source = one incident!) and placed into a per-app sequential queue to prevent race conditions on concurrent fixes.

### 6. AI-Powered Root Cause Analysis and Fix

For each incident, Sanos:

1. Pulls the last several non-Sanos commits from your repository
2. Retrieves the full diff for each commit
3. Cross-references the diffs against the error's stack trace and message
4. Identifies the commit and exact file responsible
5. Creates a fix branch, implements the correction, and opens a pull request titled `[Sanos] Fix: <error>`

Every fix PR includes a structured analysis: root cause, files examined, and commits traced.

### 7. Code Review with CodeRabbit

This is where the safety net gets serious. Every pull request Sanos opens, whether it is the initial instrumentation setup or an automated fix, goes through [CodeRabbit](https://github.com/marketplace/coderabbitai) for automated code review. CodeRabbit analyzes the diff for code quality issues, security vulnerabilities, performance regressions, and adherence to best practices. This means the AI-generated fixes do not get merged blindly; they are held to the same review standard as any human-written code. If CodeRabbit flags something, the issue is visible directly in the PR conversation before you ever hit merge.

### 8. Review and Merge

The fix PR appears on your Sanos dashboard with a direct link. You can review the changes, read CodeRabbit's assessment, and merge with a single click. The incident is marked resolved, and Vercel redeploys automatically.

---

## The Full Cycle

```
  GitHub OAuth
       |
  Select Repository
       |
  Sanos Opens Instrumentation PR  --->  CodeRabbit Reviews
       |
  Merge PR + Deploy To Vercel
       |
  Error Detected (Client / Server / Build)
       |
  AI Agent Traces Error To Causal Commit
       |
  Fix PR Opened Automatically  --->  CodeRabbit Reviews
       |
  Developer Merges Fix
       |
  Vercel Redeploys. Resolved.
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React / Next.js 14, TypeScript, Tailwind CSS |
| Backend | FastAPI, SQLAlchemy, SQLite |
| AI Agent | [Dedalus Labs SDK](https://dedaluslabs.com) (Claude Sonnet) |
| Code Review | [CodeRabbit](https://github.com/marketplace/coderabbitai) |
| Deployment | Vercel |
| Auth | GitHub OAuth |
