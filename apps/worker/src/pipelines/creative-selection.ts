import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BbmVersionSchema,
  ClientSchema,
  CompetitorSchema,
  CompetitorScoutOutputSchema,
  CreativeSelectionInputSchema,
  ScorerOutputSchema,
  SearchTargetsSchema,
  isValidFacebookPageUrl,
  type AdScore,
  type Competitor,
  type CreativeSelectionInput,
  type ScoutedCompetitor,
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
  formatHint,
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
const MAX_NEW_COMPETITORS = 8;
// Per-advertiser pulls are the PRIMARY source (keyword search is noisy),
// but keyword targets are how new competitors get discovered — leave a few
// slots for them under MAX_TARGETS.
const MAX_COMPETITOR_PAGE_TARGETS = 6;
const MIN_COMPETITOR_CONFIDENCE = 3;
// "ad longevity is the filter" — ads running 30+ days are likely winners.
const PREFERRED_MIN_DAYS_RUNNING = 30;
// Diversity guards: a heavy advertiser (page pulls return up to PER_URL_CAP
// ads each) must not monopolize the scoring pool or the review queue.
const MAX_POOL_PER_ADVERTISER = 12;
const MAX_CANDIDATES_PER_ADVERTISER = 5;

export type CreativeSelectionResult = {
  candidateCount: number;
  costUsd: number;
  warnings: string[];
  output: Record<string, unknown>;
};

type ScorableAd = NormalizedAd & { score?: AdScore };

function advertiserKey(ad: NormalizedAd): string {
  return (ad.advertiser ?? ad.ad_id).trim().toLowerCase();
}

function scorerAdPayload(ad: NormalizedAd) {
  return {
    ad_id: ad.ad_id,
    advertiser: ad.advertiser,
    ad_copy: ad.ad_copy || "(no ad copy captured)",
    format_hint: formatHint(ad),
    media_count: ad.media_urls.length,
    platforms: ad.platforms,
    days_running: ad.days_running,
    variant_count: ad.duplicate_count,
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

  const validationWarner = (name: string) => (issues: string, attempt: number) =>
    warnings.push(
      `${name} output failed validation (attempt ${attempt}): ${
        issues.length > 300 ? `${issues.slice(0, 300)}…` : issues
      }`,
    );

  // ── 0. Competitor scout — keep the competitors table fresh ─────────────
  // Scouting is enrichment: a failed scout degrades to the roster we already
  // have, with a warning. Ignored competitors are never searched, and their
  // names are shown to the scout so they don't get re-suggested.
  const { data: competitorRows, error: competitorError } = await supabase
    .from("competitors")
    .select("*")
    .eq("client_id", clientId);
  if (competitorError) {
    throw new Error(`Failed to load competitors: ${competitorError.message}`);
  }
  const existingCompetitors = (competitorRows ?? []).map((row) =>
    CompetitorSchema.parse(row),
  );

  console.log(
    `[creative_selection] scouting competitors (${existingCompetitors.length} on file)…`,
  );
  let scouted: ScoutedCompetitor[] = [];
  try {
    const scout = await withValidationRetry(CompetitorScoutOutputSchema, {
      prompt: loadPrompt("competitor-scout", {
        ...promptVars,
        max_new: MAX_NEW_COMPETITORS,
        existing_competitors_json: existingCompetitors.length
          ? JSON.stringify(
              existingCompetitors.map((c) => ({
                name: c.name,
                status: c.status,
                fb_page_url: c.fb_page_url,
              })),
              null,
              2,
            )
          : "none yet",
      }),
      tools: ["WebSearch"],
      maxTurns: 20,
      label: "competitor-scout",
      onValidationError: validationWarner("competitor-scout"),
    });
    cost.add("competitor-scout", scout.costUsd, scout.usage);
    scouted = scout.data.competitors;
  } catch (err) {
    cost.addFromError("competitor-scout", err);
    const message = `competitor-scout failed — continuing with the ${existingCompetitors.length} competitors on file: ${
      err instanceof Error ? err.message : err
    }`;
    warnings.push(message);
    console.warn(`[creative_selection] ${message}`);
  }

  // Unverifiable page URLs lose the URL, not the competitor.
  for (const s of scouted) {
    if (s.fb_page_url && !isValidFacebookPageUrl(s.fb_page_url)) {
      warnings.push(
        `competitor-scout gave "${s.name}" an invalid Facebook page URL, dropped: ${s.fb_page_url}`,
      );
      delete s.fb_page_url;
    }
  }

  // Upsert new names only — (client_id, lower(name)) is unique, and existing
  // rows (including ignored ones) must not be duplicated or resurrected.
  const knownNames = new Set(existingCompetitors.map((c) => c.name.trim().toLowerCase()));
  const freshScouted = scouted.filter((s) => {
    const key = s.name.trim().toLowerCase();
    if (knownNames.has(key)) return false;
    knownNames.add(key);
    return true;
  });
  let addedCompetitors: Competitor[] = [];
  if (freshScouted.length > 0) {
    const { data: inserted, error: insertCompetitorsError } = await supabase
      .from("competitors")
      .insert(
        freshScouted.map((s) => ({
          client_id: clientId,
          name: s.name.trim(),
          fb_page_url: s.fb_page_url ?? null,
          ig_handle: s.ig_handle ?? null,
          website: s.website ?? null,
          positioning_notes: s.positioning_notes,
          source: "agent",
          status: "active",
        })),
      )
      .select("*");
    if (insertCompetitorsError) {
      warnings.push(
        `failed to write ${freshScouted.length} scouted competitors: ${insertCompetitorsError.message}`,
      );
      console.warn(`[creative_selection] competitor insert failed: ${insertCompetitorsError.message}`);
    } else {
      addedCompetitors = (inserted ?? []).map((row) => CompetitorSchema.parse(row));
    }
  }
  for (const s of scouted) {
    const dup = !freshScouted.includes(s) ? ", already on file" : "";
    console.log(
      `[creative_selection] scouted (conf ${s.confidence}${dup}): ${s.name} ${s.fb_page_url ?? "(no verified FB page)"}`,
    );
  }

  // Manual entries are operator-vetted (top confidence); agent entries carry
  // this run's scout confidence, or the qualifying floor when from a past run.
  const confidenceByName = new Map(
    scouted.map((s) => [s.name.trim().toLowerCase(), s.confidence]),
  );
  const activeCompetitors = [
    ...existingCompetitors.filter((c) => c.status === "active"),
    ...addedCompetitors,
  ];
  const competitorConfidence = (c: Competitor) =>
    c.source === "manual"
      ? 5
      : (confidenceByName.get(c.name.trim().toLowerCase()) ?? MIN_COMPETITOR_CONFIDENCE);

  const competitorPageTargets: SearchTarget[] = activeCompetitors
    .filter(
      (c) =>
        c.fb_page_url &&
        isValidFacebookPageUrl(c.fb_page_url) &&
        competitorConfidence(c) >= MIN_COMPETITOR_CONFIDENCE,
    )
    .sort((a, b) => competitorConfidence(b) - competitorConfidence(a))
    .slice(0, MAX_COMPETITOR_PAGE_TARGETS)
    .map((c) => ({
      kind: "page_url" as const,
      value: c.fb_page_url!,
      rationale: `per-advertiser pull: ${c.name} (${c.source}, confidence ${competitorConfidence(c)})`,
    }));

  // ── 1. Derive search targets from the BBM ──────────────────────────────
  console.log(
    `[creative_selection] deriving search targets from BBM v${bbmVersion.version}…`,
  );
  let targets: SearchTarget[];
  try {
    const derived = await withValidationRetry(SearchTargetsSchema, {
      prompt: loadPrompt("search-deriver", {
        ...promptVars,
        min_targets: MIN_TARGETS,
        max_targets: MAX_TARGETS,
        per_url_cap: PER_URL_CAP,
        competitors_json: activeCompetitors.length
          ? JSON.stringify(
              activeCompetitors.map((c) => ({
                name: c.name,
                fb_page_url: c.fb_page_url,
                positioning_notes: c.positioning_notes,
                confidence: competitorConfidence(c),
              })),
              null,
              2,
            )
          : "none on file — lean on keyword targets",
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
  // The MUST-include rule is enforced here, not just in the prompt: roster
  // competitor pages (confidence >= 3) go first, deriver targets fill the
  // rest, deduped, capped at MAX_TARGETS.
  const normalizeTargetValue = (value: string) =>
    value.trim().toLowerCase().replace(/\/+$/, "");
  const seenValues = new Set<string>();
  const merged: SearchTarget[] = [];
  for (const target of [...competitorPageTargets, ...targets]) {
    const key = normalizeTargetValue(target.value);
    if (seenValues.has(key)) continue;
    seenValues.add(key);
    merged.push(target);
    if (merged.length >= MAX_TARGETS) break;
  }
  targets = merged;

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
  // Diversity guard: cap ads per advertiser so one heavy page pull can't
  // fill the pool (a live run came back 95/101 from two advertisers).
  const poolByAdvertiser = new Map<string, number>();
  const pool: ScorableAd[] = [];
  for (const ad of ranked) {
    const key = advertiserKey(ad);
    const count = poolByAdvertiser.get(key) ?? 0;
    if (count >= MAX_POOL_PER_ADVERTISER) continue;
    poolByAdvertiser.set(key, count + 1);
    pool.push(ad);
    if (pool.length >= SCORING_POOL) break;
  }
  const youngInPool = pool.filter(
    (ad) => (ad.days_running ?? -1) < PREFERRED_MIN_DAYS_RUNNING,
  ).length;
  console.log(
    `[creative_selection] ${scrapedRaw} raw → ${deduped.length} deduped → scoring ${pool.length} from ${poolByAdvertiser.size} advertisers (${youngInPool} under ${PREFERRED_MIN_DAYS_RUNNING}d)`,
  );
  // Longevity is the filter, so only warn when it actually failed: a pool
  // that is MOSTLY young means the scrape found few proven ads.
  if (youngInPool > pool.length / 2) {
    warnings.push(
      `${youngInPool}/${pool.length} ads in the scoring pool run < ${PREFERRED_MIN_DAYS_RUNNING} days (or have no start date) — few long-runners found; the longevity signal is weak this run`,
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

  // ── 5. Top N → ad_candidates (diversity-capped per advertiser) ─────────
  const rankedByScore = scored
    .map((ad) => ({ ad, score: scoreById.get(ad.ad_id)! }))
    .sort((a, b) => b.score.score - a.score.score);
  const candidatesByAdvertiser = new Map<string, number>();
  const top: typeof rankedByScore = [];
  for (const entry of rankedByScore) {
    const key = advertiserKey(entry.ad);
    const count = candidatesByAdvertiser.get(key) ?? 0;
    if (count >= MAX_CANDIDATES_PER_ADVERTISER) continue;
    candidatesByAdvertiser.set(key, count + 1);
    top.push(entry);
    if (top.length >= input.max_candidates) break;
  }

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
        // duplicate_count rides along with the scorer output: variants are
        // a conviction signal the reviewer should see.
        match_rationale_json: { ...score, duplicate_count: ad.duplicate_count },
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
      candidate_advertisers: candidatesByAdvertiser.size,
      competitors: {
        on_file: existingCompetitors.length,
        scouted: scouted.map((s) => ({
          name: s.name,
          fb_page_url: s.fb_page_url ?? null,
          confidence: s.confidence,
        })),
        added: addedCompetitors.map((c) => c.name),
        page_targets: competitorPageTargets.length,
      },
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
