"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Dismissible "worker offline" banner. Polls the lightweight status route
// (not a full page refresh) on mount, every 60s, and when the tab regains
// visibility. Dismissal is remembered per outage episode (keyed by the
// heartbeat timestamp the outage started from), so a NEW outage re-shows it.

const CHECK_INTERVAL_MS = 60_000;
const DISMISS_KEY = "worker-offline-dismissed";

type WorkerStatus = {
  online: boolean;
  lastSeenAt: string | null;
  stuckQueued: number;
};

export function WorkerStatusBanner() {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [dismissedEpisode, setDismissedEpisode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(DISMISS_KEY);
  });

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/worker-status", { cache: "no-store" });
      if (!res.ok) return;
      setStatus((await res.json()) as WorkerStatus);
    } catch {
      // Network hiccup — keep the last known state.
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  if (!status || status.online) return null;
  const episode = status.lastSeenAt ?? "never";
  if (dismissedEpisode === episode) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <p className="flex-1">
          Worker offline — runs will queue but not execute.
          {status.stuckQueued > 0 &&
            ` ${status.stuckQueued} run${status.stuckQueued === 1 ? "" : "s"} already stuck in the queue.`}{" "}
          Start it with <code className="font-mono text-xs">pnpm worker:dev</code>.
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={() => {
            window.sessionStorage.setItem(DISMISS_KEY, episode);
            setDismissedEpisode(episode);
          }}
        >
          <X className="size-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>
    </div>
  );
}
