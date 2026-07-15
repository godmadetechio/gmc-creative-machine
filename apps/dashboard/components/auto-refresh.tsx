"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// While a run is queued/running, re-render the (server) page every few
// seconds so its status is live without realtime plumbing.
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [active, router]);

  return null;
}
