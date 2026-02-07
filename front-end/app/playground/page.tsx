"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export default function PlaygroundPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentOutput, setAgentOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("session");
    if (!token) {
      router.replace("/");
      return;
    }
    setAuthenticated(true);
  }, [router]);

  const handleRun = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setAgentOutput(null);
    setError(null);

    const token = localStorage.getItem("session");
    if (!token) {
      router.replace("/");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/playground`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail ?? "An unknown error occurred");
        return;
      }

      if (data.agent_output) setAgentOutput(data.agent_output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted || !authenticated) {
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
    <div className="relative flex min-h-screen items-center justify-center font-sans overflow-hidden bg-black px-6 py-8">
      <main className="relative z-10 w-full">
        <div className="flex flex-col items-center gap-8 py-20 px-10 bg-black/40 backdrop-blur-md rounded-[32px] border border-white/10 shadow-xl w-full max-w-2xl mx-auto">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Playground
            </h1>
            <p className="text-zinc-400 font-medium max-w-md">
              Tell the Dedalus agent what to do with your GitHub repositories.
            </p>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Create a branch on micahtid/bananahacks, read package.json, and bump the version..."
            rows={4}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/20 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleRun();
              }
            }}
          />

          {agentOutput && (
            <div className="w-full rounded-xl border border-white/10 bg-white/5 px-5 py-4">
              <p className="text-xs font-medium text-zinc-500 mb-2">Agent Output</p>
              <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{agentOutput}</pre>
            </div>
          )}

          {error && (
            <div className="w-full rounded-xl border border-red-500/20 bg-red-900/20 px-5 py-4">
              <p className="text-sm font-medium text-red-400">{error}</p>
            </div>
          )}

          <div className="flex flex-col items-center gap-3 mt-2">
            <button
              onClick={handleRun}
              disabled={loading || !prompt.trim()}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-semibold text-black transition-all hover:opacity-80 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-black"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running...
                </>
              ) : (
                "Run Agent"
              )}
            </button>

            <button
              onClick={() => router.push("/dashboard")}
              className="flex h-12 items-center justify-center rounded-full border border-white/10 px-8 text-sm font-medium text-zinc-400 transition-all hover:bg-white/5 hover:text-white"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
