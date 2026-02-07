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
type TabMode = "setup" | "incidents" | "fixes";

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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 6L9 17l-5-5" stroke="#6ee7b7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="#fca5a5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
    waiting: "border-white/5",
    active: "border-yellow-500/40",
    complete: "border-emerald-500/30",
    error: "border-red-500/30",
  }[state];

  const bgColor = {
    waiting: "bg-white/[0.02]",
    active: "bg-yellow-950/20",
    complete: "bg-emerald-950/20",
    error: "bg-red-950/20",
  }[state];

  const textColor = state === "waiting" ? "text-zinc-600" : "text-white";

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} px-6 py-5 transition-all duration-300`}>
      <div className="flex items-center gap-5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-zinc-400">
          {state === "complete" ? (
            <Checkmark />
          ) : state === "error" ? (
            <ErrorIcon />
          ) : state === "active" ? (
            <Spinner className="h-4 w-4 text-yellow-400" />
          ) : (
            step
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className={`text-sm font-semibold ${textColor}`}>{title}</h3>
          {children}
        </div>
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
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
  const seconds = Math.floor((end - start) / 1000);
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
  isFix,
}: {
  incident: IncidentData;
  appId: string;
  token: string;
  onDelete: (id: number) => void;
  onResolve: (id: number) => void;
  isFix: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [resolving, setResolving] = useState(false);
  const isResolved = incident.status === "resolved";
  const latestAnalysis = incident.analyses?.[0] ?? null;

  const statusLabel: Record<string, { text: string; color: string }> = {
    open: { text: "Open", color: "text-red-400" },
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
    <div className="rounded-xl border border-white/5 bg-white/[0.02] transition-all duration-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 text-left"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-2 w-2 shrink-0 rounded-full ${isResolved ? "bg-emerald-500" : incident.status === "analyzing" ? "bg-yellow-500 animate-pulse" : incident.status === "pr_created" ? "bg-blue-500" : "bg-red-500"}`} />
            <p className="text-sm text-white truncate">{incident.error_message}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${st.color}`}>{st.text}</span>
            <span className="text-xs text-zinc-500">{formatLabel(incident.source)}</span>
            {incident.created_at && !isFix && (
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                <LiveDuration startStr={incident.created_at} />
              </span>
            )}
            {isFix && incident.created_at && incident.resolved_at && (
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {formatDuration(incident.created_at, incident.resolved_at)}
              </span>
            )}
            {incident.created_at && (
              <span className="text-xs text-zinc-600">{timeAgo(incident.created_at)}</span>
            )}
            <svg
              width="14"
              height="14"
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
        <div className="border-t border-white/5 px-5 py-4 space-y-4">
          {/* Incident meta */}
          <div className="flex gap-4 text-xs text-zinc-500">
            <span>Type: {formatLabel(incident.type)}</span>
            <span>Status: {formatLabel(incident.status)}</span>
            {incident.resolved_at && <span>Resolved: {timeAgo(incident.resolved_at)}</span>}
          </div>

          {/* Logs section */}
          {incident.logs && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Logs</h4>
              <pre className="text-xs text-zinc-400 bg-white/[0.03] rounded-lg p-3 overflow-x-auto max-h-40 whitespace-pre-wrap">
                {JSON.stringify(incident.logs, null, 2)}
              </pre>
            </div>
          )}

          {/* Stack trace */}
          {incident.stack_trace && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Stack Trace</h4>
              <pre className="text-xs text-zinc-400 bg-white/[0.03] rounded-lg p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                {incident.stack_trace}
              </pre>
            </div>
          )}

          {/* Analysis section */}
          {latestAnalysis && (
            <div className="space-y-3">
              {latestAnalysis.root_cause && (
                <div className="bg-white/[0.03] rounded-lg p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Root Cause</p>
                  <p className="text-xs text-zinc-300">{latestAnalysis.root_cause}</p>
                </div>
              )}

              {/* PR link + confirm button */}
              {latestAnalysis.pr_url && incident.status === "pr_created" && (
                <div className="flex items-center gap-3 pt-1">
                  <a
                    href={latestAnalysis.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 underline hover:text-blue-300 transition-colors"
                  >
                    View PR #{latestAnalysis.pr_number}
                  </a>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleResolve(); }}
                    disabled={resolving}
                    className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                  >
                    {resolving ? "Merging..." : "Accept PR & Resolve"}
                  </button>
                </div>
              )}

              {latestAnalysis.pr_url && incident.status === "resolved" && (
                <div className="flex items-center gap-3 pt-1">
                  <a
                    href={latestAnalysis.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-400 underline hover:text-emerald-300 transition-colors"
                  >
                    View Merged PR #{latestAnalysis.pr_number}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Analyzing spinner */}
          {incident.status === "analyzing" && !latestAnalysis && (
            <div className="flex items-center gap-3 py-2">
              <Spinner className="h-4 w-4 text-yellow-400" />
              <span className="text-xs text-yellow-400">Analyzing incident and preparing fix...</span>
            </div>
          )}

          {/* Delete button */}
          <div className="flex justify-end pt-2 border-t border-white/5">
            {!confirmingDelete ? (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
                className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500">Are you sure?</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                  className="text-[10px] font-bold uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
                >
                  Yes, delete
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false); }}
                  className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
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

  // Fetch incidents when switching to incidents/fixes tab, then poll every 5s
  useEffect(() => {
    if (!token) return;
    if (tab !== "incidents" && tab !== "fixes") return;

    const fetchIncidents = () => {
      fetch(`${API_BASE}/apps/${appId}/incidents`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data: IncidentData[]) => {
          setIncidents(data);
          setIncidentsLoaded(true);
        })
        .catch(() => {});
    };

    fetchIncidents();
    const pollId = setInterval(fetchIncidents, 5000);
    return () => clearInterval(pollId);
  }, [tab, token, appId]);

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
        <p className="text-sm font-bold uppercase tracking-wider text-red-500">{error}</p>
        <button onClick={() => router.push("/dashboard")} className="text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors underline">
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
        <Spinner className="h-5 w-5 text-zinc-500" />
      </div>
    );
  }

  const [card1, card2, card3] = getCardStates(app.pipeline_step);

  const activeIncidents = incidents.filter((i) => i.status !== "resolved");
  const resolvedIncidents = incidents.filter((i) => i.status === "resolved");

  const tabs: { key: TabMode; label: string; count?: number }[] = [
    { key: "setup", label: "Set Up" },
    { key: "incidents", label: "Incidents", count: activeIncidents.length },
    { key: "fixes", label: "Fixes", count: resolvedIncidents.length },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] font-sans animate-in fade-in duration-500">
      <div className="mx-auto w-full max-w-[1100px] px-8 py-12 sm:px-12 lg:px-16">
        {/* Back link */}
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 hover:text-white transition-colors mb-12"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>

        {/* App name */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold text-white tracking-tight">{app.full_name}</h1>
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest bg-white/[0.03] text-zinc-500 border border-white/5">
              App ID: {app.id}
            </span>
          </div>
        </div>
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-12">
          Project Deployment & Monitoring
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-10 border-b border-white/5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative flex items-center gap-2 ${
                tab === t.key
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`text-[10px] font-bold ${
                  t.key === "incidents" ? "text-red-400" : "text-emerald-400"
                }`}>
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
                <p className="text-xs text-zinc-400">
                  Creating instrumentation files and opening a PR on your repository...
                </p>
              )}
              {card1 === "complete" && (
                <p className="text-xs text-emerald-400">Instrumentation PR created.</p>
              )}
              {card1 === "error" && (
                <p className="text-xs text-red-400">
                  Failed to create instrumentation PR. You can retry by refreshing the page.
                </p>
              )}
            </StepCard>

            <StepCard step={2} title="Accept Integration PR" state={card2}>
              {card2 === "active" && (
                app.pr_url ? (
                  <a
                    href={app.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 underline hover:text-white transition-colors"
                  >
                    Review and merge the PR to continue.
                  </a>
                ) : (
                  <p className="text-xs text-zinc-400">Review and merge the PR to continue.</p>
                )
              )}
              {card2 === "complete" && (
                <p className="text-xs text-emerald-400">PR merged successfully.</p>
              )}
            </StepCard>

            <StepCard step={3} title="Vercel Deployment" state={card3}>
              {card3 === "active" && (
                <p className="text-xs text-zinc-400">
                  Deploying to Vercel... This usually takes 30-90 seconds.
                </p>
              )}
              {card3 === "complete" && (
                <p className="text-xs text-emerald-400 mb-2">
                  Deployment complete.</p>
              )}
              {card3 === "error" && (
                <p className="text-xs text-red-400">Deployment failed. Check Vercel for details.</p>
              )}
            </StepCard>
          </div>
        )}

        {tab === "incidents" && (
          <div className="flex flex-col gap-3">
            {!incidentsLoaded ? (
              <div className="flex justify-center py-12">
                <Spinner className="h-5 w-5 text-zinc-500" />
              </div>
            ) : activeIncidents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-zinc-500">No active incidents.</p>
              </div>
            ) : (
              activeIncidents.map((inc) => (
                <IncidentRow
                  key={inc.id}
                  incident={inc}
                  appId={appId}
                  token={token!}
                  onDelete={handleDeleteIncident}
                  onResolve={handleResolveIncident}
                  isFix={false}
                />
              ))
            )}
          </div>
        )}

        {tab === "fixes" && (
          <div className="flex flex-col gap-3">
            {!incidentsLoaded ? (
              <div className="flex justify-center py-12">
                <Spinner className="h-5 w-5 text-zinc-500" />
              </div>
            ) : resolvedIncidents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-zinc-500">No resolved incidents yet.</p>
              </div>
            ) : (
              resolvedIncidents.map((inc) => (
                <IncidentRow
                  key={inc.id}
                  incident={inc}
                  appId={appId}
                  token={token!}
                  onDelete={handleDeleteIncident}
                  onResolve={handleResolveIncident}
                  isFix={true}
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
