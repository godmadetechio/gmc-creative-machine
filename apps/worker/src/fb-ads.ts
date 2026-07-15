// Facebook Ad Library access via curious_coder/facebook-ads-library-scraper
// on Apify. The actor takes Ad Library URLs (keyword searches or facebook
// page URLs), not raw keywords — the pipeline builds the URLs.
//
// The input shape below is the actor's documented schema; run
// `pnpm --filter worker fbads:test` against a real APIFY_TOKEN to print the
// live input schema and a raw sample item (this sandbox cannot reach
// api.apify.com). buildActorInput/normalizeAds are the only places to touch
// if the live schema differs.

export const FB_ADS_ACTOR_ID = "XtaWFhbtfxyzqrFmd";

export function buildAdLibrarySearchUrl(query: string, country: string): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    q: query,
    search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

// One actor call per URL keeps result attribution per target and lets a
// single bad URL fail without sinking the batch.
export function buildActorInput(url: string, { perUrlCount }: { perUrlCount: number }) {
  return {
    urls: [{ url }],
    count: perUrlCount,
    "scrapePageAds.activeStatus": "active",
    period: "",
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

export function normalizeAd(item: RawItem, now = Date.now()): NormalizedAd | null {
  const adId = str(
    item.ad_archive_id ?? item.adArchiveID ?? item.adArchiveId ?? item.id,
  );
  const advertiser =
    str(item.page_name ?? item.pageName ?? get(item, ["snapshot", "page_name"])) ||
    null;
  const adCopy = extractAdCopy(item);
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
  };
}

// Same convention as reddit-tools (the "reddit fix"): count what came in vs
// what survived, and if everything was lost to field mapping, surface a raw
// sample so the mismatch is diagnosable from run warnings alone.
export function normalizeAds(
  items: RawItem[],
  { label, onWarning }: { label: string; onWarning?: (message: string) => void },
): NormalizedAd[] {
  const normalized = items
    .map((item) => normalizeAd(item))
    .filter((ad): ad is NormalizedAd => ad !== null);
  console.log(`[fb_ads] ${label}: ${items.length} raw → ${normalized.length} normalized`);
  if (items.length > 0 && normalized.length === 0) {
    const message = `fb_ads ${label}: normalized 0 ads from ${items.length} raw items — field mapping mismatch; sample raw item: ${truncate(JSON.stringify(items[0]), 600)}`;
    console.warn(`[fb_ads] ${message}`);
    onWarning?.(message);
  }
  return normalized;
}

export function dedupeAds(ads: NormalizedAd[]): NormalizedAd[] {
  const seen = new Map<string, NormalizedAd>();
  for (const ad of ads) {
    const key = ad.ad_id || ad.ad_url;
    const existing = seen.get(key);
    // keep the richer duplicate (more copy/media usually means a fuller item)
    if (
      !existing ||
      ad.media_urls.length + ad.ad_copy.length >
        existing.media_urls.length + existing.ad_copy.length
    ) {
      seen.set(key, ad);
    }
  }
  return [...seen.values()];
}
