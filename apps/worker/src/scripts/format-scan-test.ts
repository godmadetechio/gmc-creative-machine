import "../env";
import { createServiceClient } from "../supabase";
import { pipelines } from "../pipelines/index";
import { RunSchema, SeedVertical } from "@gmc/shared";

// pnpm format:scan [--vertical=dtc] [--limit=N] [--country=US]
// Runs the GLOBAL format_scan pipeline (client_id null), bypassing the
// polling loop. Defaults to all verticals, 25 ads per advertiser, US.
// Pass --vertical=dtc --limit=10 for a cheap smoke test (a vertical-
// restricted scan never fades formats). The Apify actor bills a minimum
// of 10 charged results per advertiser — a lower --limit is clamped to
// (and billed as) 10.

const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const flagValue = (name: string) =>
  flags.find((f) => f.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const verticalFlag = flagValue("vertical");
if (verticalFlag && !SeedVertical.safeParse(verticalFlag).success) {
  console.error(
    `[format:scan] --vertical must be one of ${SeedVertical.options.join(", ")}, got "${verticalFlag}"`,
  );
  process.exit(1);
}
const limitFlag = flagValue("limit");
const limitPerAdvertiser = limitFlag ? Number(limitFlag) : 25;
if (!Number.isInteger(limitPerAdvertiser) || limitPerAdvertiser < 3 || limitPerAdvertiser > 30) {
  console.error(
    `[format:scan] --limit must be an integer 3-30, got "${limitFlag}" (values below 10 are clamped to the actor's 10-result billing minimum)`,
  );
  process.exit(1);
}
const country = (flagValue("country") ?? "US").toUpperCase();

async function main() {
  const supabase = createServiceClient();
  console.log(
    `[format:scan] global scan — vertical: ${verticalFlag ?? "all"}, limit ${limitPerAdvertiser}/advertiser, country ${country}`,
  );

  const { data: runRow, error: runError } = await supabase
    .from("runs")
    .insert({
      client_id: null, // global run
      type: "format_scan",
      status: "running",
      input_json: {
        limit_per_advertiser: limitPerAdvertiser,
        country,
        ...(verticalFlag ? { vertical: verticalFlag } : {}),
      },
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (runError || !runRow) {
    throw new Error(`Failed to create run: ${runError?.message}`);
  }
  const run = RunSchema.parse(runRow);
  console.log(`[format:scan] run ${run.id} created`);

  // Prints the library — runs even when the pipeline fails so the merge
  // result is always eyeballable.
  async function printLibrary() {
    const { data: formats, error: libraryError } = await supabase
      .from("format_library")
      .select("name, status, verticals_seen, scans_missed, last_confirmed, example_ads")
      .order("status")
      .order("last_confirmed", { ascending: false, nullsFirst: false });
    if (libraryError) {
      console.warn(`[format:scan] failed to list library: ${libraryError.message}`);
      return;
    }
    console.log(`[format:scan] format library (${formats?.length ?? 0}):`);
    for (const f of formats ?? []) {
      const verticals = Array.isArray(f.verticals_seen) ? f.verticals_seen.join(",") : "";
      const examples = Array.isArray(f.example_ads) ? f.example_ads.length : 0;
      console.log(
        `  [${f.status}${f.scans_missed ? `, missed ${f.scans_missed}` : ""}] ${f.name} — verticals: ${verticals || "none"} — ${examples} example(s) — last confirmed ${f.last_confirmed ?? "never"}`,
      );
    }
  }

  try {
    await pipelines.format_scan({ supabase, run });
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
    await printLibrary();
    throw err;
  }

  await printLibrary();

  const { data: finished } = await supabase
    .from("runs")
    .select("status, cost_usd, output_json")
    .eq("id", run.id)
    .single();
  console.log(`[format:scan] run finished:`, JSON.stringify(finished, null, 2));
}

main().catch((err) => {
  console.error(`[format:scan] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
