import "../env";
import { createServiceClient } from "../supabase";
import { pipelines } from "../pipelines/index";
import { RunSchema, StoredBBMSchema } from "@gmc/shared";

// pnpm pipeline:test [client name]
// Runs the buyer_brain pipeline at depth quick against a real client,
// bypassing the polling loop. Defaults to "Ben's Fitness".

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
      `No client named "${clientName}" found — create it in the dashboard first, or pass a name: pnpm pipeline:test "Client Name"`,
    );
  }
  console.log(`[pipeline:test] client: ${client.name} (${client.id}), depth: quick`);

  const { data: runRow, error: runError } = await supabase
    .from("runs")
    .insert({
      client_id: client.id,
      type: "buyer_brain",
      status: "running",
      input_json: { depth: "quick" },
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (runError || !runRow) {
    throw new Error(`Failed to create run: ${runError?.message}`);
  }
  const run = RunSchema.parse(runRow);
  console.log(`[pipeline:test] run ${run.id} created`);

  try {
    await pipelines.buyer_brain({ supabase, run });
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
      .eq("id", run.id);
    throw err;
  }

  const { data: finished } = await supabase
    .from("runs")
    .select("status, cost_usd, output_json")
    .eq("id", run.id)
    .single();
  console.log(`[pipeline:test] run finished:`, JSON.stringify(finished, null, 2));

  // Surface the avatars so a prompt/schema change is verifiable at a glance.
  const bbmVersionId = (finished?.output_json as { bbm_version_id?: string } | null)
    ?.bbm_version_id;
  if (!bbmVersionId) return;
  const { data: bbmRow, error: bbmError } = await supabase
    .from("bbm_versions")
    .select("version, matrix_json")
    .eq("id", bbmVersionId)
    .single();
  if (bbmError || !bbmRow) {
    console.warn(`[pipeline:test] could not load BBM ${bbmVersionId}: ${bbmError?.message}`);
    return;
  }
  const parsed = StoredBBMSchema.safeParse(bbmRow.matrix_json);
  if (!parsed.success) {
    console.warn(`[pipeline:test] BBM v${bbmRow.version} failed schema parse:`, parsed.error.issues);
    return;
  }
  const avatars = parsed.data.avatars ?? [];
  console.log(`[pipeline:test] BBM v${bbmRow.version} avatars (${avatars.length}):`);
  for (const a of avatars) {
    console.log(`  • ${a.name} — ${a.identity_line}`);
    console.log(`      pain: ${a.top_pain}`);
    console.log(`      desire: ${a.top_desire}`);
    console.log(`      belief to break: ${a.belief_to_break}`);
    console.log(`      tone: ${a.tone_notes}`);
  }
  if (avatars.length === 0) {
    console.warn(`[pipeline:test] WARNING: no avatars in BBM v${bbmRow.version} — composer output predates or violates the avatars schema`);
  }
}

main().catch((err) => {
  console.error(`[pipeline:test] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
