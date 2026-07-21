// Facebook Ad Library access via curious_coder/facebook-ads-library-scraper
// on Apify. The actor takes Ad Library URLs (keyword searches or facebook
// page URLs), not raw keywords — the pipeline builds the URLs.

import { callActor } from "./apify";
import { mapWithConcurrency, type SettledResult } from "./concurrency";
//
// Input shape verified against the live actor schema via
// `pnpm --filter worker fbads:test`. Real fields: urls (required),
// scrapeAdDetails, limitPerSource (per-URL cap), count (total cap),
// scrapePageAds.{period,activeStatus,sortBy,countryCode}, runTag, proxy.
// buildActorInput/normalizeAds are the only places to touch if the actor's
// schema changes — re-run fbads:test to compare.

export const FB_ADS_ACTOR_ID = "XtaWFhbtfxyzqrFmd";

export function buildAdLibrarySearchUrl(query: string, country: string): string {
  // keyword_unordered loosely matches each word anywhere in the ad and
  // returns junk for multi-word queries (a live test matched aircraft ads
  // for a fitness query) — exact phrase is the only usable multi-word mode.
  const multiWord = query.trim().split(/\s+/).length > 1;
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    q: query,
    search_type: multiWord ? "keyword_exact_phrase" : "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

// The actor rejects runs with "Maximum charged results" below 10 — counts
// under it are clamped up, not passed through (a live --limit=5 smoke test
// failed on this).
export const ACTOR_MIN_CHARGED_RESULTS = 10;

// One actor call per URL keeps result attribution per target and lets a
// single bad URL fail without sinking the batch. With a single URL per call
// the per-source and total caps coincide.
export function buildActorInput(
  url: string,
  { perUrlCount, country }: { perUrlCount: number; country?: string },
) {
  const count = Math.max(perUrlCount, ACTOR_MIN_CHARGED_RESULTS);
  return {
    urls: [{ url }],
    limitPerSource: count,
    count,
    "scrapePageAds.activeStatus": "active",
    // belt-and-suspenders alongside the country baked into the search URL
    ...(country ? { "scrapePageAds.countryCode": country } : {}),
  };
}

export type NormalizedAd = {
  ad_id: string;
  advertiser: string | null;
  ad_url: string;
  media_urls: string[];
  ad_copy: string;
  /** Computed from the ad's start date; null when the actor omits it. */
  days_running: number | null;
  platforms: string[];
  is_active: boolean | null;
  /** Facebook's grouping id — one creative run as many ad ids shares it. */
  collation_id: string | null;
  /** Actor's display format (IMAGE / VIDEO / CAROUSEL / DCO…) when present. */
  display_format: string | null;
  /** The advertiser's Facebook page URL from the ad snapshot, when present —
   * feeds the discovery loop that registers new competitors. */
  page_profile_uri: string | null;
  /** How many scraped near-identical variants this ad survived dedupe for —
   * more variants = more advertiser conviction in the creative. */
  duplicate_count: number;
};

export type RawItem = Record<string, unknown>;

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Ad start dates arrive as unix seconds in the known schema, but guard for
// ms and ISO strings — a wrong unit here silently kills the >=30d filter.
export function computeDaysRunning(startDate: unknown, now = Date.now()): number | null {
  let startMs: number | null = null;
  if (typeof startDate === "number" && Number.isFinite(startDate)) {
    startMs = startDate > 1e12 ? startDate : startDate * 1000;
  } else if (typeof startDate === "string" && startDate) {
    const asNum = Number(startDate);
    if (Number.isFinite(asNum) && asNum > 1e8) {
      startMs = asNum > 1e12 ? asNum : asNum * 1000;
    } else {
      const parsed = Date.parse(startDate);
      if (!Number.isNaN(parsed)) startMs = parsed;
    }
  }
  if (startMs === null) return null;
  const days = Math.floor((now - startMs) / 86_400_000);
  return days >= 0 && days < 10_000 ? days : null;
}

function extractMediaUrls(item: RawItem): string[] {
  const snapshot = (item.snapshot ?? {}) as RawItem;
  const urls: string[] = [];

  const pushIf = (value: unknown) => {
    const url = str(value);
    if (url.startsWith("http")) urls.push(url);
  };

  for (const image of arr(snapshot.images)) {
    pushIf(get(image, ["original_image_url"]));
    pushIf(get(image, ["resized_image_url"]));
  }
  for (const video of arr(snapshot.videos)) {
    pushIf(get(video, ["video_preview_image_url"]));
    pushIf(get(video, ["video_hd_url"]));
    pushIf(get(video, ["video_sd_url"]));
  }
  for (const card of arr(snapshot.cards)) {
    pushIf(get(card, ["original_image_url"]));
    pushIf(get(card, ["resized_image_url"]));
    pushIf(get(card, ["video_preview_image_url"]));
  }
  return [...new Set(urls)];
}

function extractAdCopy(item: RawItem): string {
  const snapshot = (item.snapshot ?? {}) as RawItem;
  const parts = [
    str(get(snapshot, ["title"])),
    str(get(snapshot, ["body", "text"]) ?? get(snapshot, ["body"])),
    str(get(snapshot, ["caption"])),
    str(get(snapshot, ["link_description"])),
    arr(snapshot.cards)
      .map((card) => `${str(get(card, ["title"]))} ${str(get(card, ["body"]))}`.trim())
      .filter(Boolean)
      .join("\n"),
  ].filter(Boolean);
  const cta = str(get(snapshot, ["cta_text"]));
  if (cta) parts.push(`CTA: ${cta}`);
  return truncate(parts.join("\n"), 2500);
}

// Catalog-template ads arrive with unfilled dynamic placeholders like
// {{product.name}} — strip them from the copy, and when the copy is MOSTLY
// placeholders there is no real creative to score.
const DYNAMIC_PLACEHOLDER_RE = /\{\{[^{}]*\}\}/g;

export function placeholderShare(text: string): number {
  if (!text) return 0;
  const matched =
    text.match(DYNAMIC_PLACEHOLDER_RE)?.reduce((sum, m) => sum + m.length, 0) ?? 0;
  return matched / text.length;
}

export function stripDynamicPlaceholders(text: string): string {
  return text
    .replace(DYNAMIC_PLACEHOLDER_RE, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

export function normalizeAd(item: RawItem, now = Date.now()): NormalizedAd | null {
  const adId = str(
    item.ad_archive_id ?? item.adArchiveID ?? item.adArchiveId ?? item.id,
  );
  const advertiser =
    str(item.page_name ?? item.pageName ?? get(item, ["snapshot", "page_name"])) ||
    null;
  const rawCopy = extractAdCopy(item);
  if (rawCopy && placeholderShare(rawCopy) > 0.5) return null;
  const adCopy = stripDynamicPlaceholders(rawCopy);
  const mediaUrls = extractMediaUrls(item);
  // An item with no id AND no content is noise (actor status rows etc.)
  if (!adId && !adCopy && mediaUrls.length === 0) return null;

  const adUrl = adId
    ? `https://www.facebook.com/ads/library/?id=${adId}`
    : str(item.url ?? item.ad_url);

  const platforms = arr(item.publisher_platform ?? item.publisherPlatform)
    .map((p) => str(p))
    .filter(Boolean);

  return {
    ad_id: adId || adUrl,
    advertiser,
    ad_url: adUrl,
    media_urls: mediaUrls,
    ad_copy: adCopy,
    days_running: computeDaysRunning(
      item.start_date ?? item.startDate ?? item.ad_delivery_start_time,
      now,
    ),
    platforms,
    is_active: typeof item.is_active === "boolean" ? item.is_active : null,
    collation_id:
      str(item.collation_id ?? item.collationID ?? item.collationId) || null,
    display_format:
      str(
        get(item, ["snapshot", "display_format"]) ?? item.display_format,
      ).toLowerCase() || null,
    page_profile_uri:
      str(
        get(item, ["snapshot", "page_profile_uri"]) ?? item.page_profile_uri,
      ) || null,
    duplicate_count: 1,
  };
}

// Best-effort creative format for the scorer and the review card — the
// actor's display_format when present, otherwise inferred from media urls.
export function formatHint(ad: NormalizedAd): string {
  if (ad.display_format) return ad.display_format;
  if (ad.media_urls.some((url) => /\.mp4(\?|$)|video/i.test(url))) return "video";
  if (ad.media_urls.length > 2) return "carousel";
  if (ad.media_urls.length > 0) return "static";
  return "unknown";
}

// The actor emits status items instead of ads when a source has nothing to
// return — e.g. { error: "ADS_NOT_FOUND" } for a page running no ads or a
// query matching nothing. These are expected outcomes, not mapping bugs.
export function adErrorCode(item: RawItem): string | null {
  const code = str(item.error ?? item.errorCode ?? item.error_code);
  return code || null;
}

const NO_ADS_CODE = "ADS_NOT_FOUND";

// Only the specific "source has no ads" shapes count as expected: the
// ADS_NOT_FOUND code, or a bare pageInfo status row without an error code.
// Any other actor error (input validation, billing limits, …) must surface
// verbatim — a live "Maximum charged results >= 10" rejection was once
// mislabeled as "page is not running ads".
export function isNoAdsStatus(item: RawItem): boolean {
  const code = adErrorCode(item);
  if (code === NO_ADS_CODE) return true;
  return code === null && "pageInfo" in item;
}

// An item carrying real ad payload is an ad, never a status row — the
// run+poll fallback path returned ad items that ALSO carried a pageInfo
// key (and per-ad error fields under actor saturation), and a key-presence
// classifier discarded whole pages of real ads as "status items".
export function hasAdPayload(item: RawItem): boolean {
  return (
    "snapshot" in item ||
    item.ad_archive_id != null ||
    item.adArchiveID != null ||
    item.adArchiveId != null
  );
}

// The pageInfo status row states the page's own ad status, e.g. "This
// Page is currently running ads" — the negated wording must not match.
export function pageSaysRunningAds(items: RawItem[]): boolean {
  return items.some((item) => {
    const info = item.pageInfo;
    if (info == null) return false;
    const text = JSON.stringify(info);
    return (
      /currently running ads/i.test(text) &&
      !/not\s+currently\s+running/i.test(text)
    );
  });
}

// Actor flakiness observed live (Huel, Simplilearn): ADS_NOT_FOUND while
// the same response's pageInfo says the page IS running ads.
export function isFlakyNoAds(items: RawItem[]): boolean {
  return (
    items.some((item) => adErrorCode(item) === NO_ADS_CODE) &&
    pageSaysRunningAds(items)
  );
}

// Same convention as reddit-tools (the "reddit fix"): count what came in vs
// what survived. Status items get an accurate "no ads" info warning; only a
// genuine everything-lost-to-field-mapping case gets the mismatch warning
// with a raw sample, so the diagnosis in run warnings can be trusted.
export function normalizeAds(
  items: RawItem[],
  { label, onWarning }: { label: string; onWarning?: (message: string) => void },
): NormalizedAd[] {
  // Payload wins: an item with real ad fields is an ad even when it also
  // carries pageInfo or a per-ad error key (the run+poll fallback returns
  // such items — a presence-only classifier once discarded whole pages).
  const isStatus = (item: RawItem) =>
    !hasAdPayload(item) && (adErrorCode(item) !== null || "pageInfo" in item);
  const statusItems = items.filter(isStatus);
  const adItems = items.filter((item) => !isStatus(item));
  const noAdsItems = statusItems.filter(isNoAdsStatus);
  const actorErrors = statusItems.filter((item) => !isNoAdsStatus(item));
  const normalized = adItems
    .map((item) => normalizeAd(item))
    .filter((ad): ad is NormalizedAd => ad !== null);
  console.log(
    `[fb_ads] ${label}: ${items.length} raw → ${normalized.length} normalized${
      statusItems.length > 0 ? ` (${statusItems.length} status items)` : ""
    }`,
  );
  // Tripwire: mostly-status batches from a page that says it IS running
  // ads are a shape bug (or actor flakiness), never "not running ads" —
  // log a raw sample so the actual shape is diagnosable from run warnings.
  const shapeBugSuspected =
    items.length > 0 &&
    statusItems.length / items.length > 0.8 &&
    pageSaysRunningAds(items);
  if (shapeBugSuspected) {
    const message = `fb_ads ${label}: ${statusItems.length}/${items.length} raw items classified as status rows on a page whose pageInfo says ads ARE running — suspected item-shape bug or actor flakiness, NOT "not running ads"; raw sample: ${truncate(JSON.stringify(items[0]), 600)}`;
    console.warn(`[fb_ads] ${message}`);
    onWarning?.(message);
  }
  // Real actor errors surface verbatim, whatever else the batch contained —
  // deduped: saturation once produced dozens of identical per-item errors.
  const errorCounts = new Map<string, number>();
  for (const item of actorErrors) {
    const key = truncate(JSON.stringify(item), 300);
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
  }
  for (const [sample, count] of errorCounts) {
    const message = `fb_ads ${label}: actor error${count > 1 ? ` (x${count})` : ""} — ${sample}`;
    console.warn(`[fb_ads] ${message}`);
    onWarning?.(message);
  }
  if (
    !shapeBugSuspected &&
    normalized.length === 0 &&
    noAdsItems.length > 0 &&
    actorErrors.length === 0
  ) {
    const what = label.startsWith("page_url")
      ? "page is not running ads"
      : "no results for query";
    const message = `fb_ads ${label}: no ads returned (actor reported ${
      noAdsItems.map(adErrorCode).find((code) => code !== null) ??
      "a page status row with no ads"
    }) — ${what}`;
    console.log(`[fb_ads] ${message}`);
    onWarning?.(message);
  } else if (adItems.length > 0 && normalized.length === 0) {
    const message = `fb_ads ${label}: normalized 0 ads from ${adItems.length} raw items — field mapping mismatch; sample raw item: ${truncate(JSON.stringify(adItems[0]), 600)}`;
    console.warn(`[fb_ads] ${message}`);
    onWarning?.(message);
  }
  return normalized;
}

function richness(ad: NormalizedAd): number {
  return ad.media_urls.length + ad.ad_copy.length;
}

// Copy-identity key: lowercased, whitespace-collapsed ad copy. Too-short
// copy is not identifying (every no-copy ad would collapse into one).
function copyKey(ad: NormalizedAd): string | null {
  const normalized = ad.ad_copy.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized.length >= 30 ? normalized : null;
}

// Collapse ads sharing a key, keeping the longest-running instance (richer
// content breaks ties). sumCounts accumulates duplicate_count for true
// variant groups; it is off for exact ad-id repeats (same ad scraped via
// two targets is one ad, not two variants).
function collapse<T extends NormalizedAd>(
  ads: T[],
  keyFn: (ad: T) => string | null,
  { sumCounts }: { sumCounts: boolean },
): T[] {
  const out: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const ad of ads) {
    const key = keyFn(ad);
    if (key === null) {
      out.push(ad);
      continue;
    }
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, out.length);
      out.push(ad);
      continue;
    }
    const current = out[index]!;
    const days = (a: NormalizedAd) => a.days_running ?? -1;
    const survivor =
      days(ad) > days(current) ||
      (days(ad) === days(current) && richness(ad) > richness(current))
        ? ad
        : current;
    out[index] = {
      ...survivor,
      duplicate_count: sumCounts
        ? current.duplicate_count + ad.duplicate_count
        : Math.max(current.duplicate_count, ad.duplicate_count),
    };
  }
  return out;
}

// Facebook runs one creative as many ad_archive_ids: dedupe in three passes
// — exact ad id, then Facebook's own collation_id grouping, then a
// normalized-copy fallback for variants that dodge both. Survivors carry
// duplicate_count (variants = advertiser conviction in that creative).
// Generic so callers that tag ads with extra fields (e.g. format-scan's
// vertical) keep the tags on survivors.
export function dedupeAds<T extends NormalizedAd>(ads: T[]): T[] {
  const byId = collapse(ads, (ad) => ad.ad_id || ad.ad_url, { sumCounts: false });
  const byCollation = collapse(
    byId,
    (ad) => (ad.collation_id ? `col:${ad.collation_id}` : null),
    { sumCounts: true },
  );
  return collapse(byCollation, copyKey, { sumCounts: true });
}

// ── Shared scrape orchestration ──────────────────────────────────────────
// A full format scan launched 90 simultaneous actor runs into the Apify
// account's concurrency/memory caps: 16 sync timeouts + 12 outright fetch
// failures. All Ad Library scraping now goes through this limited pool.

const SCRAPE_CONCURRENCY = 5;
const SCRAPE_RETRY_BACKOFF_MS = 2000;
// undici's generic "fetch failed" plus the usual network-level causes.
const RETRYABLE_NETWORK_RE =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|UND_ERR|other side closed/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ScrapeResult = SettledResult<RawItem[]>;

// Scrapes each URL through the actor with at most SCRAPE_CONCURRENCY runs
// in flight. Retries once (short backoff) on network-level failures and on
// the flaky ADS_NOT_FOUND-while-page-says-running response. Results are
// index-aligned with `urls`, in Promise.allSettled shape.
export async function scrapeAdLibraryUrls(
  urls: string[],
  opts: {
    token: string;
    perUrlCount: number;
    country?: string;
    onRetry?: (url: string, reason: string) => void;
  },
): Promise<ScrapeResult[]> {
  const { token, perUrlCount, country, onRetry } = opts;

  async function scrapeOne(url: string): Promise<RawItem[]> {
    const run = () =>
      callActor<RawItem>(
        FB_ADS_ACTOR_ID,
        buildActorInput(url, { perUrlCount, country }),
        { token },
      );

    let items: RawItem[];
    try {
      items = await run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_NETWORK_RE.test(message)) throw err;
      onRetry?.(url, `network failure, retrying once: ${truncate(message, 200)}`);
      await sleep(SCRAPE_RETRY_BACKOFF_MS);
      items = await run();
    }

    if (isFlakyNoAds(items)) {
      onRetry?.(
        url,
        "actor reported ADS_NOT_FOUND but pageInfo says the page IS running ads — retrying once",
      );
      await sleep(SCRAPE_RETRY_BACKOFF_MS);
      try {
        const retried = await run();
        if (!isFlakyNoAds(retried)) return retried;
      } catch {
        // keep the first response — a flaky no-ads beats a thrown retry
      }
    }
    return items;
  }

  return mapWithConcurrency(urls, SCRAPE_CONCURRENCY, scrapeOne);
}
