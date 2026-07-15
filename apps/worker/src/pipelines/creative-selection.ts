import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BbmVersionSchema,
  ClientSchema,
  CreativeSelectionInputSchema,
  ScorerOutputSchema,
  SearchTargetsSchema,
  isValidFacebookPageUrl,
  type AdScore,
  type CreativeSelectionInput,
  type SearchTarget,
} from "@gmc/shared";
import { withValidationRetry } from "../agent";
import { callActor, getApifyToken } from "../apify";
import { CostTracker } from "../cost";
import {
  FB_ADS_ACTOR_ID,
  buildActorInput,
  buildAdLibrarySearchUrl,
  dedupeAds,
  normalizeAds,
  type NormalizedAd,
} from "../fb-ads";
import { loadPrompt } from "../prompts";
import type { PipelineHandler } from "./index";

// Per-target result cap (the actor is pay-per-result) and the max ads that
// go to scoring — scoring is the expensive agent stage, so it gets its own
// ceiling independent of how much the scrape returned.
const PER_URL_CAP = 50;
const SCORING_POOL = 60;
const SCORE_BATCH_SIZE = 8;
const MIN_TARGETS = 5;
const MAX_TARGETS = 10;
// "ad longevity is the filter" — ads running 30+ days are likely winners.
const PREFERRED_MIN_DAYS_RUNNING = 30;

export type CreativeSelectionResult = {
  candidateCount: number;
  costUsd: number;
  warnings: string[];
  output: Record<string, unknown>;
};

type ScorableAd = NormalizedAd & { score?: AdScore };

function scorerAdPayload(ad: NormalizedAd) {
  return {
    ad_id: ad.ad_id,
    advertiser: ad.advertiser,
    ad_copy: ad.ad_copy || "(no ad copy captured)",
    media: `${ad.media_urls.length} media url(s)`,
    platforms: ad.platforms,
    days_running: ad.days_running,
  };
}

export async function runCreativeSelection(
  clientId: string,
  input: CreativeSelectionInput,
  deps: { supabase: SupabaseClient },
): Promise<CreativeSelectionResult> {
  const { supabase } = deps;
  const cost = new CostTracker();
  const warnings: string[] = [];

  const apifyToken = getApifyToken();
  if (!apifyToken) {
    // Unlike the buyer-brain miners, this pipeline IS the Apify scrape —
    // there is nothing to degrade to.
    throw new Error(
      "APIFY_TOKEN is not set — creative selection needs the Facebook Ad Library scraper.",
    );
  }

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new Error(`Failed to load client: ${clientError.message}`);
  if (!clientRow) throw new Error(`Client ${clientId} not found`);
  const client = ClientSchema.parse(clientRow);

  // ── 0. Active BBM is a hard requirement ────────────────────────────────
  const { data: bbmRow, error: bbmError } = await supabase
    .from("bbm_versions")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .maybeSingle();
  if (bbmError) throw new Error(`Failed to load active BBM: ${bbmError.message}`);
  if (!bbmRow) {
    throw new Error(
      `No active Buyer Brain Matrix for ${client.name} — run the Buyer Brain pipeline first.`,
    );
  }
  const bbmVersion = BbmVersionSchema.parse(bbmRow);
  const bbmJson = JSON.stringify(bbmVersion.matrix_json, null, 2);

  const promptVars = {
    client_name: client.name,
    niche: client.niche ?? "not specified",
    brief: client.brief ?? "not specified",
    operator_prompt: input.operator_prompt || "none",
    country: input.country,
    bbm_json: bbmJson,
  };

  // ── 1. Derive search targets from the BBM ──────────────────────────────
  console.log(
    `[creative_selection] deriving search targets from BBM v${bbmVersion.version}…`,
  );
  const validationWarner = (name: string) => (issues: string, attempt: number) =>
    warnings.push(
      `${name} output failed validation (attempt ${attempt}): ${
        issues.length > 300 ? `${issues.slice(0, 300)}…` : issues
      }`,
    );

  let targets: SearchTarget[];
  try {
    const derived = await withValidationRetry(SearchTargetsSchema, {
      prompt: loadPrompt("search-deriver", {
        ...promptVars,
        min_targets: MIN_TARGETS,
        max_targets: MAX_TARGETS,
        per_url_cap: PER_URL_CAP,
      }),
      tools: ["WebSearch"], // to verify competitor page URLs
      maxTurns: 15,
      label: "search-deriver",
      onValidationError: validationWarner("search-deriver"),
    });
    cost.add("search-deriver", derived.costUsd, derived.usage);
    targets = derived.data.targets;
  } catch (err) {
    cost.addFromError("search-deriver", err);
    throw Object.assign(
      err instanceof Error ? err : new Error(String(err)),
      { costUsd: cost.total },
    );
  }

  // page_url targets the model failed to verify properly are dropped, not fatal
  targets = targets.filter((target) => {
    if (target.kind === "page_url" && !isValidFacebookPageUrl(target.value)) {
      warnings.push(
        `search-deriver produced an invalid Facebook page URL, dropped: ${target.value}`,
      );
      return false;
    }
    return true;
  });
  if (targets.length === 0) {
    throw Object.assign(
      new Error("search-deriver produced no usable targets"),
      { costUsd: cost.total },
    );
  }
  for (const t of targets) {
    console.log(`[creative_selection] target (${t.kind}): ${t.value}`);
  }

  // ── 2. Scrape the Ad Library per target ────────────────────────────────
  const urls = targets.map((target) =>
    target.kind === "keyword"
      ? buildAdLibrarySearchUrl(target.value, input.country)
      : target.value,
  );

  const scrapeResults = await Promise.allSettled(
    urls.map((url) =>
      callActor<Record<string, unknown>>(
        FB_ADS_ACTOR_ID,
        buildActorInput(url, { perUrlCount: PER_URL_CAP, country: input.country }),
        { token: apifyToken },
      ),
    ),
  );

  const perUrlCounts: Record<string, number> = {};
  const allAds: NormalizedAd[] = [];
  for (const [i, outcome] of scrapeResults.entries()) {
    const target = targets[i]!;
    const label = `${target.kind}:${target.value}`;
    if (outcome.status === "fulfilled") {
      perUrlCounts[label] = outcome.value.length;
      allAds.push(...normalizeAds(outcome.value, {
        label,
        onWarning: (message) => warnings.push(message),
      }));
    } else {
      perUrlCounts[label] = 0;
      const message = `scrape failed for ${label}: ${
        outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
      }`;
      warnings.push(message);
      console.warn(`[creative_selection] ${message}`);
    }
  }

  const scrapedRaw = scrapeResults.reduce(
    (sum, r) => sum + (r.status === "fulfilled" ? r.value.length : 0),
    0,
  );
  if (allAds.length === 0) {
    throw Object.assign(
      new Error(
        `Ad Library scrape produced 0 usable ads across ${urls.length} targets — ${warnings.join(" | ") || "no warnings captured"}`,
      ),
      { costUsd: cost.total },
    );
  }

  // ── 3. Dedupe + longevity preference ───────────────────────────────────
  const deduped = dedupeAds(allAds);
  // Long-running ads first ("longevity is the filter"), unknown dates last.
  const ranked = [...deduped].sort((a, b) => {
    const aPreferred = (a.days_running ?? -1) >= PREFERRED_MIN_DAYS_RUNNING;
    const bPreferred = (b.days_running ?? -1) >= PREFERRED_MIN_DAYS_RUNNING;
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    return (b.days_running ?? -1) - (a.days_running ?? -1);
  });
  const pool: ScorableAd[] = ranked.slice(0, SCORING_POOL);
  const youngInPool = pool.filter(
    (ad) => (ad.days_running ?? -1) < PREFERRED_MIN_DAYS_RUNNING,
  ).length;
  console.log(
    `[creative_selection] ${scrapedRaw} raw → ${deduped.length} deduped → scoring ${pool.length} (${youngInPool} under ${PREFERRED_MIN_DAYS_RUNNING}d)`,
  );
  if (youngInPool > 0) {
    warnings.push(
      `${youngInPool}/${pool.length} ads in the scoring pool run < ${PREFERRED_MIN_DAYS_RUNNING} days (or have no start date) — not enough long-runners scraped`,
    );
  }

  // ── 4. Score against the BBM in parallel batches ───────────────────────
  const batches: ScorableAd[][] = [];
  for (let i = 0; i < pool.length; i += SCORE_BATCH_SIZE) {
    batches.push(pool.slice(i, i + SCORE_BATCH_SIZE));
  }
  console.log(`[creative_selection] scoring ${pool.length} ads in ${batches.length} batches…`);

  const scoreOutcomes = await Promise.allSettled(
    batches.map((batch, i) =>
      withValidationRetry(ScorerOutputSchema, {
        prompt: loadPrompt("cross-reference-scorer", {
          ...promptVars,
          ads_json: JSON.stringify(batch.map(scorerAdPayload), null, 2),
        }),
        tools: [], // pure cross-referencing, no web access
        maxTurns: 8,
        label: `scorer-batch-${i + 1}`,
        onValidationError: validationWarner(`scorer batch ${i + 1}`),
      }),
    ),
  );

  const scoreById = new Map<string, AdScore>();
  for (const [i, outcome] of scoreOutcomes.entries()) {
    const label = `scorer-batch-${i + 1}`;
    if (outcome.status === "fulfilled") {
      cost.add(label, outcome.value.costUsd, outcome.value.usage);
      const batchIds = new Set(batches[i]!.map((ad) => ad.ad_id));
      for (const score of outcome.value.data.scores) {
        if (!batchIds.has(score.ad_id)) {
          warnings.push(`${label} returned unknown ad_id "${score.ad_id}" — ignored`);
          continue;
        }
        scoreById.set(score.ad_id, score);
      }
    } else {
      cost.addFromError(label, outcome.reason);
      const message = `${label} failed (${batches[i]!.length} ads dropped): ${
        outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
      }`;
      warnings.push(message);
      console.warn(`[creative_selection] ${message}`);
    }
  }

  const scored = pool.filter((ad) => scoreById.has(ad.ad_id));
  const unscored = pool.length - scored.length;
  if (unscored > 0) {
    warnings.push(`${unscored} ads received no score from their batch and were dropped`);
  }
  if (scored.length === 0) {
    throw Object.assign(
      new Error(`Scoring produced 0 scored ads — ${warnings.join(" | ")}`),
      { costUsd: cost.total },
    );
  }

  // ── 5. Top N → ad_candidates ───────────────────────────────────────────
  const top = scored
    .map((ad) => ({ ad, score: scoreById.get(ad.ad_id)! }))
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, input.max_candidates);

  const { data: insertedRows, error: insertError } = await supabase
    .from("ad_candidates")
    .insert(
      top.map(({ ad, score }) => ({
        client_id: clientId,
        bbm_version_id: bbmVersion.id,
        source: "fb_ad_library",
        advertiser: ad.advertiser,
        ad_url: ad.ad_url,
        media_urls: ad.media_urls,
        ad_copy: ad.ad_copy || null,
        run_time_days: ad.days_running,
        match_score: score.score,
        match_rationale_json: score,
        status: "candidate",
      })),
    )
    .select("id");
  if (insertError) {
    throw Object.assign(
      new Error(`Failed to write ad_candidates: ${insertError.message}`),
      { costUsd: cost.total },
    );
  }

  return {
    candidateCount: insertedRows?.length ?? top.length,
    costUsd: Number(cost.total.toFixed(4)),
    warnings,
    output: {
      bbm_version_id: bbmVersion.id,
      bbm_version: bbmVersion.version,
      candidate_count: insertedRows?.length ?? top.length,
      targets: targets.map((t) => ({ kind: t.kind, value: t.value })),
      scraped_raw: scrapedRaw,
      after_dedupe: deduped.length,
      scored: scored.length,
      apify: {
        actor: FB_ADS_ACTOR_ID,
        per_url_counts: perUrlCounts,
        note: `pay-per-result actor: ${scrapedRaw} results scraped across ${urls.length} URL(s); Apify billing is per result and is not included in cost_usd`,
      },
      warnings,
      usage: cost.usage,
    },
  };
}

export const creativeSelectionHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = CreativeSelectionInputSchema.parse(run.input_json ?? {});
  const result = await runCreativeSelection(run.client_id, input, { supabase });

  const { error } = await supabase
    .from("runs")
    .update({
      status: "needs_review",
      output_json: result.output,
      cost_usd: result.costUsd,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) {
    throw new Error(
      `${result.candidateCount} ad candidates written, but failed to update run: ${error.message}`,
    );
  }

  console.log(
    `[creative_selection] done — ${result.candidateCount} candidates for review, cost $${result.costUsd}`,
  );
};
