import "../env";
import { callActor, getApifyToken } from "../apify";
import {
  buildSearchInput,
  normalizeItems,
  summarizeRawItems,
  REDDIT_ACTOR_ID,
} from "../reddit-tools";

// pnpm --filter worker reddit:test ["query"] [subreddit]
// Live unit-level check of the reddit_research search path: same input
// builder + normalizer the tool uses, against the real actor. Exits 1 if
// normalization yields no posts, printing raw vs normalized for diagnosis.

const query = process.argv[2] ?? "tried everything can't lose weight busy work schedule";
const subreddit = process.argv[3];

async function main() {
  const token = getApifyToken();
  if (!token) throw new Error("APIFY_TOKEN not set — configure root .env.local");

  const input = buildSearchInput({
    query,
    subreddit,
    maxPosts: 5,
    maxCommentsPerPost: 5,
  });
  console.log(`[reddit:test] actor ${REDDIT_ACTOR_ID}, input:`, JSON.stringify(input, null, 2));

  const items = await callActor<Record<string, unknown>>(REDDIT_ACTOR_ID, input, {
    token,
  });
  console.log(`[reddit:test] ${summarizeRawItems(items)}`);
  if (items.length > 0) {
    console.log(
      `[reddit:test] sample raw item:`,
      JSON.stringify(items[0], null, 2).slice(0, 1500),
    );
  }

  const posts = normalizeItems(items, { maxPosts: 5, maxCommentsPerPost: 5 });
  const nested = posts.reduce((sum, p) => sum + p.comments.length, 0);
  console.log(
    `[reddit:test] normalized: ${posts.length} posts, ${nested} nested comments`,
  );
  console.log(JSON.stringify(posts, null, 2).slice(0, 3000));

  if (posts.length === 0) {
    console.error(
      `[reddit:test] FAILED — ${items.length} raw items normalized to 0 posts. Compare the sample raw item above against normalizeItems/itemKind in src/reddit-tools.ts.`,
    );
    process.exit(1);
  }
  console.log(`[reddit:test] PASS — non-empty normalized posts`);
}

main().catch((err) => {
  console.error(`[reddit:test] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
