"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

interface AppDetail {
  id: number;
  repo_owner: string;
  repo_name: string;
  full_name: string;
  status: string;
  live_url: string | null;
  vercel_project_id: string | null;
  instrumented: boolean;
  pipeline_step: string | null;
  pr_url: string | null;
  pr_number: number | null;
  webhook_key: string | null;
  created_at: string | null;
}

interface AnalysisData {
  id: number;
  llm_model: string | null;
  root_cause: string | null;
  suggested_fix: Record<string, unknown> | null;
  files_analyzed: string[] | null;
  commits_analyzed: string[] | null;
  pr_url: string | null;
  pr_number: number | null;
  branch_name: string | null;
  created_at: string | null;
  tokens_used: number | null;
}

interface IncidentData {
  id: number;
  type: string;
  source: string;
  status: string;
  error_message: string;
  stack_trace: string | null;
  logs: Record<string, unknown> | null;
  created_at: string | null;
  resolved_at: string | null;
  analyses: AnalysisData[];
}

type CardState = "waiting" | "active" | "complete" | "error";
type TabMode = "setup" | "incidents";

const IS_DEV =
  typeof window !== "undefined" &&
  window.location.hostname === "localhost";

const MOCK_INCIDENTS: IncidentData[] = [
  {
    id: 9001,
    type: "runtime_error",
    source: "server",
    status: "pr_created",
    error_message:
      "TypeError: Cannot read properties of undefined (reading 'map')",
    stack_trace:
      "TypeError: Cannot read properties of undefined (reading 'map')\n    at UserList (/app/components/UserList.tsx:14:22)\n    at renderWithHooks (node_modules/react-dom/...)\n    at mountIndeterminateComponent (node_modules/react-dom/...)",
    logs: { level: "error", service: "web", timestamp: "2026-02-07T08:12:00Z" },
    created_at: new Date(Date.now() - 1000 * 60 * 23).toISOString(),
    resolved_at: null,
    analyses: [
      {
        id: 8001,
        llm_model: "claude-sonnet-4-5-20250929",
        root_cause:
          "The `users` prop is not awaited before rendering — the parent component passes a Promise instead of resolved data after the migration to async server components.",
        suggested_fix: {
          description: "Await the data fetch before passing it as a prop.",
        },
        files_analyzed: ["components/UserList.tsx", "app/dashboard/page.tsx"],
        commits_analyzed: ["a1b2c3d"],
        pr_url: "https://github.com/demo/repo/pull/42",
        pr_number: 42,
        branch_name: "sanos/fix-userlist-map",
        created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
        tokens_used: 12400,
      },
    ],
  },
  {
    id: 9002,
    type: "runtime_error",
    source: "client-global",
    status: "analyzing",
    error_message:
      "Unhandled promise rejection: NetworkError when attempting to fetch resource",
    stack_trace:
      "TypeError: NetworkError when attempting to fetch resource\n    at async fetchData (/app/lib/api.ts:27:18)\n    at async Dashboard (/app/dashboard/page.tsx:9:20)",
    logs: null,
    created_at: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    resolved_at: null,
    analyses: [],
  },
  {
    id: 9003,
    type: "threshold_breach",
    source: "datadog",
    status: "open",
    error_message:
      "P95 latency exceeded 2 000 ms on /api/search for 5 consecutive minutes",
    stack_trace: null,
    logs: {
      monitor: "api-latency-p95",
      threshold: "2000ms",
      actual: "3420ms",
      region: "us-east-1",
    },
    created_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    resolved_at: null,
    analyses: [],
  },
  {
    id: 9004,
    type: "build_error",
    source: "vercel",
    status: "resolved",
    error_message:
      "Module not found: Can't resolve '@/components/OldHeader'",
    stack_trace:
      "ModuleNotFoundError: Module not found: Error: Can't resolve '@/components/OldHeader' in '/vercel/path0/app/layout.tsx'",
    logs: { build_id: "bld_abc123", deployment: "dpl_xyz789" },
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    resolved_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    analyses: [
      {
        id: 8002,
        llm_model: "claude-sonnet-4-5-20250929",
        root_cause:
          "The OldHeader component was removed in a recent refactor but the import in layout.tsx was not updated.",
        suggested_fix: {
          description:
            "Replace the OldHeader import with the new Header component.",
        },
        files_analyzed: ["app/layout.tsx", "components/Header.tsx"],
        commits_analyzed: ["d4e5f6a", "b7c8d9e"],
        pr_url: "https://github.com/demo/repo/pull/39",
        pr_number: 39,
        branch_name: "sanos/fix-header-import",
        created_at: new Date(
          Date.now() - 1000 * 60 * 60 * 2.5
        ).toISOString(),
        tokens_used: 8700,
      },
    ],
  },
];

function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Checkmark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 6L9 17l-5-5" stroke="#6ee7b7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="#fca5a5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepCard({
  step,
  title,
  state,
  children,
}: {
  step: number;
  title: string;
  state: CardState;
  children?: React.ReactNode;
}) {
  const borderColor = {
    waiting: "border-white/15",
    active: "border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.05)]",
    complete: "border-white/5",
    error: "border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.05)]",
  }[state];

  const bgColor = {
    waiting: "bg-white/[0.05]",
    active: "bg-yellow-500/[0.08]",
    complete: "bg-white/[0.02]",
    error: "bg-red-500/[0.08]",
  }[state];

  const textColor = state === "complete" ? "text-zinc-600" : "text-white";
  const iconBg = {
    waiting: "bg-white/10",
    active: "bg-yellow-500/20",
    complete: "bg-zinc-800",
    error: "bg-red-500/20",
  }[state];
  
  const iconColor = {
    waiting: "text-white/60",
    active: "text-yellow-400",
    complete: "text-zinc-600",
    error: "text-red-400",
  }[state];

  return (
    <div className={`rounded-2xl border ${borderColor} ${bgColor} px-6 py-5 transition-all duration-500 backdrop-blur-sm ${state === "complete" ? "opacity-40" : "opacity-100"}`}>
      <div className="flex items-center gap-5">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
          {state === "complete" ? (
            <Checkmark />
          ) : state === "error" ? (
            <ErrorIcon />
          ) : state === "active" ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <span className="text-sm font-bold font-accent">{step}</span>
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <h3 className={`text-lg font-semibold tracking-tight ${textColor}`}>{title}</h3>
          {children && (
            <div className="text-[13px] leading-relaxed transition-colors duration-500 mt-1">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startStr: string, endStr?: string | null): string {
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatLabel(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function LiveDuration({ startStr }: { startStr: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{formatDuration(startStr)}</span>;
}

function IncidentRow({
  incident,
  appId,
  token,
  onDelete,
  onResolve,
}: {
  incident: IncidentData;
  appId: string;
  token: string;
  onDelete: (id: number) => void;
  onResolve: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState(false);
  const isResolved = incident.status === "resolved";
  const isQueued = incident.status === "open";
  const latestAnalysis = incident.analyses?.[0] ?? null;

  const statusLabel: Record<string, { text: string; color: string }> = {
    open: { text: "Queued", color: "text-zinc-500" },
    analyzing: { text: "Analyzing", color: "text-yellow-400" },
    pr_created: { text: "PR Ready", color: "text-blue-400" },
    resolved: { text: "Resolved", color: "text-emerald-400" },
  };

  const st = statusLabel[incident.status] || { text: incident.status, color: "text-zinc-400" };

  async function handleDelete() {
    try {
      const res = await fetch(`${API_BASE}/apps/${appId}/incidents/${incident.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) onDelete(incident.id);
    } catch {}
  }

  async function handleResolve() {
    setResolving(true);
    try {
      const res = await fetch(`${API_BASE}/apps/${appId}/incidents/${incident.id}/resolve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) onResolve(incident.id);
    } catch {} finally {
      setResolving(false);
    }
  }

  return (
    <div className={`rounded-xl border border-white/5 transition-all duration-200 ${expanded ? "bg-white/10" : "bg-white/[0.02]"} ${isQueued || isResolved ? "opacity-60" : "opacity-100"}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-5 text-left"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${isResolved ? "bg-emerald-500" : incident.status === "analyzing" ? "bg-yellow-500 animate-pulse" : incident.status === "pr_created" ? "bg-blue-500" : "bg-zinc-600"}`} />
            <p className={`text-base truncate ${isResolved || isQueued ? "text-zinc-500" : "text-white"}`}>{incident.error_message}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className={`text-xs font-bold tracking-wider ${st.color}`}>{st.text}</span>
            <span className="text-sm text-zinc-500">{formatLabel(incident.source)}</span>
            {incident.created_at && !isResolved && (
              <span className="text-sm text-zinc-500 tabular-nums">
                <LiveDuration startStr={incident.created_at} />
              </span>
            )}
            {isResolved && incident.created_at && incident.resolved_at && (
              <span className="text-sm text-zinc-500 tabular-nums">
                {formatDuration(incident.created_at, incident.resolved_at)}
              </span>
            )}
            {incident.created_at && (
              <span className="text-sm text-zinc-600">{timeAgo(incident.created_at)}</span>
            )}
            <svg
              width="18" height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={`text-zinc-600 transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-6 py-5 space-y-5">
          {/* Logs section */}
          {incident.logs && (
            <div>
              <h4 className="text-xs font-bold tracking-wider text-zinc-500 mb-3">Logs</h4>
              <pre className="text-sm text-zinc-400 bg-white/[0.03] rounded-lg p-4 overflow-x-auto max-h-60 whitespace-pre-wrap">
                {JSON.stringify(incident.logs, null, 2)}
              </pre>
            </div>
          )}

          {/* Stack trace */}
          {incident.stack_trace && (
            <div>
              <h4 className="text-xs font-bold tracking-wider text-zinc-500 mb-3">Stack Trace</h4>
              <pre className="text-sm text-zinc-400 bg-white/[0.03] rounded-lg p-4 overflow-x-auto max-h-72 whitespace-pre-wrap">
                {incident.stack_trace}
              </pre>
            </div>
          )}

          {/* Analysis section */}
          {latestAnalysis && (
            <div className="space-y-4">
              {latestAnalysis.root_cause && (
                <div className="bg-white/[0.03] rounded-lg p-4">
                  <p className="text-xs font-bold tracking-wider text-zinc-600 mb-2">Root Cause</p>
                  <p className="text-sm text-zinc-300">{latestAnalysis.root_cause}</p>
                </div>
              )}

              {latestAnalysis.pr_url && incident.status === "resolved" && (
                <div className="flex items-center gap-4 pt-1">
                  <a
                    href={latestAnalysis.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-emerald-400 underline hover:text-emerald-300 transition-colors"
                  >
                    View Merged PR #{latestAnalysis.pr_number}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Analyzing spinner */}
          {incident.status === "analyzing" && !latestAnalysis && (
            <div className="flex items-center gap-4 py-2">
              <Spinner className="h-5 w-5 text-yellow-400" />
              <span className="text-sm text-yellow-400">Analyzing incident and preparing fix...</span>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center pt-3 border-t border-white/5">
            <div className="flex items-center gap-3">
              {latestAnalysis?.pr_url && incident.status === "pr_created" && (
                <>
                  <a
                    href={latestAnalysis.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-6 py-2.5 text-xs tracking-wider rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors font-accent"
                  >
                    Review PR #{latestAnalysis.pr_number}
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleResolve(); }}
                    disabled={resolving}
                    className="px-6 py-2.5 text-xs tracking-wider rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 font-accent"
                  >
                    {resolving ? "Merging..." : "Accept PR"}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className="ml-auto text-zinc-600 hover:text-red-400 transition-colors p-1"
              title="Delete incident"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BuildPage() {
  const router = useRouter();
  const params = useParams();
  const appId = params.id as string;

  const [app, setApp] = useState<AppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabMode>("setup");
  const [incidents, setIncidents] = useState<IncidentData[]>([]);
  const [incidentsLoaded, setIncidentsLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const integrateTriggered = useRef(false);
  const deployTriggered = useRef(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("session") : null;

  // Fetch app details on mount
  useEffect(() => {
    if (!token) {
      router.replace("/");
      return;
    }

    fetch(`${API_BASE}/apps/${appId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("App not found");
        return res.json();
      })
      .then((data: AppDetail) => setApp(data))
      .catch(() => setError("Failed to load app details"));
  }, [appId, router, token]);

  // Fetch incidents on mount so the tab badge count is always visible
  const fetchIncidents = useCallback(() => {
    if (!token) return;
    fetch(`${API_BASE}/apps/${appId}/incidents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data: IncidentData[]) => {
        const realIds = new Set(data.map((i) => i.id));
        const merged = IS_DEV
          ? [...data, ...MOCK_INCIDENTS.filter((m) => !realIds.has(m.id))]
          : data;
        setIncidents(merged);
        setIncidentsLoaded(true);
      })
      .catch(() => {
        if (IS_DEV) {
          setIncidents(MOCK_INCIDENTS);
          setIncidentsLoaded(true);
        }
      });
  }, [token, appId]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // Poll every 5s while on the incidents tab
  useEffect(() => {
    if (tab !== "incidents") return;
    const pollId = setInterval(fetchIncidents, 5000);
    return () => clearInterval(pollId);
  }, [tab, fetchIncidents]);

  // Auto-trigger integration when pipeline_step is "pending"
  useEffect(() => {
    if (!app || !token || integrateTriggered.current) return;
    if (app.pipeline_step === "pending") {
      integrateTriggered.current = true;
      fetch(`${API_BASE}/apps/${app.id}/integrate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [app, token]);

  // Auto-trigger deploy when pipeline_step transitions to "pr_merged"
  const triggerDeploy = useCallback(async () => {
    if (!app || !token || deployTriggered.current) return;
    deployTriggered.current = true;
    try {
      await fetch(`${API_BASE}/deploy/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo_name: `${app.repo_owner}/${app.repo_name}` }),
      });
    } catch {
      // ignore — status polling will pick up the state
    }
  }, [app, token]);

  useEffect(() => {
    if (app?.pipeline_step === "pr_merged") {
      triggerDeploy();
    }
  }, [app?.pipeline_step, triggerDeploy]);

  // Poll status every 3s while pipeline is in progress
  useEffect(() => {
    if (!token || !app) return;

    const pipeline = app.pipeline_step;
    const isTerminal = pipeline === "ready" || (pipeline === "error" && app.status !== "pending");
    if (isTerminal) return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/apps/${appId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setApp((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status,
                  live_url: data.live_url,
                  pipeline_step: data.pipeline_step,
                  pr_url: data.pr_url,
                  pr_number: data.pr_number,
                  webhook_key: data.webhook_key,
                  instrumented: data.instrumented,
                }
              : prev
          );
          if (data.pipeline_step === "ready" || data.pipeline_step === "error") {
            if (intervalRef.current) clearInterval(intervalRef.current);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [appId, app?.pipeline_step, token]);

  // Derive card states from pipeline_step
  const getCardStates = (pipeline: string | null): [CardState, CardState, CardState] => {
    if (!pipeline || pipeline === "ready") {
      return ["complete", "complete", "complete"];
    }
    switch (pipeline) {
      case "pending":
      case "integrating":
        return ["active", "waiting", "waiting"];
      case "pr_created":
        return ["complete", "active", "waiting"];
      case "pr_merged":
        return ["complete", "complete", "active"];
      case "deploying":
        return ["complete", "complete", "active"];
      case "error":
        return ["error", "waiting", "waiting"];
      default:
        return ["waiting", "waiting", "waiting"];
    }
  };

  function handleDeleteIncident(id: number) {
    setIncidents((prev) => prev.filter((i) => i.id !== id));
  }

  function handleResolveIncident(id: number) {
    setIncidents((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "resolved", resolved_at: new Date().toISOString() }
          : i
      )
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#09090b] gap-4">
        <p className="text-sm font-bold tracking-wider text-red-500">{error}</p>
        <button onClick={() => router.push("/dashboard")} className="text-xs tracking-widest text-zinc-400 hover:text-white transition-colors underline font-accent">
          Back
        </button>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
        <Spinner className="h-5 w-5 text-zinc-400" />
      </div>
    );
  }

  const [card1, card2, card3] = getCardStates(app.pipeline_step);

  // Deduplicate and Sort Incidents
  const uniqueIncidents = Array.from(new Map(incidents.map((i) => [i.id, i])).values());
  const sortedIncidents = [...uniqueIncidents].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      pr_created: 0,
      analyzing: 1,
      open: 2,
      resolved: 3,
    };
    const orderA = statusOrder[a.status] ?? 99;
    const orderB = statusOrder[b.status] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });

  const activeCount = uniqueIncidents.filter((i) => i.status !== "resolved").length;

  const tabs: { key: TabMode; label: string; count?: number }[] = [
    { key: "setup", label: "Set Up" },
    { key: "incidents", label: "Incidents", count: activeCount },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] font-sans animate-in fade-in duration-1000">
      <div className="mx-auto w-full max-w-[1100px] px-8 py-12 sm:px-12 lg:px-16">
        {/* Back link */}
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-sm tracking-widest text-zinc-400 hover:text-white transition-colors mb-12 font-accent"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>

        {/* App name */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold text-white tracking-tight">{app.full_name}</h1>
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-full px-4 py-1 text-[11px] tracking-widest bg-white/20 text-white/80 border border-white/10 font-accent">
              App ID: {app.id}
            </span>
          </div>
        </div>
        <p className="text-xs text-zinc-400 tracking-[0.05em] mb-12 font-accent">
          Project Deployment & Monitoring
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-10 border-b border-white/10">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-6 py-3 text-sm tracking-widest transition-all relative flex items-center gap-2 font-accent ${
                tab === t.key
                  ? "text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="text-xs font-bold text-red-400 leading-none self-center">
                  {t.count}
                </span>
              )}
              {tab === t.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "setup" && (
          <div className="flex flex-col gap-4">
            <StepCard step={1} title="Integrating Error Listeners" state={card1}>
              {card1 === "active" && (
                <p className="text-zinc-300">
                  Creating instrumentation files and opening a PR on your repository...
                </p>
              )}
              {card1 === "complete" && (
                <p className="text-zinc-500">Instrumentation PR created.</p>
              )}
              {card1 === "error" && (
                <p className="text-red-400">
                  Failed to create instrumentation PR. You can retry by refreshing the page.
                </p>
              )}
              {card1 === "waiting" && (
                <p className="text-zinc-400">Wait for instrumentation to begin.</p>
              )}
            </StepCard>

            <StepCard step={2} title="Accept Integration PR" state={card2}>
              {card2 === "active" && (
                app.pr_url ? (
                  <a
                    href={app.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-300 underline hover:text-white transition-colors"
                  >
                    Review and merge the PR to continue.
                  </a>
                ) : (
                  <p className="text-zinc-300">Review and merge the PR to continue.</p>
                )
              )}
              {card2 === "complete" && (
                <p className="text-zinc-500">PR merged successfully.</p>
              )}
              {card2 === "waiting" && (
                <p className="text-zinc-400">Pending instrumentation...</p>
              )}
            </StepCard>

            <StepCard step={3} title="Vercel Deployment" state={card3}>
              {card3 === "active" && (
                <p className="text-zinc-300">
                  Deploying to Vercel... This usually takes 30-90 seconds.
                </p>
              )}
              {card3 === "complete" && (
                <p className="text-zinc-500 mb-2">
                  Deployment complete.</p>
              )}
              {card3 === "error" && (
                <p className="text-red-400">Deployment failed. Check Vercel for details.</p>
              )}
              {card3 === "waiting" && (
                <p className="text-zinc-400">Wait for integration to complete.</p>
              )}
            </StepCard>
          </div>
        )}

        {tab === "incidents" && (
          <div className="flex flex-col gap-3">
            {!incidentsLoaded ? (
              <div className="flex justify-center py-12">
                <Spinner className="h-5 w-5 text-zinc-400" />
              </div>
            ) : sortedIncidents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-zinc-400">No incidents detected.</p>
              </div>
            ) : (
              sortedIncidents.map((inc) => (
                <IncidentRow
                  key={inc.id}
                  incident={inc}
                  appId={appId}
                  token={token!}
                  onDelete={handleDeleteIncident}
                  onResolve={handleResolveIncident}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(BuildPage), { ssr: false });