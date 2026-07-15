import "../env";
import { callActor, getApifyToken } from "../apify";
import {
  FB_ADS_ACTOR_ID,
  buildActorInput,
  buildAdLibrarySearchUrl,
  dedupeAds,
  normalizeAds,
} from "../fb-ads";

// pnpm --filter worker fbads:test ["query"] [country] [--scrape]
// Live check of the Facebook Ad Library actor:
//   1. Fetches the actor's REAL input schema from the Apify API and prints
//      its properties — compare against buildActorInput in src/fb-ads.ts.
//   2. With --scrape, runs one small paid scrape and prints raw item keys
//      vs the normalized output (same normalizer the pipeline uses).
// Schema fetch alone is free; --scrape bills per result (~10 results).

const args = process.argv.slice(2).filter((a) => a !== "--scrape");
const doScrape = process.argv.includes("--scrape");
const query = args[0] ?? "online personal training";
const country = (args[1] ?? "US").toUpperCase();

async function main() {
  const token = getApifyToken();
  if (!token) throw new Error("APIFY_TOKEN not set — configure root .env.local");

  // ── 1. Real input schema ──────────────────────────────────────────────
  const res = await fetch(
    `https://api.apify.com/v2/acts/${FB_ADS_ACTOR_ID}?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch actor metadata: ${res.status} ${await res.text()}`);
  }
  const actor = (await res.json()) as {
    data: {
      name: string;
      username: string;
      defaultRunOptions?: unknown;
      versions?: { versionNumber: string; sourceType: string }[];
      exampleRunInput?: { body?: string };
      inputSchema?: unknown;
    };
  };
  console.log(`[fbads:test] actor: ${actor.data.username}/${actor.data.name}`);

  // The input schema lives on the actor's default build.
  const buildRes = await fetch(
    `https://api.apify.com/v2/acts/${FB_ADS_ACTOR_ID}/builds/default?token=${encodeURIComponent(token)}`,
  );
  if (buildRes.ok) {
    const build = (await buildRes.json()) as {
      data?: { inputSchema?: string };
    };
    if (build.data?.inputSchema) {
      const schema = JSON.parse(build.data.inputSchema) as {
        properties?: Record<string, { type?: string; title?: string; description?: string }>;
        required?: string[];
      };
      console.log(`[fbads:test] REAL input schema properties:`);
      for (const [key, prop] of Object.entries(schema.properties ?? {})) {
        console.log(
          `[fbads:test]   ${key} (${prop.type ?? "?"})${schema.required?.includes(key) ? " REQUIRED" : ""}: ${(prop.title ?? prop.description ?? "").slice(0, 100)}`,
        );
      }
    } else {
      console.warn(`[fbads:test] default build has no inputSchema field`);
    }
  } else {
    console.warn(`[fbads:test] could not fetch default build: ${buildRes.status}`);
  }
  if (actor.data.exampleRunInput?.body) {
    console.log(
      `[fbads:test] example run input:`,
      actor.data.exampleRunInput.body.slice(0, 800),
    );
  }

  const url = buildAdLibrarySearchUrl(query, country);
  const input = buildActorInput(url, { perUrlCount: 10, country });
  console.log(`[fbads:test] our input builder produces:`, JSON.stringify(input, null, 2));
  console.log(
    `[fbads:test] compare the two above — if fields differ, fix buildActorInput in src/fb-ads.ts`,
  );

  if (!doScrape) {
    console.log(`[fbads:test] schema check done. Re-run with --scrape for a live paid scrape.`);
    return;
  }

  // ── 2. Small live scrape ──────────────────────────────────────────────
  console.log(`[fbads:test] scraping (paid): ${url}`);
  const items = await callActor<Record<string, unknown>>(FB_ADS_ACTOR_ID, input, {
    token,
  });
  console.log(`[fbads:test] ${items.length} raw items`);
  if (items.length > 0) {
    console.log(`[fbads:test] raw item keys: ${Object.keys(items[0]!).join(", ")}`);
    console.log(
      `[fbads:test] sample raw item:`,
      JSON.stringify(items[0], null, 2).slice(0, 2000),
    );
  }

  const ads = dedupeAds(
    normalizeAds(items, {
      label: `keyword:${query}`,
      onWarning: (message) => console.warn(`[fbads:test] WARNING: ${message}`),
    }),
  );
  for (const ad of ads.slice(0, 10)) {
    const variants = ad.duplicate_count > 1 ? ` | ${ad.duplicate_count} variants` : "";
    console.log(
      `[fbads:test]   ${ad.advertiser ?? "?"} | ${ad.days_running ?? "?"}d${variants} | ${ad.media_urls.length} media | ${ad.ad_copy.slice(0, 80).replace(/\n/g, " ")}`,
    );
  }

  if (items.length > 0 && ads.length === 0) {
    console.error(
      `[fbads:test] FAILED — ${items.length} raw items normalized to 0 ads. Compare the sample raw item above against normalizeAd in src/fb-ads.ts.`,
    );
    process.exit(1);
  }
  const withDays = ads.filter((ad) => ad.days_running !== null).length;
  console.log(
    `[fbads:test] PASS — ${ads.length} normalized ads (${withDays} with days_running)`,
  );
}

main().catch((err) => {
  console.error(`[fbads:test] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
