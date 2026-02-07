"use client";

import { useState, useRef, useEffect } from "react";

interface LogWindowProps {
    logs: string[];
    defaultLines?: number;
    maxLines?: number;
    title?: string;
    isLoading?: boolean;
}

/**
 * A terminal-style log window that shows a limited number of lines by default
 * and can be expanded to show more.
 */
export default function LogWindow({
    logs,
    defaultLines = 4,
    maxLines = 100,
    title,
    isLoading = false,
}: LogWindowProps) {
    const [expanded, setExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const prevLogsLengthRef = useRef(logs.length);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (logs.length > prevLogsLengthRef.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
        prevLogsLengthRef.current = logs.length;
    }, [logs.length]);

    const displayedLogs = expanded
        ? logs.slice(-maxLines)
        : logs.slice(-defaultLines);

    const hasMoreLogs = logs.length > defaultLines;
    const hiddenCount = logs.length - defaultLines;

    if (logs.length === 0 && !isLoading) {
        return null;
    }

    return (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/40 overflow-hidden w-full">
            {/* Header */}
            {title && (
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
                    <span className="text-[9px] font-bold tracking-widest text-zinc-500 uppercase">
                        {title}
                    </span>
                    {isLoading && (
                        <span className="text-[9px] text-yellow-500 animate-pulse">
                            Live
                        </span>
                    )}
                </div>
            )}

            {/* Log content */}
            <div
                ref={containerRef}
                className={`px-3 py-2 font-mono text-[11px] leading-relaxed overflow-x-auto overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent ${expanded ? "max-h-64" : ""
                    }`}
                style={{ maxHeight: expanded ? "256px" : undefined }}
            >
                {displayedLogs.length === 0 && isLoading ? (
                    <div className="text-zinc-500 animate-pulse">Waiting for logs...</div>
                ) : (
                    displayedLogs.map((line, i) => (
                        <div
                            key={i}
                            className={`whitespace-pre-wrap break-all ${line.includes("[Error]") || line.includes("Error")
                                ? "text-red-400"
                                : line.includes("[Warning]") || line.includes("Warning")
                                    ? "text-yellow-400"
                                    : line.startsWith("[Dedalus]")
                                        ? "text-blue-400"
                                        : "text-zinc-400"
                                }`}
                        >
                            {line}
                        </div>
                    ))
                )}
            </div>

            {/* Expand/collapse button */}
            {hasMoreLogs && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full px-3 py-1.5 text-[10px] font-medium text-zinc-500 hover:text-zinc-300 transition-colors border-t border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                >
                    {expanded
                        ? "Show less"
                        : `Show ${hiddenCount} more line${hiddenCount !== 1 ? "s" : ""}`}
                </button>
            )}
        </div>
    );
}
