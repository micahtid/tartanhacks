"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

const FaultyTerminal = dynamic(() => import("@/components/FaultyTerminal"), {
  ssr: false,
});

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Pick up session token returned from GitHub OAuth callback
    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get("session");
    if (sessionFromUrl) {
      localStorage.setItem("session", sessionFromUrl);
      router.replace("/dashboard");
      return;
    }

    // If already logged in, redirect to dashboard
    const token = localStorage.getItem("session");
    if (token) {
      router.replace("/dashboard");
      return;
    }

    setReady(true);
  }, [router]);

  const handleLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  if (!ready) {
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
        {/* Centered Hero Card with FaultyTerminal Inside */}
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
              tint="#3D3D3D"
              mouseReact={false}
              mouseStrength={0.5}
              brightness={1.0}
            />
          </div>

          {/* Content Layer */}
          <div className="relative z-10 flex flex-col items-start justify-center h-full px-16 md:px-28 text-left">
            <h1 className="text-[32px] md:text-[64px] font-semibold leading-tight tracking-[-0.02em] text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500 whitespace-nowrap mb-7">
              The Autonomous DevOps
            </h1>
            <p className="max-w-2xl text-[16px] md:text-[18px] leading-relaxed text-zinc-300">
              From build failures to runtime crashes, Sanos detects every error across your stack, diagnoses the root cause, and ships the fix as a pull request.
            </p>

            <button
              onClick={handleLogin}
              className="flex h-12 items-center gap-3 rounded-full px-6 text-white font-accent text-base bg-white/20 border border-white/30 hover:bg-white/30 backdrop-blur-[2.5px] transition-colors mt-10"
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
                <span className="font-accent">Sign in with GitHub</span>
              </div>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
