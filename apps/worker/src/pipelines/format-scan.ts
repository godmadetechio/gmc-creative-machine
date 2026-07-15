import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FormatExtractorOutputSchema,
  FormatLibraryEntrySchema,
  FormatScanInputSchema,
  FormatSeedAdvertiserSchema,
  type FormatExampleAd,
  type FormatLibraryEntry,
  type FormatScanInput,
  type SeedVertical,
} from "@gmc/shared";
import { withValidationRetry } from "../agent";
import { callActor, getApifyToken } from "../apify";
import { CostTracker } from "../cost";
import {
  FB_ADS_ACTOR_ID,
  buildActorInput,
  dedupeAds,
  formatHint,
  normalizeAds,
  type NormalizedAd,
} from "../fb-ads";
import { seedLibraryIfEmpty } from "../format-library";
import { loadPrompt } from "../prompts";
import type { PipelineHandler } from "./index";

// FORMAT SCAN — a GLOBAL run (runs.client_id null) that maintains the
// agency-level format_library (AI_ADS_TRAINING_INTEGRATION.md §2a): scrape
// the seed advertisers, then a format-extractor agent confirms existing
// formats and proposes new ones. The agent returns a DELTA; the merge and
// fading are applied in code so the library can never be mutated by a
// hallucination.

// "ad longevity is the filter" — same threshold as creative selection.
const PREFERRED_MIN_DAYS_RUNNING = 30;
// Extractor corpus caps: the agent stage is per vertical, and copy is
// truncated so 5 calls stay token-safe.
const MAX_CORPUS_PER_VERTICAL = 120;
const MAX_PER_ADVERTISER_IN_CORPUS = 8;
const COPY_TRUNCATE_CHARS = 400;
const MAX_NEW_FORMATS_PER_VERTICAL = 8;
// Example ads kept per library entry (freshest first).
const MAX_EXAMPLES_PER_FORMAT = 8;
const EXAMPLE_SNIPPET_CHARS = 200;
// A format unseen for this many consecutive scans turns 'fading'.
const FADE_AFTER_MISSED = 2;
// The fading pass only runs when at least this share of advertisers
// scraped successfully — an Apify outage must not fade the library.
const MIN_HEALTHY_ADVERTISER_SHARE = 0.5;
// Concurrent Apify actor runs per batch (plan concurrency limits).
const SCRAPE_CONCURRENCY = 15;

export type FormatScanResult = {
  costUsd: number;
  formatsConfirmed: number;
  newFormats: string[];
  warnings: string[];
  output: Record<string, unknown>;
};

type TaggedAd = NormalizedAd & { vertical: SeedVertical };

function extractorAdPayload(ad: TaggedAd) {
  return {
    ad_id: ad.ad_id,
    advertiser: ad.advertiser,
    copy: ad.ad_copy
      ? ad.ad_copy.slice(0, COPY_TRUNCATE_CHARS)
      : "(no ad copy captured)",
    days_running: ad.days_running,
    format_hint: formatHint(ad),
    variant_count: ad.duplicate_count,
  };
}

// The compact library view the extractor sees (ids + the format identity;
// examples are omitted — they are output, not matching input).
function libraryPromptPayload(entries: FormatLibraryEntry[]) {
  return entries.map((f) => ({
    format_id: f.id,
    name: f.name,
    description: f.description,
    psychology: f.psychology,
    skeleton: f.skeleton,
  }));
}

function buildExample(ad: TaggedAd): FormatExampleAd {
  return {
    advertiser: ad.advertiser,
    ad_url: ad.ad_url,
    copy_snippet: ad.ad_copy.slice(0, EXAMPLE_SNIPPET_CHARS),
    vertical: ad.vertical,
    days_running: ad.days_running,
  };
}

// Prepend fresh examples, dedupe by ad_url, cap.
function mergeExamples(
  fresh: FormatExampleAd[],
  existing: FormatExampleAd[],
): FormatExampleAd[] {
  const seen = new Set<string>();
  const merged: FormatExampleAd[] = [];
  for (const example of [...fresh, ...existing]) {
    if (seen.has(example.ad_url)) continue;
    seen.add(example.ad_url);
    merged.push(example);
    if (merged.length >= MAX_EXAMPLES_PER_FORMAT) break;
  }
  return merged;
}

export async function runFormatScan(
  input: FormatScanInput,
  deps: { supabase: SupabaseClient; runId: string },
): Promise<FormatScanResult> {
  const { supabase } = deps;
  const cost = new CostTracker();
  const warnings: string[] = [];
  const validationWarner = (name: string) => (issues: string, attempt: number) =>
    warnings.push(
      `${name} output failed validation (attempt ${attempt}): ${
        issues.length > 300 ? `${issues.slice(0, 300)}…` : issues
      }`,
    );

  const apifyToken = getApifyToken();
  if (!apifyToken) {
    throw new Error(
      "APIFY_TOKEN is not set — the format scan IS the Facebook Ad Library scrape.",
    );
  }

  // ── 0. Seed the library from static-frameworks.md on first ever scan ────
  const seededFormats = await seedLibraryIfEmpty(supabase);
  if (seededFormats > 0) {
    console.log(
      `[format_scan] seeded format_library with ${seededFormats} formats from static-frameworks.md`,
    );
  }

  // ── 1. Load active seed advertisers ─────────────────────────────────────
  let advertiserQuery = supabase
    .from("format_seed_advertisers")
    .select("*")
    .eq("status", "active")
    .order("vertical")
    .order("name");
  if (input.vertical) {
    advertiserQuery = advertiserQuery.eq("vertical", input.vertical);
  }
  const { data: advertiserRows, error: advertiserError } = await advertiserQuery;
  if (advertiserError) {
    throw new Error(`Failed to load seed advertisers: ${advertiserError.message}`);
  }
  const advertisers = (advertiserRows ?? []).map((row) =>
    FormatSeedAdvertiserSchema.parse(row),
  );
  if (advertisers.length === 0) {
    throw new Error(
      `No active seed advertisers${input.vertical ? ` for vertical '${input.vertical}'` : ""} — seed format_seed_advertisers first.`,
    );
  }

  // ── 2. Scrape each advertiser's page (pay-per-result actor) ─────────────
  // Chunked so a full 50-advertiser scan doesn't fire 50 simultaneous actor
  // runs into an Apify plan's concurrency limit.
  console.log(
    `[format_scan] scraping ${advertisers.length} seed advertisers (limit ${input.limit_per_advertiser} each, country ${input.country})…`,
  );
  const scrapeResults: PromiseSettledResult<Record<string, unknown>[]>[] = [];
  for (let i = 0; i < advertisers.length; i += SCRAPE_CONCURRENCY) {
    const chunk = advertisers.slice(i, i + SCRAPE_CONCURRENCY);
    scrapeResults.push(
      ...(await Promise.allSettled(
        chunk.map((advertiser) =>
          callActor<Record<string, unknown>>(
            FB_ADS_ACTOR_ID,
            buildActorInput(advertiser.fb_page_url, {
              perUrlCount: input.limit_per_advertiser,
              country: input.country,
            }),
            { token: apifyToken },
          ),
        ),
      )),
    );
  }

  const perAdvertiserCounts: Record<string, number | null> = {};
  const allAds: TaggedAd[] = [];
  let successfulAdvertisers = 0;
  for (const [i, outcome] of scrapeResults.entries()) {
    const advertiser = advertisers[i]!;
    if (outcome.status === "fulfilled") {
      successfulAdvertisers += 1;
      const normalized = normalizeAds(outcome.value, {
        // "page_url:" prefix — normalizeAds keys its zero-result diagnosis
        // ("page is not running ads" vs "no results for query") off it.
        label: `page_url:${advertiser.name}`,
        onWarning: (message) => warnings.push(message),
      });
      perAdvertiserCounts[advertiser.name] = normalized.length;
      console.log(
        `[format_scan] ${advertiser.name} (${advertiser.vertical}): ${outcome.value.length} raw → ${normalized.length} normalized`,
      );
      allAds.push(
        ...normalized.map((ad) => ({ ...ad, vertical: advertiser.vertical })),
      );
    } else {
      perAdvertiserCounts[advertiser.name] = null;
      const message = `scrape failed for ${advertiser.name}: ${
        outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
      }`;
      warnings.push(message);
      console.warn(`[format_scan] ${message}`);
    }
  }
  const scrapedRaw = scrapeResults.reduce(
    (sum, r) => sum + (r.status === "fulfilled" ? r.value.length : 0),
    0,
  );
  if (allAds.length === 0) {
    throw Object.assign(
      new Error(
        `Ad Library scrape produced 0 usable ads across ${advertisers.length} seed advertisers — ${warnings.join(" | ") || "no warnings captured"}`,
      ),
      { costUsd: cost.total },
    );
  }

  // ── 3. Dedupe globally, then build per-vertical corpora ─────────────────
  // dedupeAds is generic: survivors keep their own vertical tag.
  const deduped = dedupeAds(allAds);

  const byVertical = new Map<SeedVertical, TaggedAd[]>();
  for (const ad of deduped) {
    const list = byVertical.get(ad.vertical) ?? [];
    list.push(ad);
    byVertical.set(ad.vertical, list);
  }

  const adById = new Map<string, TaggedAd>();
  const corpusByVertical = new Map<SeedVertical, TaggedAd[]>();
  for (const [vertical, ads] of byVertical) {
    // Long-runners first — proven ads should anchor the format evidence.
    const ranked = [...ads].sort((a, b) => {
      const aPreferred = (a.days_running ?? -1) >= PREFERRED_MIN_DAYS_RUNNING;
      const bPreferred = (b.days_running ?? -1) >= PREFERRED_MIN_DAYS_RUNNING;
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      return (b.days_running ?? -1) - (a.days_running ?? -1);
    });
    const perAdvertiser = new Map<string, number>();
    const corpus: TaggedAd[] = [];
    for (const ad of ranked) {
      const key = (ad.advertiser ?? ad.ad_id).trim().toLowerCase();
      const count = perAdvertiser.get(key) ?? 0;
      if (count >= MAX_PER_ADVERTISER_IN_CORPUS) continue;
      perAdvertiser.set(key, count + 1);
      corpus.push(ad);
      adById.set(ad.ad_id, ad);
      if (corpus.length >= MAX_CORPUS_PER_VERTICAL) break;
    }
    corpusByVertical.set(vertical, corpus);
  }
  console.log(
    `[format_scan] ${scrapedRaw} raw → ${deduped.length} deduped → corpora: ${[...corpusByVertical]
      .map(([v, ads]) => `${v}=${ads.length}`)
      .join(", ")}`,
  );

  // ── 4. Format extraction per vertical (sequential on purpose) ───────────
  // Each call sees the library as updated by the previous vertical, so two
  // verticals cannot both "discover" the same new format.
  const confirmedThisScan = new Set<string>();
  const newFormatNames: string[] = [];
  const confirmationsByVertical: Record<string, number> = {};
  const failedVerticals: string[] = [];

  for (const [vertical, corpus] of corpusByVertical) {
    if (corpus.length === 0) continue;
    const label = `format-extractor-${vertical}`;

    const { data: libraryRows, error: libraryError } = await supabase
      .from("format_library")
      .select("*")
      .in("status", ["active", "fading"]);
    if (libraryError) {
      throw Object.assign(
        new Error(`Failed to load format_library: ${libraryError.message}`),
        { costUsd: cost.total },
      );
    }
    const library = (libraryRows ?? []).map((row) =>
      FormatLibraryEntrySchema.parse(row),
    );
    const libraryById = new Map(library.map((f) => [f.id, f]));
    const libraryByName = new Map(
      library.map((f) => [f.name.trim().toLowerCase(), f]),
    );

    console.log(
      `[format_scan] extracting formats from ${corpus.length} ${vertical} ads against ${library.length} library entries…`,
    );
    let extraction;
    try {
      extraction = await withValidationRetry(FormatExtractorOutputSchema, {
        prompt: loadPrompt("format-extractor", {
          vertical,
          library_json: JSON.stringify(libraryPromptPayload(library), null, 2),
          ads_json: corpus
            .map((ad) => JSON.stringify(extractorAdPayload(ad)))
            .join("\n"),
          max_new_formats: MAX_NEW_FORMATS_PER_VERTICAL,
        }),
        tools: [], // pure pattern recognition, no web access
        maxTurns: 8,
        label,
        onValidationError: validationWarner(label),
      });
      cost.add(label, extraction.costUsd, extraction.usage);
    } catch (err) {
      // One bad vertical must not sink the scan (and must not fade formats
      // it failed to look at — the fading pass below only counts a miss
      // against formats when the extractor for their evidence actually ran;
      // a failed vertical simply contributes no confirmations).
      cost.addFromError(label, err);
      failedVerticals.push(vertical);
      const message = `${label} failed (${corpus.length} ads unused): ${
        err instanceof Error ? err.message : err
      }`;
      warnings.push(message);
      console.warn(`[format_scan] ${message}`);
      continue;
    }

    const now = new Date().toISOString();
    // Resolve example ids against the real corpus — unknown ids are dropped.
    const resolveExamples = (ids: string[], context: string): FormatExampleAd[] => {
      const examples: FormatExampleAd[] = [];
      for (const id of ids) {
        const ad = adById.get(id);
        if (!ad) {
          warnings.push(`${label} referenced unknown ad_id "${id}" in ${context} — ignored`);
          continue;
        }
        examples.push(buildExample(ad));
      }
      return examples;
    };

    // 4a. Confirmations → freshness + examples + vertical coverage.
    // New formats whose name already exists become confirmations too.
    // Coalesced by format_id: the agent may repeat an id (or the collision
    // branch may re-add one), and two updates for the same row would merge
    // against the same stale snapshot — the second clobbering the first.
    const exampleIdsByFormat = new Map<string, string[]>();
    const addConfirmation = (formatId: string, exampleAdIds: string[]) => {
      const ids = exampleIdsByFormat.get(formatId) ?? [];
      for (const id of exampleAdIds) {
        if (!ids.includes(id)) ids.push(id);
      }
      exampleIdsByFormat.set(formatId, ids);
    };
    for (const confirmation of extraction.data.confirmations) {
      addConfirmation(confirmation.format_id, confirmation.example_ad_ids);
    }
    const genuinelyNew = [];
    for (const proposed of extraction.data.new_formats) {
      const existing = libraryByName.get(proposed.name.trim().toLowerCase());
      if (existing) {
        warnings.push(
          `${label} proposed "${proposed.name}" as new but it already exists — treated as a confirmation`,
        );
        addConfirmation(existing.id, proposed.example_ad_ids.slice(0, 3));
      } else {
        genuinelyNew.push(proposed);
      }
    }

    let confirmedCount = 0;
    for (const [formatId, exampleAdIds] of exampleIdsByFormat) {
      const entry = libraryById.get(formatId);
      if (!entry) {
        warnings.push(
          `${label} returned unknown format_id "${formatId}" — ignored`,
        );
        continue;
      }
      const examples = resolveExamples(
        exampleAdIds,
        `confirmation of "${entry.name}"`,
      );
      // Verticals accrue only from cited example ads — an extractor claim
      // without evidence must not brand a format as proven in a vertical.
      const verticalsSeen = [
        ...new Set([...entry.verticals_seen, ...examples.map((e) => e.vertical)]),
      ];
      const { error: updateError } = await supabase
        .from("format_library")
        .update({
          status: "active", // a fading format seen again comes back
          scans_missed: 0,
          last_confirmed: now,
          verticals_seen: verticalsSeen,
          example_ads: mergeExamples(examples, entry.example_ads),
        })
        .eq("id", entry.id);
      if (updateError) {
        warnings.push(
          `failed to confirm format "${entry.name}": ${updateError.message}`,
        );
        continue;
      }
      confirmedThisScan.add(entry.id);
      confirmedCount += 1;
    }
    confirmationsByVertical[vertical] = confirmedCount;

    // 4b. Genuinely new formats.
    for (const proposed of genuinelyNew) {
      const examples = resolveExamples(
        proposed.example_ad_ids,
        `new format "${proposed.name}"`,
      );
      if (examples.length < 2) {
        warnings.push(
          `${label} proposed "${proposed.name}" but fewer than 2 example ads resolved — skipped`,
        );
        continue;
      }
      const { data: insertedRow, error: insertError } = await supabase
        .from("format_library")
        .insert({
          name: proposed.name.trim(),
          description: proposed.description,
          psychology: proposed.psychology,
          skeleton: proposed.skeleton,
          status: "active",
          // from the cited examples, not the scan's vertical label
          verticals_seen: [...new Set(examples.map((e) => e.vertical))],
          example_ads: examples.slice(0, MAX_EXAMPLES_PER_FORMAT),
          last_confirmed: now,
        })
        .select("id")
        .maybeSingle();
      if (insertError) {
        warnings.push(
          `failed to insert new format "${proposed.name}": ${insertError.message}`,
        );
        continue;
      }
      if (insertedRow?.id) confirmedThisScan.add(insertedRow.id as string);
      newFormatNames.push(proposed.name.trim());
      console.log(`[format_scan] new format discovered (${vertical}): ${proposed.name}`);
    }
  }

  // ── 5. Fading pass ───────────────────────────────────────────────────────
  // Only on a full, healthy scan: a vertical-restricted smoke test or a
  // mostly-failed scrape says nothing about formats it never looked for.
  // A vertical whose advertisers all failed or returned zero ads was never
  // looked at either — its formats must not be penalized.
  const emptyVerticals = [
    ...new Set(advertisers.map((a) => a.vertical)),
  ].filter((v) => (corpusByVertical.get(v)?.length ?? 0) === 0);
  const healthy =
    successfulAdvertisers / advertisers.length >= MIN_HEALTHY_ADVERTISER_SHARE &&
    failedVerticals.length === 0 &&
    emptyVerticals.length === 0;
  const fadedNames: string[] = [];
  if (input.vertical) {
    console.log("[format_scan] vertical-restricted scan — fading pass skipped");
  } else if (!healthy) {
    warnings.push(
      `fading pass skipped: unhealthy scan (${successfulAdvertisers}/${advertisers.length} advertisers scraped, ${failedVerticals.length} extractor failure(s), ${emptyVerticals.length} vertical(s) with no ads)`,
    );
  } else {
    const { data: unseenRows, error: unseenError } = await supabase
      .from("format_library")
      .select("*")
      .in("status", ["active", "fading"]);
    if (unseenError) {
      warnings.push(`fading pass failed to read library: ${unseenError.message}`);
    } else {
      const unseen = (unseenRows ?? [])
        .map((row) => FormatLibraryEntrySchema.parse(row))
        // Exempt from fading: never-confirmed entries (a scan that cannot
        // see a format is not evidence of its death) and 'visual' formats
        // — the text-only extractor structurally cannot confirm those, so
        // they stay active until manually archived or a future vision
        // pass can confirm them.
        .filter(
          (f) =>
            !confirmedThisScan.has(f.id) &&
            f.last_confirmed !== null &&
            f.detection !== "visual",
        );
      for (const entry of unseen) {
        const missed = entry.scans_missed + 1;
        const fades = missed >= FADE_AFTER_MISSED;
        const { error: fadeError } = await supabase
          .from("format_library")
          .update({
            scans_missed: missed,
            ...(fades ? { status: "fading" } : {}),
          })
          .eq("id", entry.id);
        if (fadeError) {
          warnings.push(`failed to update scans_missed for "${entry.name}": ${fadeError.message}`);
          continue;
        }
        if (fades && entry.status !== "fading") {
          fadedNames.push(entry.name);
          console.log(`[format_scan] format fading (unseen ${missed} scans): ${entry.name}`);
        }
      }
    }
  }

  return {
    costUsd: Number(cost.total.toFixed(4)),
    formatsConfirmed: confirmedThisScan.size,
    newFormats: newFormatNames,
    warnings,
    output: {
      seeded_formats: seededFormats,
      advertisers_total: advertisers.length,
      advertisers_scraped: successfulAdvertisers,
      scraped_raw: scrapedRaw,
      after_dedupe: deduped.length,
      corpus_per_vertical: Object.fromEntries(
        [...corpusByVertical].map(([v, ads]) => [v, ads.length]),
      ),
      confirmations_per_vertical: confirmationsByVertical,
      formats_confirmed: confirmedThisScan.size,
      new_formats: newFormatNames,
      faded: fadedNames,
      failed_verticals: failedVerticals,
      vertical: input.vertical ?? null,
      per_advertiser_counts: perAdvertiserCounts,
      apify: {
        actor: FB_ADS_ACTOR_ID,
        note: `pay-per-result actor: ${scrapedRaw} results scraped across ${advertisers.length} advertiser page(s); Apify billing is per result and is not included in cost_usd`,
      },
      warnings,
      usage: cost.usage,
    },
  };
}

export const formatScanHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = FormatScanInputSchema.parse(run.input_json ?? {});
  const result = await runFormatScan(input, { supabase, runId: run.id });

  const { error } = await supabase
    .from("runs")
    .update({
      // Library writes are already applied and the Formats tab is the
      // review surface — nothing pends, so the run is 'approved', not
      // 'needs_review'.
      status: "approved",
      output_json: result.output,
      cost_usd: result.costUsd,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) {
    throw new Error(
      `format library updated, but failed to update run: ${error.message}`,
    );
  }

  console.log(
    `[format_scan] done — ${result.formatsConfirmed} formats confirmed, ${result.newFormats.length} new, cost $${result.costUsd}`,
  );
};
