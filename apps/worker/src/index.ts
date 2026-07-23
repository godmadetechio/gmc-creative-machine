import "./env";
import { hostname } from "node:os";
import { RunSchema } from "@gmc/shared";
import { refreshProviderBalances } from "./balances";
import { pipelines } from "./pipelines/index";
import { createServiceClient } from "./supabase";

const POLL_INTERVAL_MS = 10_000;
// Liveness beat for the dashboard's "worker offline" banner (stale >2 min).
const HEARTBEAT_INTERVAL_MS = 30_000;
// External provider balance snapshots for the Usage page (best-effort).
const BALANCE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function startHeartbeat(supabase: ReturnType<typeof createServiceClient>) {
  const workerId = `${hostname()}#${process.pid}`;
  const startedAt = new Date().toISOString();
  const beat = async () => {
    try {
      const { error } = await supabase.from("worker_heartbeats").upsert({
        id: workerId,
        started_at: startedAt,
        last_seen_at: new Date().toISOString(),
      });
      if (error) console.warn(`[worker] heartbeat failed: ${error.message}`);
    } catch (err) {
      // A failed beat must never take the worker down.
      console.warn(`[worker] heartbeat failed: ${err instanceof Error ? err.message : err}`);
    }
  };
  void beat();
  // unref(): the timer never keeps the process alive on its own. Pipelines
  // are I/O-bound, so the interval fires fine during long runs.
  setInterval(beat, HEARTBEAT_INTERVAL_MS).unref();
}

async function claimNextRun(
  supabase: ReturnType<typeof createServiceClient>,
) {
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[worker] failed to poll runs:", error.message);
    return null;
  }
  const row = data?.[0];
  if (!row) return null;

  const run = RunSchema.parse(row);

  // Claim it: queued → running. The status filter makes this safe enough
  // for a single-worker setup; real locking can come with the job queue.
  const { error: claimError } = await supabase
    .from("runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "queued");

  if (claimError) {
    console.error("[worker] failed to claim run:", claimError.message);
    return null;
  }
  return run;
}

async function main() {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error(`[worker] ${err instanceof Error ? err.message : err}`);
    console.error("[worker] exiting — configure env vars and restart.");
    process.exit(1);
  }

  console.log(
    `[worker] started — polling for queued runs every ${POLL_INTERVAL_MS / 1000}s`,
  );
  startHeartbeat(supabase);

  // Hourly, fire-and-forget: a hung provider API must never stall the run
  // loop, and a failed refresh only records its error (never blocks runs).
  let lastBalanceRefresh = 0;
  const maybeRefreshBalances = () => {
    if (Date.now() - lastBalanceRefresh < BALANCE_REFRESH_INTERVAL_MS) return;
    lastBalanceRefresh = Date.now();
    void refreshProviderBalances(supabase).catch((err) =>
      console.warn(
        `[worker] balance refresh failed: ${err instanceof Error ? err.message : err}`,
      ),
    );
  };

  for (;;) {
    maybeRefreshBalances();
    const run = await claimNextRun(supabase);
    if (run) {
      console.log(`[worker] run ${run.id} (${run.type}) → running`);
      try {
        await pipelines[run.type]({ supabase, run });
        console.log(`[worker] run ${run.id} finished`);
      } catch (err) {
        console.error(`[worker] run ${run.id} crashed:`, err);
        // Pipelines attach costUsd to errors so spend on failed runs is kept.
        const costUsd = (err as { costUsd?: number })?.costUsd;
        await supabase
          .from("runs")
          .update({
            status: "failed",
            output_json: {
              error: err instanceof Error ? err.message : String(err),
            },
            cost_usd: typeof costUsd === "number" ? Number(costUsd.toFixed(4)) : null,
            finished_at: new Date().toISOString(),
          })
          .eq("id", run.id);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

void main();
