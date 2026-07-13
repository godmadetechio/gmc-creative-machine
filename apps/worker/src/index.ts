import "dotenv/config";
import { RunSchema } from "@gmc/shared";
import { pipelines } from "./pipelines/index";
import { createServiceClient } from "./supabase";

const POLL_INTERVAL_MS = 10_000;

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

  for (;;) {
    const run = await claimNextRun(supabase);
    if (run) {
      console.log(`[worker] run ${run.id} (${run.type}) → running`);
      try {
        await pipelines[run.type]({ supabase, run });
        console.log(`[worker] run ${run.id} finished`);
      } catch (err) {
        console.error(`[worker] run ${run.id} crashed:`, err);
        await supabase
          .from("runs")
          .update({
            status: "failed",
            output_json: {
              error: err instanceof Error ? err.message : String(err),
            },
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
