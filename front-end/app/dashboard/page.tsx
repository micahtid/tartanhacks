"use client";

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

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [installData, setInstallData] = useState<InstallationData | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [deployingRepos, setDeployingRepos] = useState<Set<string>>(new Set());
  const [deployErrors, setDeployErrors] = useState<Map<string, string>>(new Map());
  const [deployUrls, setDeployUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
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
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("session");
    router.replace("/");
  };

  const deployRepo = async (repoName: string) => {
    const token = localStorage.getItem("session");
    if (!token) return;

    setDeployErrors((prev) => {
      const next = new Map(prev);
      next.delete(repoName);
      return next;
    });

    setDeployingRepos((prev) => new Set(prev).add(repoName));

    try {
      const res = await fetch(`${API_BASE}/deploy/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo_name: repoName }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Deployment failed");
      }

      if (data.deployment_url) {
        setDeployUrls((prev) => new Map(prev).set(repoName, data.deployment_url));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setDeployErrors((prev) => new Map(prev).set(repoName, errorMessage));
    } finally {
      setDeployingRepos((prev) => {
        const next = new Set(prev);
        next.delete(repoName);
        return next;
      });
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <svg
          className="animate-spin h-6 w-6 text-zinc-500"
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
    <div className="relative flex min-h-screen items-center justify-center font-sans overflow-hidden bg-black px-6">
      <main className="relative z-10 w-full">
        <div className="flex flex-col items-center gap-10 py-20 px-10 bg-black/40 backdrop-blur-md rounded-[32px] border border-white/10 shadow-xl w-full max-w-3xl mx-auto">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex items-center gap-4">
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  width={56}
                  height={56}
                  className="rounded-full ring-2 ring-white/20"
                />
              )}
              <div className="text-left">
                <h1 className="text-3xl font-semibold tracking-tight text-white">
                  Welcome, {user.username}
                </h1>
                <p className="text-zinc-400 font-medium">
                  Signed in via GitHub
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex h-12 items-center justify-center rounded-full border border-white/10 px-6 text-base font-semibold text-white transition-all hover:bg-white/5 active:scale-95"
            >
              Sign out
            </button>
          </div>

          {permissionsLoading ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-8 w-full">
              <svg
                className="animate-spin h-6 w-6 text-zinc-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-zinc-400 font-medium">
                Checking installation status…
              </p>
            </div>
          ) : installData && installData.repositories.length > 0 ? (
            <div className="flex flex-col gap-6 w-full text-left">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">
                  Repositories
                </h2>
              </div>

              <div className="flex flex-col gap-3">
                {installData.repositories.map((repo) => {
                  const isExpanded = expandedRepo === repo.name;
                  return (
                    <div
                      key={repo.name}
                      className="rounded-xl border border-white/5 bg-white/5 overflow-hidden"
                    >
                      <button
                        onClick={() =>
                          setExpandedRepo(isExpanded ? null : repo.name)
                        }
                        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/10"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-zinc-100">
                            {repo.name}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              repo.private
                                ? "bg-zinc-800 text-zinc-300"
                                : "bg-emerald-900/30 text-emerald-400"
                            }`}
                          >
                            {repo.private ? "private" : "public"}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-white/5 px-5 py-4 bg-white/5">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {Object.entries(repo.permissions).map(
                              ([scope, level]) => (
                                <div
                                  key={scope}
                                  className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2"
                                >
                                  <span className="text-xs font-medium text-zinc-400">
                                    {scope.replace(/_/g, " ")}
                                  </span>
                                  <span className="text-xs font-bold text-white uppercase">
                                    {level}
                                  </span>
                                </div>
                              )
                            )}
                          </div>

                          {/* Vercel Deploy Section */}
                          <div className="mt-4 pt-3 border-t border-white/5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex-1">
                                {deployUrls.get(repo.name) && (
                                  <a
                                    href={deployUrls.get(repo.name)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 underline hover:text-blue-300 truncate block"
                                  >
                                    {deployUrls.get(repo.name)}
                                  </a>
                                )}
                                {deployErrors.get(repo.name) && (
                                  <p className="text-xs text-red-400 mt-1">
                                    {deployErrors.get(repo.name)}
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={() => deployRepo(repo.name)}
                                disabled={deployingRepos.has(repo.name)}
                                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-all hover:opacity-80 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {deployingRepos.has(repo.name) ? (
                                  <>
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Deploying…
                                  </>
                                ) : (
                                  <>
                                    <svg viewBox="0 0 76 76" width="12" height="12" fill="currentColor">
                                      <path d="M38 0l7.8 23.9h25.2l-20.4 14.8 7.8 24-20.4-14.9-20.4 14.9 7.8-24L5 23.9h25.2L38 0z" />
                                    </svg>
                                    Deploy to Vercel
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-8 w-full">
              <h2 className="text-xl font-semibold text-white">
                App Not Installed
              </h2>
              <p className="text-sm text-zinc-400 font-medium max-w-sm">
                Install the GitHub App on your account to grant repository
                permissions and start automating your workflow.
              </p>
              <a
                href="https://github.com/apps/tartan-hacks/installations/new"
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-black transition-all hover:opacity-80 active:scale-95"
              >
                Install App on GitHub
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
