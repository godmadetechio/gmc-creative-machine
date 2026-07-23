import "../env";
import { StillAdsInputSchema } from "@gmc/shared";
import { runStillAds } from "../pipelines/still-ads";
import { createServiceClient } from "../supabase";

// pnpm pipeline:test-stills [client name]
// Cheap smoke run of the still_ads pipeline: 2 concepts × 2 variants at 4:5
// (≈4 images / ~$0.60 generation). Requires an active BBM with avatars and
// at least one selected ad candidate — and a passing pnpm fal:test first.

const clientName = process.argv[2] ?? "Ben's Fitness";

async function main() {
  const supabase = createServiceClient();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name")
    .ilike("name", clientName)
    .limit(2);
  if (error) throw new Error(`Failed to look up client: ${error.message}`);
  if ((clients?.length ?? 0) > 1) {
    throw new Error(`Multiple clients match "${clientName}" — be more specific.`);
  }
  const client = clients?.[0];
  if (!client) {
    throw new Error(
      `No client named "${clientName}" found — create it in the dashboard first, or pass a name: pnpm pipeline:test-stills "Client Name"`,
    );
  }

  const input = StillAdsInputSchema.parse({
    concept_count: 2,
    variants_per_concept: 2,
    aspects: ["4:5"],
    operator_prompt: "smoke test run — keep concepts simple",
    max_generation_usd: 2,
    // End-to-end smoke: no human in the loop, go straight to generation.
    skip_review: true,
  });
  console.log(
    `[pipeline:test-stills] client: ${client.name} (${client.id}) — 2 concepts × 2 variants`,
  );

  const { data: runRow, error: runError } = await supabase
    .from("runs")
    .insert({
      client_id: client.id,
      type: "still_ads",
      status: "running",
      input_json: input,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError || !runRow) {
    throw new Error(`Failed to create run: ${runError?.message}`);
  }

  try {
    const result = await runStillAds(client.id, input, {
      supabase,
      runId: runRow.id,
    });
    await supabase
      .from("runs")
      .update({
        status: "needs_review",
        output_json: result.output,
        cost_usd: result.costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runRow.id);
    console.log(
      `\n[pipeline:test-stills] ✅ ${result.creativeCount} creatives (${result.imageCount} images) — $${result.costUsd.toFixed(2)} total ($${result.generationCostUsd.toFixed(2)} generation)`,
    );
    if (result.warnings.length > 0) {
      console.log(`[pipeline:test-stills] warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`);
    }
    console.log(
      `[pipeline:test-stills] review at /clients/${client.id}/creatives`,
    );
  } catch (err) {
    const costUsd = (err as { costUsd?: number })?.costUsd;
    await supabase
      .from("runs")
      .update({
        status: "failed",
        output_json: { error: err instanceof Error ? err.message : String(err) },
        cost_usd: typeof costUsd === "number" ? Number(costUsd.toFixed(4)) : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runRow.id);
    throw err;
  }
}

main().catch((err) => {
  console.error("[pipeline:test-stills] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
