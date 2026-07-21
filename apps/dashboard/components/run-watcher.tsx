"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Live run updates: subscribes to postgres_changes on the runs table
// (scoped to one client when clientId is set) and soft-refreshes the route
// on any transition — queued→running, stage writes, completion. While the
// channel isn't connected (cold start, realtime unavailable), a 5s refresh
// interval covers — but only while a run is actually active, so idle pages
// never poll. Mount unconditionally: a run enqueued after page load still
// triggers the subscription path.
export function RunWatcher({
  clientId,
  active,
}: {
  /** Scope the subscription to one client's runs; omit for global runs. */
  clientId?: string;
  /** Whether a relevant run is queued/running right now (fallback gate). */
  active: boolean;
}) {
  const router = useRouter();
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;

    // Bursts of run updates (stage writes) collapse into one refresh.
    const debouncedRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 300);
    };

    const startFallback = () => {
      if (fallback) return;
      fallback = setInterval(() => {
        if (activeRef.current) router.refresh();
      }, 5000);
    };
    const stopFallback = () => {
      if (fallback) {
        clearInterval(fallback);
        fallback = null;
      }
    };

    const channel = supabase
      .channel(`runs-watch-${clientId ?? "global"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "runs",
          ...(clientId ? { filter: `client_id=eq.${clientId}` } : {}),
        },
        debouncedRefresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") stopFallback();
        else startFallback();
      });

    // Covers the window before the channel connects (and forever if it
    // never does — e.g. runs not in the realtime publication).
    startFallback();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      stopFallback();
      void supabase.removeChannel(channel);
    };
  }, [router, clientId]);

  return null;
}
