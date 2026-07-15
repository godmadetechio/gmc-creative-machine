import "../env";
import { createServiceClient } from "../supabase";
import { pipelines } from "../pipelines/index";
import { RunSchema } from "@gmc/shared";

// pnpm pipeline:test-selection [client name] [country] [--max=N]
// Runs the creative_selection pipeline against a real client, bypassing the
// polling loop. Defaults to "Ben's Fitness", US, 60 candidates (breadth run;
// pass --max=10 for a cheap smoke test).
// Requires an active BBM for the client (run pipeline:test first).

const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const clientName = args[0] ?? "Ben's Fitness";
const country = (args[1] ?? "US").toUpperCase();
const maxFlag = flags.find((f) => f.startsWith("--max="))?.slice("--max=".length);
const maxCandidates = maxFlag ? Number(maxFlag) : 60;
if (!Number.isInteger(maxCandidates) || maxCandidates < 5 || maxCandidates > 100) {
  console.error(`[pipeline:test-selection] --max must be an integer 5-100, got "${maxFlag}"`);
  process.exit(1);
}

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
      `No client named "${clientName}" found — create it in the dashboard first, or pass a name: pnpm pipeline:test-selection "Client Name"`,
    );
  }
  console.log(
    `[pipeline:test-selection] client: ${client.name} (${client.id}), country: ${country}, max ${maxCandidates} candidates`,
  );

  const { data: runRow, error: runError } = await supabase
    .from("runs")
    .insert({
      client_id: client.id,
      type: "creative_selection",
      status: "running",
      input_json: { max_candidates: maxCandidates, country },
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (runError || !runRow) {
    throw new Error(`Failed to create run: ${runError?.message}`);
  }
  const run = RunSchema.parse(runRow);
  console.log(`[pipeline:test-selection] run ${run.id} created`);

  // Prints the client's competitors table (the scout writes it as step 0) —
  // runs even when the pipeline fails so scout quality is always eyeballable.
  async function printCompetitors() {
    const { data: competitors, error: competitorsError } = await supabase
      .from("competitors")
      .select("name, source, status, fb_page_url, positioning_notes")
      .eq("client_id", client!.id)
      .order("created_at");
    if (competitorsError) {
      console.warn(
        `[pipeline:test-selection] failed to list competitors: ${competitorsError.message}`,
      );
      return;
    }
    console.log(
      `[pipeline:test-selection] competitors on file (${competitors?.length ?? 0}):`,
    );
    for (const c of competitors ?? []) {
      console.log(
        `  [${c.source}${c.status === "ignored" ? ", IGNORED" : ""}] ${c.name} — ${c.fb_page_url ?? "no FB page"}${c.positioning_notes ? ` — ${c.positioning_notes}` : ""}`,
      );
    }
  }

  try {
    await pipelines.creative_selection({ supabase, run });
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
    await printCompetitors();
    throw err;
  }

  await printCompetitors();

  const { data: finished } = await supabase
    .from("runs")
    .select("status, cost_usd, output_json")
    .eq("id", run.id)
    .single();
  console.log(`[pipeline:test-selection] run finished:`, JSON.stringify(finished, null, 2));
}

main().catch((err) => {
  console.error(
    `[pipeline:test-selection] FAILED: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
});
