"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Dismissible low-balance banner — same pattern as WorkerStatusBanner.
// Polls the lightweight status route on mount, every 5 min, and on tab
// visibility. Dismissal is per alert-set (the sorted provider list), so a
// NEW provider dropping below threshold re-shows it. Advisory only — low
// or stale balance data never blocks runs.

const CHECK_INTERVAL_MS = 5 * 60_000;
const DISMISS_KEY = "low-balance-dismissed";

type BalanceAlert = {
  provider: string;
  label: string;
  valueUsd: number | null;
  thresholdUsd: number | null;
  estimated: boolean;
};

export function LowBalanceBanner() {
  const [alerts, setAlerts] = useState<BalanceAlert[] | null>(null);
  const [dismissedEpisode, setDismissedEpisode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(DISMISS_KEY);
  });

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/balance-status", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { alerts: BalanceAlert[] };
      setAlerts(body.alerts);
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

  if (!alerts || alerts.length === 0) return null;
  const episode = alerts
    .map((a) => a.provider)
    .sort()
    .join(",");
  if (dismissedEpisode === episode) return null;

  const summary = alerts
    .map(
      (a) =>
        `${a.label} ${a.valueUsd != null ? `$${a.valueUsd.toFixed(2)}` : "?"}${a.estimated ? " est." : ""}${
          a.thresholdUsd != null ? ` (alert below $${a.thresholdUsd.toFixed(0)})` : ""
        }`,
    )
    .join(" · ");

  return (
    <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 shrink-0" />
        <p className="flex-1">
          Low provider balance: {summary} — top up before runs start failing.{" "}
          <Link href="/usage" className="underline">
            Usage page
          </Link>
          .
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
