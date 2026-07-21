import type { SupabaseClient } from "@supabase/supabase-js";

// Fire-and-forget stage marker for the dashboard ("running · scoring").
// Purely additive: a failed write can never fail a run, and callers do not
// await it — pipeline behavior is unchanged.
export function setRunStage(
  supabase: SupabaseClient,
  runId: string,
  stage: string,
): void {
  void supabase
    .from("runs")
    .update({ stage })
    .eq("id", runId)
    .then(({ error }) => {
      if (error) {
        console.warn(`[run-stage] failed to set stage '${stage}': ${error.message}`);
      }
    });
}
