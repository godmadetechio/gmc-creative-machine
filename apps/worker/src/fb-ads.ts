// Facebook Ad Library access via curious_coder/facebook-ads-library-scraper
// on Apify. The actor takes Ad Library URLs (keyword searches or facebook
// page URLs), not raw keywords — the pipeline builds the URLs.
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

// One actor call per URL keeps result attribution per target and lets a
// single bad URL fail without sinking the batch. With a single URL per call
// the per-source and total caps coincide.
export function buildActorInput(
  url: string,
  { perUrlCount, country }: { perUrlCount: number; country?: string },
) {
  return {
    urls: [{ url }],
    limitPerSource: perUrlCount,
    count: perUrlCount,
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
  /** How many scraped near-identical variants this ad survived dedupe for —
   * more variants = more advertiser conviction in the creative. */
  duplicate_count: number;
};

type RawItem = Record<string, unknown>;

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

// Same convention as reddit-tools (the "reddit fix"): count what came in vs
// what survived. Status items get an accurate "no ads" info warning; only a
// genuine everything-lost-to-field-mapping case gets the mismatch warning
// with a raw sample, so the diagnosis in run warnings can be trusted.
export function normalizeAds(
  items: RawItem[],
  { label, onWarning }: { label: string; onWarning?: (message: string) => void },
): NormalizedAd[] {
  const statusItems = items.filter((item) => adErrorCode(item) !== null);
  const adItems = items.filter((item) => adErrorCode(item) === null);
  const normalized = adItems
    .map((item) => normalizeAd(item))
    .filter((ad): ad is NormalizedAd => ad !== null);
  console.log(
    `[fb_ads] ${label}: ${items.length} raw → ${normalized.length} normalized${
      statusItems.length > 0 ? ` (${statusItems.length} status items)` : ""
    }`,
  );
  if (normalized.length === 0 && statusItems.length > 0) {
    const what = label.startsWith("page_url")
      ? "page is not running ads"
      : "no results for query";
    const message = `fb_ads ${label}: no ads returned (actor reported ${adErrorCode(statusItems[0]!)}) — ${what}`;
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
function collapse(
  ads: NormalizedAd[],
  keyFn: (ad: NormalizedAd) => string | null,
  { sumCounts }: { sumCounts: boolean },
): NormalizedAd[] {
  const out: NormalizedAd[] = [];
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
export function dedupeAds(ads: NormalizedAd[]): NormalizedAd[] {
  const byId = collapse(ads, (ad) => ad.ad_id || ad.ad_url, { sumCounts: false });
  const byCollation = collapse(
    byId,
    (ad) => (ad.collation_id ? `col:${ad.collation_id}` : null),
    { sumCounts: true },
  );
  return collapse(byCollation, copyKey, { sumCounts: true });
}
