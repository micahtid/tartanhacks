"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    setMounted(true);
  }, []);

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
      // 1. Connect the repo (creates App in DB)
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

      // 2. Auto-deploy to Vercel
      const deployRes = await fetch(`${API_BASE}/deploy/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo_name: fullName }),
      });

      const appId = connectData.id;
      if (deployRes.ok) {
        const deployData = await deployRes.json();
        if (deployData.app_id) {
          router.push(`/dashboard/${deployData.app_id}`);
          return;
        }
      }
      // Fallback: redirect using connect response id
      router.push(`/dashboard/${appId}`);
    } finally {
      setConnectingRepo(null);
    }
  };

  const statusBadge = (status: string) => {
    const s = status?.toLowerCase() ?? "pending";
    const styles: Record<string, string> = {
      ready: "bg-emerald-900/40 text-emerald-300",
      active: "bg-emerald-900/40 text-emerald-300",
      deploying: "bg-yellow-900/40 text-yellow-300",
      building: "bg-yellow-900/40 text-yellow-300",
      error: "bg-red-900/40 text-red-300",
      pending: "bg-zinc-800 text-zinc-400",
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
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[s] ?? styles.pending}`}
      >
        {label[s] ?? s}
      </span>
    );
  };

  if (!mounted || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
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
    <div className="min-h-screen bg-black font-sans">
      <div className="mx-auto w-full max-w-[1200px] px-8 py-10 sm:px-12 lg:px-16">
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
                  className="rounded-full ring-2 ring-white/20 shadow-xl"
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
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Sanos Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/apps/tartan-hacks/installations/new"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-black transition-all hover:opacity-80 active:scale-95"
            >
              Connect Apps
            </a>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="mt-10 border-t border-white/10" />

        {/* Projects section */}
        <div className="mt-10">
          <div className="flex items-center mb-8">
            <h2 className="text-xl font-bold text-white tracking-tight">Projects</h2>
          </div>

          {appsLoading ? (
            <div className="flex items-center gap-3 py-12 justify-center">
              <svg
                className="animate-spin h-4 w-4 text-zinc-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-zinc-500">Loading projects...</span>
            </div>
          ) : apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-white/5 p-4 mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="#52525b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-500">No active projects</p>
              <p className="text-xs text-zinc-600 mt-1 max-w-sm">
                Click &ldquo;Add New Project&rdquo; below to connect a GitHub repository and deploy it.
              </p>
            </div>
          ) : (
            <div>
              {/* Column headers */}
              <div className="grid grid-cols-[1.5fr_2fr_100px_40px] items-center pb-3 px-6 border-b border-white/10 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">Repository</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">Source URL</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">Status</span>
                <span className="w-4" />
              </div>

              {/* Table Rows */}
              <div className="flex flex-col">
                {apps.map((app) => (
                  <div key={app.id}>
                    <div
                      onClick={() => router.push(`/dashboard/${app.id}`)}
                      className="group grid grid-cols-[1.5fr_2fr_100px_40px] items-center rounded-lg px-6 py-4 transition-all hover:bg-white/[0.04] border-b border-white/[0.03] last:border-0 cursor-pointer"
                    >
                      {/* Name + visibility */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-semibold text-white truncate">
                          {app.repo_name}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            app.private
                              ? "bg-zinc-800 text-zinc-300"
                              : "bg-blue-900/40 text-blue-300"
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
                            className="text-[13px] text-zinc-400 hover:text-white transition-colors truncate block"
                          >
                            {app.live_url.replace("https://", "")}
                          </a>
                        ) : (
                          <span className="text-sm text-zinc-600">&mdash;</span>
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
                          className="text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 p-1"
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
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] py-4 text-sm font-bold text-zinc-400 transition-all hover:bg-white/[0.05] hover:text-white hover:border-white/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Add New Project
          </button>
        </div>
      </div>

      {/* Settings modal */}
      {showSettingsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="text-base font-bold text-white">Settings</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-500 hover:text-white transition-colors p-1"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  Vercel Auth Token
                </label>
                <p className="text-xs text-zinc-500 mb-3">
                  Provide your own Vercel token to deploy under your account.
                  {user.has_vercel_token && (
                    <span className="ml-1 text-emerald-400">A token is currently saved.</span>
                  )}
                </p>
                <input
                  type="password"
                  placeholder="Enter Vercel token..."
                  value={vercelTokenInput}
                  onChange={(e) => setVercelTokenInput(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/20"
                />
              </div>

              {settingsMsg && (
                <p className={`text-xs font-medium ${settingsMsg.type === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                  {settingsMsg.text}
                </p>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => saveVercelToken(vercelTokenInput)}
                  disabled={savingSettings || !vercelTokenInput.trim()}
                  className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-black transition-all hover:opacity-80 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingSettings ? "Saving..." : "Save"}
                </button>
                {user.has_vercel_token && (
                  <button
                    onClick={() => saveVercelToken("")}
                    disabled={savingSettings}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-400 transition-all hover:border-white/20 hover:text-white disabled:opacity-40"
                  >
                    Remove Token
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowRepoDialog(false)}
        >
          <div
            className="w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="text-base font-bold text-white">Select a Repository</h3>
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
            <div className="px-6 py-3 border-b border-white/5">
              <input
                type="text"
                placeholder="Search repositories..."
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/20"
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
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            repo.private
                              ? "bg-zinc-800 text-zinc-300"
                              : "bg-blue-900/40 text-blue-300"
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
