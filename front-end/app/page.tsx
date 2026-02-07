"use client";

import { useEffect, useState } from "react";
import FaultyTerminal from "@/components/FaultyTerminal";

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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [installData, setInstallData] = useState<InstallationData | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get("session");
    if (sessionFromUrl) {
      localStorage.setItem("session", sessionFromUrl);
      window.history.replaceState({}, "", "/");
    }

    const token = localStorage.getItem("session");
    if (!token) {
      setLoading(false);
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
        fetch(`${API_BASE}/me/permissions`, { headers })
          .then((res) => res.ok ? res.json() : null)
          .then((data) => { if (data) setInstallData(data); });
      })
      .catch(() => {
        localStorage.removeItem("session");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  const handleLogout = () => {
    localStorage.removeItem("session");
    setUser(null);
    setInstallData(null);
    setExpandedRepo(null);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-zinc-500 font-medium">Loading...</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center font-sans overflow-hidden bg-black px-6">
      {/* SVG Filter for Liquid Glass - Must be present in the DOM */}
      <svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" className="absolute invisible">
        <defs>
          <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="92" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
            <feDisplacementMap in="SourceGraphic" in2="blurred" scale="77" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      
      <main className="relative z-10 w-full">
        {user ? (
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

            {installData && installData.repositories.length > 0 ? (
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
        ) : (
          /* Centered Hero Card with FaultyTerminal Inside */
          <div className="relative w-[calc(100vw-100px)] h-[calc(100vh-100px)] mx-auto rounded-[32px] border border-white/10 overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* FaultyTerminal as the background of the card */}
            <div className="absolute inset-0 z-0">
              <FaultyTerminal
                scale={1.5}
                digitSize={1.2}
                scanlineIntensity={0}
                glitchAmount={1}
                flickerAmount={1}
                noiseAmp={1}
                chromaticAberration={0}
                dither={0}
                curvature={0.05}
                tint="#311c02"
                mouseReact={false}
                mouseStrength={0.5}
                brightness={1.0}
              />
            </div>

            {/* Content Layer */}
            <div className="relative z-10 flex flex-col items-start justify-center h-full px-16 md:px-28 text-left">
              <h1 className="text-[32px] md:text-[64px] font-semibold leading-tight tracking-[-0.02em] text-white whitespace-nowrap mb-7">
                The Autonomous DevOps
              </h1>
              <p className="max-w-2xl text-[16px] md:text-[18px] leading-relaxed text-zinc-300 font-medium">
                From build failures to runtime crashes, Sanos detects every error across your stack, diagnoses the root cause, and ships the fix as a pull request.
              </p>

              <button
                onClick={handleLogin}
                className="flex h-12 items-center gap-3 rounded-full px-6 text-white font-semibold text-base bg-white/25 hover:bg-white/35 backdrop-blur-[2.5px] transition-colors mt-10"
              >
                <div className="flex items-center gap-3">
                  <svg
                    viewBox="0 0 16 16"
                    width="20"
                    height="20"
                    fill="currentColor"
                  >
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  <span>Sign in with GitHub</span>
                </div>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
