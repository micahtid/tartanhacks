"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

interface User {
  id: number;
  github_id: number;
  username: string;
  avatar_url: string | null;
  has_vercel_token?: boolean;
}

interface AppEntry {
  id: number;
  repo_owner: string;
  repo_name: string;
  full_name: string;
  status: string;
  private: boolean;
  live_url: string | null;
  instrumented: boolean;
  created_at: string | null;
}

interface GitHubRepo {
  full_name: string;
  name: string;
  private: boolean;
  url: string;
}

function Dashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [appsLoading, setAppsLoading] = useState(false);
  const [deletingApp, setDeletingApp] = useState<number | null>(null);
  const [showRepoDialog, setShowRepoDialog] = useState(false);
  const [availableRepos, setAvailableRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [connectingRepo, setConnectingRepo] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [vercelTokenInput, setVercelTokenInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const connectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!showConnectMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (connectMenuRef.current && !connectMenuRef.current.contains(e.target as Node)) {
        setShowConnectMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showConnectMenu]);

  useEffect(() => {
    if (!mounted) return;
    const token = localStorage.getItem("session");
    if (!token) {
      router.replace("/");
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };

    fetch(`${API_BASE}/me`, { headers })
      .then((res) => {
        if (!res.ok) throw new Error("Invalid session");
        return res.json();
      })
      .then((data) => {
        setUser(data);
        setAppsLoading(true);
        fetch(`${API_BASE}/apps`, { headers })
          .then((res) => (res.ok ? res.json() : []))
          .then((data) => setApps(data))
          .finally(() => setAppsLoading(false));
      })
      .catch(() => {
        localStorage.removeItem("session");
        router.replace("/");
      })
      .finally(() => setLoading(false));
  }, [router, mounted]);

  const handleLogout = () => {
    localStorage.removeItem("session");
    router.replace("/");
  };

  const handleDeleteApp = async (appId: number) => {
    const token = localStorage.getItem("session");
    if (!token) return;
    setDeletingApp(appId);
    try {
      const res = await fetch(`${API_BASE}/apps/${appId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setApps((prev) => prev.filter((a) => a.id !== appId));
      }
    } finally {
      setDeletingApp(null);
    }
  };

  const openRepoDialog = async () => {
    const token = localStorage.getItem("session");
    if (!token) return;
    setShowRepoDialog(true);
    setReposLoading(true);
    setRepoSearch("");
    try {
      const res = await fetch(`${API_BASE}/me/repos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableRepos(data);
      }
    } finally {
      setReposLoading(false);
    }
  };

  const saveVercelToken = async (tokenValue: string) => {
    const session = localStorage.getItem("session");
    if (!session) return;
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const res = await fetch(`${API_BASE}/me/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vercel_token: tokenValue }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser((prev) => prev ? { ...prev, has_vercel_token: data.has_vercel_token } : prev);
        setSettingsMsg({ type: "ok", text: tokenValue ? "Saved successfully" : "Token removed" });
        setVercelTokenInput("");
      } else {
        setSettingsMsg({ type: "err", text: "Failed to save" });
      }
    } catch {
      setSettingsMsg({ type: "err", text: "Network error" });
    } finally {
      setSavingSettings(false);
    }
  };

  const connectRepo = async (fullName: string) => {
    const token = localStorage.getItem("session");
    if (!token) return;
    setConnectingRepo(fullName);
    try {
      const connectRes = await fetch(`${API_BASE}/apps/connect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ full_name: fullName }),
      });
      if (!connectRes.ok) return;
      const connectData = await connectRes.json();
      router.push(`/dashboard/${connectData.id}`);
    } finally {
      setConnectingRepo(null);
    }
  };

  const statusBadge = (status: string) => {
    const s = status?.toLowerCase() ?? "pending";
    const styles: Record<string, string> = {
      ready: "bg-emerald-950/40 text-emerald-400 border-emerald-500/10",
      active: "bg-emerald-950/40 text-emerald-400 border-emerald-500/10",
      deploying: "bg-yellow-950/40 text-yellow-400 border-yellow-500/10",
      building: "bg-yellow-950/40 text-yellow-400 border-yellow-500/10",
      error: "bg-red-950/40 text-red-400 border-red-500/10",
      pending: "bg-zinc-800 text-zinc-400 border-zinc-700/50",
    };
    const label: Record<string, string> = {
      ready: "Ready",
      active: "Active",
      deploying: "Building",
      building: "Building",
      error: "Error",
      pending: "Pending",
    };
    return (
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border ${styles[s] ?? styles.pending}`}
      >
        {label[s] ?? s}
      </span>
    );
  };

  if (!mounted || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] animate-in fade-in duration-700">
        <svg
          className="animate-spin h-5 w-5 text-zinc-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] font-sans animate-in fade-in duration-500">
      <div className="mx-auto w-full max-w-[1100px] px-8 py-12 sm:px-12 lg:px-16">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {user.avatar_url && (
              <div
                className="relative group/pfp cursor-pointer"
                onClick={() => { setShowSettingsModal(true); setSettingsMsg(null); }}
              >
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  width={48}
                  height={48}
                  className="rounded-full ring-2 ring-white/10 shadow-2xl"
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover/pfp:opacity-100 transition-opacity">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {user.username}
              </h1>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Sanos Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative" ref={connectMenuRef}>
              <button
                onClick={() => setShowConnectMenu((v) => !v)}
                className="flex items-center gap-2 rounded-lg bg-white px-5 py-2 text-xs font-bold uppercase tracking-wider text-black transition-all hover:opacity-80 active:scale-95"
              >
                Connect Apps
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={`transition-transform ${showConnectMenu ? "rotate-180" : ""}`}
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showConnectMenu && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-[#0c0c0e] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-50">
                  <a
                    href="https://github.com/apps/tartan-hacks/installations/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowConnectMenu(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                    GitHub
                  </a>
                  <div className="border-t border-white/5" />
                  <a
                    href="https://github.com/marketplace/coderabbitai"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowConnectMenu(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9.5 2a6.5 6.5 0 00-5.28 10.28L3 21l4.5-2.5L12 21l4.5-2.5L21 21l-1.22-8.72A6.5 6.5 0 0014.5 2h-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="9.5" cy="8.5" r="1" fill="currentColor" />
                      <circle cx="14.5" cy="8.5" r="1" fill="currentColor" />
                    </svg>
                    CodeRabbit
                  </a>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-white/5 bg-white/[0.03] px-5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-400 transition-all hover:bg-white/[0.08] hover:text-white hover:border-white/10"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="mt-10 border-t border-white/5" />

        {/* Projects section */}
        <div className="mt-10">
          <div className="flex items-center mb-8">
            <h2 className="text-xl font-bold text-white tracking-tight">Projects</h2>
          </div>

          {appsLoading ? (
            <div className="flex items-center gap-3 py-20 justify-center animate-in fade-in duration-500">
              <svg
                className="animate-spin h-4 w-4 text-zinc-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-medium text-zinc-500">Syncing with GitHub...</span>
            </div>
          ) : apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-white/5 bg-white/[0.01] mb-6 animate-in fade-in duration-500">
              <p className="text-sm font-bold text-zinc-400 uppercase tracking-wider">No active projects</p>
              <p className="text-xs text-zinc-500 mt-2 max-w-[280px] leading-relaxed">
                Click &ldquo;Add New Project&rdquo; below to connect a GitHub repository and deploy it.
              </p>
            </div>
          ) : (
            <div>
              {/* Column headers */}
              <div className="grid grid-cols-[1.5fr_2fr_100px_40px] items-center pb-3 px-6 border-b border-white/5 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Repository</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Source URL</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">Status</span>
                <span className="w-4" />
              </div>

              {/* Table Rows */}
              <div className="flex flex-col">
                {apps.map((app) => (
                  <div key={app.id}>
                    <div
                      onClick={() => router.push(`/dashboard/${app.id}`)}
                      className="group grid grid-cols-[1.5fr_2fr_100px_40px] items-center rounded-lg px-6 py-4 transition-all hover:bg-white/[0.03] border-b border-white/[0.02] last:border-0 cursor-pointer"
                    >
                      {/* Name + visibility */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-semibold text-white truncate">
                          {app.repo_name}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                            app.private
                              ? "bg-zinc-800 text-zinc-400"
                              : "bg-blue-900/30 text-blue-400"
                          }`}
                        >
                          {app.private ? "Private" : "Public"}
                        </span>
                      </div>

                      {/* Live URL */}
                      <div className="min-w-0 pr-8">
                        {app.live_url ? (
                          <a
                            href={app.live_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors truncate block"
                          >
                            {app.live_url.replace("https://", "")}
                          </a>
                        ) : (
                          <span className="text-xs text-zinc-600">&mdash;</span>
                        )}
                      </div>

                      {/* Status badge */}
                      <div>{statusBadge(app.status)}</div>

                      {/* Delete button */}
                      <div className="flex justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteApp(app.id);
                          }}
                          disabled={deletingApp === app.id}
                          className="text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 p-1"
                          title="Remove project"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Project — bottom */}
          <button
            onClick={openRepoDialog}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] py-4 text-xs font-bold uppercase tracking-widest text-zinc-500 transition-all hover:bg-white/[0.05] hover:text-white hover:border-white/10"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Add New Project
          </button>
        </div>
      </div>

      {/* Settings modal */}
      {showSettingsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-[#0c0c0e] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">Settings</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-500 hover:text-white transition-colors p-1"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">
                  Vercel Auth Token
                </label>
                <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
                  Provide your own Vercel token to deploy under your account.
                  {user.has_vercel_token && (
                    <span className="block mt-1 font-bold text-emerald-500 uppercase tracking-tight text-[10px]">Active token detected</span>
                  )}
                </p>
                <input
                  type="password"
                  placeholder="Enter Vercel token..."
                  value={vercelTokenInput}
                  onChange={(e) => setVercelTokenInput(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/10 transition-colors"
                />
              </div>

              {settingsMsg && (
                <p className={`text-[10px] font-bold uppercase tracking-wider ${settingsMsg.type === "ok" ? "text-emerald-500" : "text-red-500"}`}>
                  {settingsMsg.text}
                </p>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => saveVercelToken(vercelTokenInput)}
                  disabled={savingSettings || !vercelTokenInput.trim()}
                  className="rounded-lg bg-white px-6 py-2 text-xs font-bold uppercase tracking-widest text-black transition-all hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {savingSettings ? "Saving..." : "Save"}
                </button>
                {user.has_vercel_token && (
                  <button
                    onClick={() => saveVercelToken("")}
                    disabled={savingSettings}
                    className="rounded-lg border border-white/5 bg-white/[0.03] px-5 py-2 text-xs font-bold uppercase tracking-widest text-zinc-400 transition-all hover:bg-white/[0.08] hover:text-white"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Repo selection dialog */}
      {showRepoDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setShowRepoDialog(false)}
        >
          <div
            className="w-full max-w-2xl mx-4 rounded-2xl border border-white/10 bg-[#0c0c0e] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">Select a Repository</h3>
              <button
                onClick={() => setShowRepoDialog(false)}
                className="text-zinc-500 hover:text-white transition-colors p-1"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="px-6 py-4 border-b border-white/[0.02]">
              <input
                type="text"
                placeholder="Search repositories..."
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/10 transition-colors"
              />
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {reposLoading ? (
                <div className="flex items-center justify-center gap-3 py-12">
                  <svg
                    className="animate-spin h-4 w-4 text-zinc-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm text-zinc-500">Loading repositories...</span>
                </div>
              ) : availableRepos.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-zinc-500">No repositories found</p>
                </div>
              ) : (
                availableRepos
                  .filter((r) =>
                    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
                  )
                  .map((repo) => (
                    <button
                      key={repo.full_name}
                      onClick={() => connectRepo(repo.full_name)}
                      disabled={connectingRepo === repo.full_name}
                      className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-white/[0.04] border-b border-white/[0.03] last:border-0 disabled:opacity-50 gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-semibold text-white truncate">
                          {repo.full_name}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                            repo.private
                              ? "bg-zinc-800 text-zinc-400"
                              : "bg-blue-900/30 text-blue-400"
                          }`}
                        >
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </div>
                      {connectingRepo === repo.full_name ? (
                        <svg className="animate-spin h-4 w-4 text-zinc-400 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-zinc-500 shrink-0">
                          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default dynamic(() => Promise.resolve(Dashboard), { ssr: false });
