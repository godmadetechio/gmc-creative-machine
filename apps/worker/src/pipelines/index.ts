import type { SupabaseClient } from "@supabase/supabase-js";
import type { Run, RunType } from "@gmc/shared";
import { buyerBrainHandler } from "./buyer-brain";
import { creativeSelectionHandler } from "./creative-selection";
import { formatScanHandler } from "./format-scan";

export type PipelineContext = {
  supabase: SupabaseClient;
  run: Run;
};

export type PipelineHandler = (ctx: PipelineContext) => Promise<void>;

// Placeholder for pipelines from later phases.
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
  buyer_brain: buyerBrainHandler,
  creative_selection: creativeSelectionHandler,
  still_ads: notImplemented("Phase 3"),
  video_ads: notImplemented("Phase 4"),
  format_scan: formatScanHandler,
};
