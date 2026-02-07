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
}

interface Repository {
  name: string;
  private: boolean;
  url: string;
  permissions: Record<string, string>;
  events: string[];
}

interface InstallationData {
  repositories: Repository[];
  repository_selection: string;
  installation_url: string | null;
}

function Dashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [installData, setInstallData] = useState<InstallationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [deletingRepo, setDeletingRepo] = useState<string | null>(null);

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
        setPermissionsLoading(true);
        fetch(`${API_BASE}/me/permissions`, { headers })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) setInstallData(data);
          })
          .finally(() => setPermissionsLoading(false));
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

  const handleDeleteRepo = (repoName: string) => {
    if (!installData) return;
    setDeletingRepo(repoName);
    // Remove locally for now — backend endpoint can be added later
    setInstallData({
      ...installData,
      repositories: installData.repositories.filter((r) => r.name !== repoName),
    });
    setDeletingRepo(null);
  };

  const handleAddProject = () => {
    window.open(
      "https://github.com/apps/tartan-hacks/installations/new",
      "_blank",
      "noopener,noreferrer"
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

  const repos = installData?.repositories ?? [];

  return (
    <div className="min-h-screen bg-black font-sans">
      <div className="mx-auto w-full max-w-[1200px] px-8 py-10 sm:px-12 lg:px-16">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt={user.username}
                width={48}
                height={48}
                className="rounded-full ring-2 ring-white/20 shadow-xl"
              />
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {user.username}
              </h1>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Sanos Dashboard</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-lg border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            Sign Out
          </button>
        </div>

        {/* Divider */}
        <div className="mt-10 border-t border-white/10" />

        {/* Projects section */}
        <div className="mt-10">
          <div className="flex items-center mb-8">
            <h2 className="text-xl font-bold text-white tracking-tight">Projects</h2>
          </div>

          {permissionsLoading ? (
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
          ) : repos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-white/5 p-4 mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="#52525b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-zinc-500">No projects linked yet</p>
              <p className="text-xs text-zinc-600 mt-1">
                Add a repository to get started
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
                {repos.map((repo) => (
                  <div
                    key={repo.name}
                    className="group grid grid-cols-[1.5fr_2fr_100px_40px] items-center rounded-lg px-6 py-4 transition-all hover:bg-white/[0.04] border-b border-white/[0.03] last:border-0"
                  >
                    {/* Name + visibility */}
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-semibold text-white truncate">
                        {repo.name}
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

                    {/* URL with ellipsis */}
                    <div className="min-w-0 pr-8">
                      {repo.url ? (
                        <a
                          href={repo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-zinc-400 hover:text-white transition-colors truncate block"
                        >
                          {repo.url.replace("https://", "")}
                        </a>
                      ) : (
                        <span className="text-sm text-zinc-600">—</span>
                      )}
                    </div>

                    {/* Status badge */}
                    <div>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-900/40 text-emerald-300">
                        Healthy
                      </span>
                    </div>

                    {/* Delete button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDeleteRepo(repo.name)}
                        disabled={deletingRepo === repo.name}
                        className="text-zinc-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 p-1"
                        title="Remove project"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Project — bottom */}
          <button
            onClick={handleAddProject}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] py-4 text-sm font-bold text-zinc-400 transition-all hover:bg-white/[0.05] hover:text-white hover:border-white/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Add New Project
          </button>
        </div>
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(Dashboard), { ssr: false });
