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

// BREADTH strategy: pull the top 20-30 advertisers and keep each one's
// ~3 best winners, instead of going deep on a few advertisers.

// Per-target result cap (the actor is pay-per-result) and the max ads that
// go to scoring — scoring is the expensive agent stage, so it gets its own
// ceiling independent of how much the scrape returned.
const PER_URL_CAP = 50;
const SCORING_POOL = 120;
const SCORE_BATCH_SIZE = 8;
// The deriver only emits keyword targets now — roster pages are pulled
// automatically in code.
const MIN_KEYWORD_TARGETS = 3;
const MAX_KEYWORD_TARGETS = 6;
// Scout until the roster has this many competitors with verified FB pages
// (bounded rounds; a dry round ends the loop early).
const TARGET_ROSTER_WITH_PAGES = 25;
const MAX_SCOUT_ROUNDS = 3;
const MAX_NEW_COMPETITORS = 10; // per scout round
const MAX_COMPETITOR_PAGE_TARGETS = 25;
const MIN_COMPETITOR_CONFIDENCE = 3;
// Pages that had no ads last pull are skipped until a re-check is due.
const RECHECK_NOT_RUNNING_AFTER_DAYS = 30;
// "ad longevity is the filter" — ads running 30+ days are likely winners.
const PREFERRED_MIN_DAYS_RUNNING = 30;
// Breadth guards: pre-score prune to each advertiser's ~5 longest-running
// ads, and at most 3 final candidates per advertiser.
const MAX_POOL_PER_ADVERTISER = 5;
const MAX_CANDIDATES_PER_ADVERTISER = 3;

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
  deps: { supabase: SupabaseClient; runId: string },
): Promise<CreativeSelectionResult> {
  const { supabase, runId } = deps;
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

  // Scout in rounds until the roster holds TARGET_ROSTER_WITH_PAGES active
  // competitors with verified pages (a dry or failed round ends the loop).
  const knownNames = new Set(existingCompetitors.map((c) => c.name.trim().toLowerCase()));
  const activeWithPages = (list: Competitor[]) =>
    list.filter((c) => c.status === "active" && c.fb_page_url).length;
  const scouted: ScoutedCompetitor[] = [];
  const addedCompetitors: Competitor[] = [];
  let scoutRounds = 0;
  while (
    activeWithPages([...existingCompetitors, ...addedCompetitors]) <
      TARGET_ROSTER_WITH_PAGES &&
    scoutRounds < MAX_SCOUT_ROUNDS
  ) {
    scoutRounds += 1;
    const roster = [...existingCompetitors, ...addedCompetitors];
    console.log(
      `[creative_selection] scout round ${scoutRounds}: ${activeWithPages(roster)}/${TARGET_ROSTER_WITH_PAGES} competitors with pages…`,
    );

    let roundScouted: ScoutedCompetitor[];
    try {
      const scout = await withValidationRetry(CompetitorScoutOutputSchema, {
        prompt: loadPrompt("competitor-scout", {
          ...promptVars,
          max_new: MAX_NEW_COMPETITORS,
          target_roster: TARGET_ROSTER_WITH_PAGES,
          current_with_pages: activeWithPages(roster),
          existing_competitors_json: roster.length
            ? JSON.stringify(
                roster.map((c) => ({
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
        label: `competitor-scout-${scoutRounds}`,
        onValidationError: validationWarner(`competitor-scout round ${scoutRounds}`),
      });
      cost.add(`competitor-scout-${scoutRounds}`, scout.costUsd, scout.usage);
      roundScouted = scout.data.competitors;
    } catch (err) {
      cost.addFromError(`competitor-scout-${scoutRounds}`, err);
      const message = `competitor-scout round ${scoutRounds} failed — continuing with the ${roster.length} competitors on file: ${
        err instanceof Error ? err.message : err
      }`;
      warnings.push(message);
      console.warn(`[creative_selection] ${message}`);
      break;
    }

    // Unverifiable page URLs lose the URL, not the competitor.
    for (const s of roundScouted) {
      if (s.fb_page_url && !isValidFacebookPageUrl(s.fb_page_url)) {
        warnings.push(
          `competitor-scout gave "${s.name}" an invalid Facebook page URL, dropped: ${s.fb_page_url}`,
        );
        delete s.fb_page_url;
      }
    }
    scouted.push(...roundScouted);

    // Insert new names only — (client_id, lower(name)) is unique, and
    // existing rows (including ignored) must not be duplicated/resurrected.
    const freshScouted = roundScouted.filter((s) => {
      const key = s.name.trim().toLowerCase();
      if (knownNames.has(key)) return false;
      knownNames.add(key);
      return true;
    });
    for (const s of roundScouted) {
      const dup = !freshScouted.includes(s) ? ", already on file" : "";
      console.log(
        `[creative_selection] scouted (conf ${s.confidence}${dup}): ${s.name} ${s.fb_page_url ?? "(no verified FB page)"}`,
      );
    }
    if (freshScouted.length === 0) {
      console.log(`[creative_selection] scout round ${scoutRounds} found nothing new — stopping`);
      break;
    }

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
      break;
    }
    addedCompetitors.push(...(inserted ?? []).map((row) => CompetitorSchema.parse(row)));
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

  const normalizeTargetValue = (value: string) =>
    value.trim().toLowerCase().replace(/\/+$/, "");

  // Pages that returned no ads on a recent pull are skipped (pay-per-result
  // actor); they get re-checked once their last check is >30 days old.
  const now = Date.now();
  const recheckDue = (c: Competitor) =>
    !c.last_checked ||
    now - Date.parse(c.last_checked) >
      RECHECK_NOT_RUNNING_AFTER_DAYS * 86_400_000;
  const pullable = activeCompetitors.filter(
    (c) =>
      c.fb_page_url &&
      isValidFacebookPageUrl(c.fb_page_url) &&
      competitorConfidence(c) >= MIN_COMPETITOR_CONFIDENCE,
  );
  const skippedNotRunning = pullable.filter(
    (c) => c.ad_status === "not_running" && !recheckDue(c),
  );
  if (skippedNotRunning.length > 0) {
    console.log(
      `[creative_selection] skipping ${skippedNotRunning.length} pages marked not_running (re-check after ${RECHECK_NOT_RUNNING_AFTER_DAYS}d): ${skippedNotRunning.map((c) => c.name).join(", ")}`,
    );
  }
  const pageCompetitors = pullable
    .filter((c) => c.ad_status !== "not_running" || recheckDue(c))
    .sort((a, b) => competitorConfidence(b) - competitorConfidence(a))
    .slice(0, MAX_COMPETITOR_PAGE_TARGETS);
  const competitorByTargetValue = new Map(
    pageCompetitors.map((c) => [normalizeTargetValue(c.fb_page_url!), c]),
  );
  const competitorPageTargets: SearchTarget[] = pageCompetitors.map((c) => ({
    kind: "page_url" as const,
    value: c.fb_page_url!,
    rationale: `per-advertiser pull: ${c.name} (${c.source}, confidence ${competitorConfidence(c)})`,
  }));

  // ── 1. Derive keyword discovery targets from the BBM ───────────────────
  console.log(
    `[creative_selection] deriving keyword targets from BBM v${bbmVersion.version} (${competitorPageTargets.length} page pulls queued)…`,
  );
  let targets: SearchTarget[];
  try {
    const derived = await withValidationRetry(SearchTargetsSchema, {
      prompt: loadPrompt("search-deriver", {
        ...promptVars,
        min_targets: MIN_KEYWORD_TARGETS,
        max_targets: MAX_KEYWORD_TARGETS,
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
  // Roster page pulls first (built in code, not prompted), deriver keyword
  // targets after, deduped, keyword count capped separately.
  const seenValues = new Set<string>();
  const merged: SearchTarget[] = [];
  let keywordCount = 0;
  for (const target of [...competitorPageTargets, ...targets]) {
    const key = normalizeTargetValue(target.value);
    if (seenValues.has(key)) continue;
    if (target.kind === "keyword") {
      if (keywordCount >= MAX_KEYWORD_TARGETS) continue;
      keywordCount += 1;
    }
    seenValues.add(key);
    merged.push(target);
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
  // per-target normalized counts, to update competitor ad_status below
  // (null = scrape errored, so the page's status stays unknown)
  const normalizedPerTarget: (number | null)[] = [];
  for (const [i, outcome] of scrapeResults.entries()) {
    const target = targets[i]!;
    const label = `${target.kind}:${target.value}`;
    if (outcome.status === "fulfilled") {
      perUrlCounts[label] = outcome.value.length;
      const normalized = normalizeAds(outcome.value, {
        label,
        onWarning: (message) => warnings.push(message),
      });
      normalizedPerTarget.push(normalized.length);
      allAds.push(...normalized);
    } else {
      perUrlCounts[label] = 0;
      normalizedPerTarget.push(null);
      const message = `scrape failed for ${label}: ${
        outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
      }`;
      warnings.push(message);
      console.warn(`[creative_selection] ${message}`);
    }
  }

  // Record what each page pull found: not_running pages get skipped on
  // future runs until their re-check is due.
  const checkedAt = new Date().toISOString();
  for (const [i, target] of targets.entries()) {
    if (target.kind !== "page_url") continue;
    const competitor = competitorByTargetValue.get(normalizeTargetValue(target.value));
    const normalizedCount = normalizedPerTarget[i];
    if (!competitor || normalizedCount == null) continue;
    const { error: adStatusError } = await supabase
      .from("competitors")
      .update({
        ad_status: normalizedCount > 0 ? "active" : "not_running",
        last_checked: checkedAt,
      })
      .eq("id", competitor.id);
    if (adStatusError) {
      warnings.push(
        `failed to update ad_status for competitor ${competitor.name}: ${adStatusError.message}`,
      );
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
        run_id: runId,
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

  // ── 6. Archive the previous queue — one run per review, never two ──────
  // Prior rows still unreviewed become 'superseded' (hidden by default);
  // reviewed rows (selected/rejected) are untouched. run_id.is.null covers
  // pre-migration rows.
  const { data: supersededRows, error: supersedeError } = await supabase
    .from("ad_candidates")
    .update({ status: "superseded" })
    .eq("client_id", clientId)
    .eq("status", "candidate")
    .or(`run_id.is.null,run_id.neq.${runId}`)
    .select("id");
  if (supersedeError) {
    warnings.push(
      `failed to supersede previous candidates — the review queue may mix runs: ${supersedeError.message}`,
    );
  }
  const supersededCount = supersededRows?.length ?? 0;
  if (supersededCount > 0) {
    console.log(
      `[creative_selection] superseded ${supersededCount} unreviewed candidates from previous runs`,
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
      superseded_previous: supersededCount,
      competitors: {
        on_file: existingCompetitors.length,
        scout_rounds: scoutRounds,
        scouted: scouted.map((s) => ({
          name: s.name,
          fb_page_url: s.fb_page_url ?? null,
          confidence: s.confidence,
        })),
        added: addedCompetitors.map((c) => c.name),
        roster_with_pages: activeWithPages([
          ...existingCompetitors,
          ...addedCompetitors,
        ]),
        page_targets: competitorPageTargets.length,
        skipped_not_running: skippedNotRunning.map((c) => c.name),
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
  const result = await runCreativeSelection(run.client_id, input, {
    supabase,
    runId: run.id,
  });

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
