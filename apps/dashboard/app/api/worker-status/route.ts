import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lightweight liveness read for the WorkerStatusBanner: the worker beats
// every 30s; >2 min silence means offline. Also counts runs stuck queued
// (>3 min with no pickup) so the banner can say what's affected.

const STALE_AFTER_MS = 2 * 60 * 1000;
const STUCK_QUEUED_MS = 3 * 60 * 1000;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stuckBefore = new Date(Date.now() - STUCK_QUEUED_MS).toISOString();
  const [heartbeatResult, stuckResult] = await Promise.all([
    supabase
      .from("worker_heartbeats")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1),
    supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lt("created_at", stuckBefore),
  ]);

  const lastSeenAt = heartbeatResult.data?.[0]?.last_seen_at ?? null;
  const online =
    lastSeenAt !== null &&
    Date.now() - new Date(lastSeenAt).getTime() < STALE_AFTER_MS;

  return NextResponse.json({
    online,
    lastSeenAt,
    stuckQueued: stuckResult.count ?? 0,
  });
}
