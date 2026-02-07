"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useRef } from "react";
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
  created_at: string | null;
}

function BuildPage() {
  const router = useRouter();
  const params = useParams();
  const appId = params.id as string;

  const [app, setApp] = useState<AppDetail | null>(null);
  const [status, setStatus] = useState<string>("loading");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch app details on mount
  useEffect(() => {
    const token = localStorage.getItem("session");
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
      .then((data: AppDetail) => {
        setApp(data);
        setStatus(data.status);
        setLiveUrl(data.live_url);
      })
      .catch(() => setError("Failed to load app details"));
  }, [appId, router]);

  // Poll status every 3s while deploying
  useEffect(() => {
    const token = localStorage.getItem("session");
    if (!token) return;

    const isTerminal = status === "ready" || status === "error";
    if (isTerminal || status === "loading") return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/apps/${appId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setStatus(data.status);
          if (data.live_url) setLiveUrl(data.live_url);
          if (data.status === "ready" || data.status === "error") {
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
  }, [appId, status]);

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    deploying: { label: "Building", color: "text-yellow-300", bg: "bg-yellow-900/40" },
    building: { label: "Building", color: "text-yellow-300", bg: "bg-yellow-900/40" },
    pending: { label: "Pending", color: "text-zinc-400", bg: "bg-zinc-800" },
    ready: { label: "Ready", color: "text-emerald-300", bg: "bg-emerald-900/40" },
    active: { label: "Active", color: "text-emerald-300", bg: "bg-emerald-900/40" },
    error: { label: "Error", color: "text-red-300", bg: "bg-red-900/40" },
  };

  const cfg = statusConfig[status] ?? statusConfig.pending;
  const isBuilding = status === "deploying" || status === "building" || status === "pending" || status === "active";

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black gap-4">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-zinc-400 hover:text-white transition-colors underline"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!app) {
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
      <div className="mx-auto w-full max-w-[700px] px-8 py-16 sm:px-12">
        {/* Back link */}
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors mb-10"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>

        {/* App name + status */}
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {app.full_name}
          </h1>
          <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
        </div>

        <p className="text-xs text-zinc-500 mb-10">
          App ID: {app.id} {app.vercel_project_id && <>| Vercel Project: {app.vercel_project_id}</>}
        </p>

        <div className="border-t border-white/10 pt-10">
          {/* Building animation */}
          {isBuilding && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="relative">
                <svg
                  className="animate-spin h-10 w-10 text-yellow-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Deploying to Vercel...</p>
                <p className="text-xs text-zinc-500 mt-1">This usually takes 30-90 seconds. Polling every 3s.</p>
              </div>
            </div>
          )}

          {/* Ready state */}
          {status === "ready" && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="rounded-full bg-emerald-900/30 p-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6L9 17l-5-5" stroke="#6ee7b7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Deployment Complete</p>
                {liveUrl && (
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300 underline transition-colors"
                  >
                    {liveUrl.replace("https://", "")}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="rounded-full bg-red-900/30 p-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="#fca5a5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Deployment Failed</p>
                <p className="text-xs text-zinc-500 mt-1">Check the Vercel dashboard for more details.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default dynamic(() => Promise.resolve(BuildPage), { ssr: false });
