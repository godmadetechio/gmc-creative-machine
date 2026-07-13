import type { SupabaseClient } from "@supabase/supabase-js";
import type { Run, RunType } from "@gmc/shared";

export type PipelineContext = {
  supabase: SupabaseClient;
  run: Run;
};

export type PipelineHandler = (ctx: PipelineContext) => Promise<void>;

// Placeholder until the real pipelines land (Buyer Brain in Phase 1).
// Marks the run failed so a queued run never sits in 'running' forever.
function notImplemented(phase: string): PipelineHandler {
  return async ({ supabase, run }) => {
    await supabase
      .from("runs")
      .update({
        status: "failed",
        output_json: {
          error: `Pipeline '${run.type}' is not implemented yet (${phase}).`,
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  };
}

export const pipelines: Record<RunType, PipelineHandler> = {
  buyer_brain: notImplemented("Phase 1"),
  creative_selection: notImplemented("Phase 2"),
  still_ads: notImplemented("Phase 3"),
  video_ads: notImplemented("Phase 4"),
};
