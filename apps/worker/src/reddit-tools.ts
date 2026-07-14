import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { callActor } from "./apify";

// Reddit access goes through trudax/reddit-scraper-lite on Apify
// (pay-per-result, no login) — Reddit blocks all unauthenticated fetches.
export const REDDIT_ACTOR_ID = "oAuCIx3ItNrs2okjQ";

export const REDDIT_TOOL_NAMES = ["mcp__reddit__reddit_research"];

export type RedditComment = {
  body: string;
  upvotes: number;
  url: string;
};

export type RedditPost = {
  title: string | null;
  body: string;
  url: string;
  subreddit: string;
  upvotes: number;
  num_comments: number;
  created_at: string;
  comments: RedditComment[];
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type RawItem = Record<string, unknown>;

// Classify by dataType when recognized, by shape otherwise. NEVER silently
// drop an unknown dataType that carries text — that is exactly how the v5
// run lost 16 real items to a mapping mismatch.
export function itemKind(item: RawItem): "post" | "comment" | "other" {
  const dataType = str(item.dataType).toLowerCase();
  if (dataType === "post") return "post";
  if (dataType === "comment") return "comment";
  if (dataType === "community" || dataType === "user") return "other";
  // unknown or missing dataType — fall back to shape
  if (str(item.title)) return "post";
  if (str(item.body ?? item.text ?? item.selftext)) return "comment";
  return "other";
}

// The actor returns permalinks as RELATIVE paths (/r/sub/comments/…) —
// passed through raw they fail FindingSchema's url() check and every
// finding built on them dies in validation. Absolutize at the source.
export function absolutizeRedditUrl(url: string): string {
  if (!url || /^https?:\/\//i.test(url)) return url;
  return url.startsWith("/")
    ? `https://www.reddit.com${url}`
    : `https://www.reddit.com/${url}`;
}

// The actor returns a flat list of post and comment items; comments are
// re-nested under their post by the thread id in the permalink.
function threadId(url: string): string | null {
  return url.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? null;
}

function threadRootUrl(url: string): string {
  return url.match(/^(.*\/comments\/[a-z0-9]+)/i)?.[1] ?? url;
}

export function normalizeItems(
  items: RawItem[],
  { maxPosts, maxCommentsPerPost }: { maxPosts: number; maxCommentsPerPost: number },
): RedditPost[] {
  const posts: RedditPost[] = [];
  const byThread = new Map<string, RedditPost>();

  for (const item of items) {
    if (itemKind(item) !== "post" || posts.length >= maxPosts) continue;
    const url = absolutizeRedditUrl(str(item.url ?? item.link ?? item.permalink));
    const post: RedditPost = {
      title: str(item.title) || null,
      body: truncate(str(item.body ?? item.text ?? item.selftext), 1200),
      url,
      subreddit: str(
        item.parsedCommunityName ?? item.communityName ?? item.subreddit,
      ).replace(/^\/?r\//, ""),
      upvotes: num(item.upVotes ?? item.upvotes ?? item.score),
      num_comments: num(
        item.numberOfComments ?? item.num_comments ?? item.commentsCount,
      ),
      created_at: str(item.createdAt ?? item.created_at),
      comments: [],
    };
    posts.push(post);
    const id = threadId(url);
    if (id) byThread.set(id, post);
  }

  for (const item of items) {
    if (itemKind(item) !== "comment") continue;
    const body = str(item.body ?? item.text);
    if (!body || body === "[deleted]" || body === "[removed]") continue;
    const url = absolutizeRedditUrl(str(item.url ?? item.link ?? item.permalink));
    const id = threadId(url);

    // Comment whose post item isn't in the result set: don't drop the data —
    // synthesize a stub post for its thread (the actor sometimes returns
    // comments without their parent post item).
    let post = id ? byThread.get(id) : undefined;
    if (!post && id && posts.length < maxPosts) {
      post = {
        title: null,
        body: "",
        url: `${threadRootUrl(url)}/`,
        subreddit: str(
          item.parsedCommunityName ?? item.communityName ?? item.subreddit,
        ).replace(/^\/?r\//, ""),
        upvotes: 0,
        num_comments: 0,
        created_at: str(item.createdAt ?? item.created_at),
        comments: [],
      };
      posts.push(post);
      byThread.set(id, post);
    }
    if (!post || post.comments.length >= maxCommentsPerPost) continue;
    post.comments.push({
      body: truncate(body, 800),
      upvotes: num(item.upVotes ?? item.upvotes ?? item.score),
      url,
    });
  }

  return posts;
}

export type SearchArgs = {
  query: string;
  subreddit?: string;
  sort?: string;
  time?: string;
  maxPosts: number;
  maxCommentsPerPost: number;
};

// Exported so the live check script exercises the exact same input the
// tool sends (see scripts/reddit-tool-test.ts).
export function buildSearchInput(args: SearchArgs) {
  return {
    searches: [args.query],
    ...(args.subreddit
      ? { searchCommunityName: args.subreddit.replace(/^\/?r\//, "") }
      : {}),
    searchPosts: true,
    searchComments: false,
    skipComments: false,
    maxComments: args.maxCommentsPerPost,
    maxItems: args.maxPosts,
    sort: args.sort ?? "relevance",
    time: args.time ?? "year",
    includeNSFW: false,
    includeMediaLinks: false,
    proxy: { useApifyProxy: true },
  };
}

export function buildThreadInput(postUrl: string, maxCommentsPerPost: number) {
  return {
    startUrls: [{ url: postUrl }],
    skipComments: false,
    maxComments: maxCommentsPerPost,
    maxItems: 1 + maxCommentsPerPost,
    includeNSFW: false,
    includeMediaLinks: false,
    proxy: { useApifyProxy: true },
  };
}

// Reddit search degrades badly on long conversational queries (loose
// one-word matches, viral megathreads). Visibility only — never blocks.
export function longQueryWarning(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 5) return null;
  return `reddit_research query has ${words} words — Reddit search handles long queries poorly and may return unrelated viral threads; use 2-4 word keyword phrases. Query: "${truncate(query, 120)}"`;
}

export function summarizeRawItems(items: RawItem[]): string {
  const kinds = { post: 0, comment: 0, other: 0 };
  for (const item of items) kinds[itemKind(item)]++;
  return `${items.length} raw (posts ${kinds.post}, comments ${kinds.comment}, other ${kinds.other})`;
}

function asToolResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function asToolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export type RedditToolsConfig = {
  token: string;
  /** Hard budget — the actor is pay-per-result, cap everything. */
  maxCalls: number;
  maxPosts: number;
  maxCommentsPerPost: number;
  /** Surfaces tool-level problems into the run's output_json.warnings. */
  onWarning?: (message: string) => void;
};

export function createRedditMcpServer({
  token,
  maxCalls,
  maxPosts,
  maxCommentsPerPost,
  onWarning,
}: RedditToolsConfig): McpSdkServerConfigWithInstance {
  let callsUsed = 0;

  return createSdkMcpServer({
    name: "reddit",
    version: "3.1.0",
    tools: [
      tool(
        "reddit_research",
        `Research Reddit via a scraper actor (pay-per-result — plan calls, don't explore one post at a time; each call takes ~30-90s). Two modes: (1) search mode — pass query (plus optional subreddit/sort/time) to get posts WITH their top comments nested; (2) thread mode — pass postUrl to deep-dive one thread's comments. IMPORTANT: queries must be SHORT keyword phrases, 2-4 words, the way people search Reddit ("fat loss plateau", not a sentence) — Reddit search loosely matches long queries and returns unrelated viral threads. Prefer scoping via subreddit. Returns { posts: [{ title, body, url, subreddit, upvotes, num_comments, created_at, comments: [{ body, upvotes, url }] }] }; url fields are real Reddit permalinks.`,
        {
          query: z
            .string()
            .optional()
            .describe(
              "Search query (search mode) — a SHORT keyword phrase, 2-4 words (e.g. 'fat loss plateau'), never a sentence",
            ),
          subreddit: z
            .string()
            .optional()
            .describe("Restrict search to one subreddit, e.g. 'loseit' (no r/ prefix) — prefer this for precision"),
          sort: z
            .enum(["relevance", "hot", "top", "new", "rising", "comments"])
            .optional()
            .describe(
              "Search sort (default relevance; 'top' also good; avoid 'comments' — it biases toward viral megathreads)",
            ),
          time: z
            .enum(["hour", "day", "week", "month", "year", "all"])
            .optional()
            .describe("Search time window (default year)"),
          maxPosts: z.number().int().min(1).max(50).optional().describe("Max posts (server-capped)"),
          maxCommentsPerPost: z
            .number()
            .int()
            .min(0)
            .max(50)
            .optional()
            .describe("Max comments nested per post (server-capped)"),
          postUrl: z
            .string()
            .url()
            .optional()
            .describe("Full Reddit post URL to deep-dive (thread mode; ignores query)"),
        },
        async (args) => {
          if (!args.query && !args.postUrl) {
            return asToolError("Pass either query (search mode) or postUrl (thread mode).");
          }
          if (callsUsed >= maxCalls) {
            return asToolError(
              `Tool-call budget exhausted (${maxCalls} calls) — stop researching and return your findings now.`,
            );
          }
          callsUsed += 1;

          const posts = Math.min(args.maxPosts ?? maxPosts, maxPosts);
          const comments = Math.min(
            args.maxCommentsPerPost ?? maxCommentsPerPost,
            maxCommentsPerPost,
          );

          if (!args.postUrl && args.query) {
            const warning = longQueryWarning(args.query);
            if (warning) {
              console.warn(`[reddit_research] ${warning}`);
              onWarning?.(warning);
            }
          }

          const input = args.postUrl
            ? buildThreadInput(args.postUrl, comments)
            : buildSearchInput({ ...args, query: args.query!, maxPosts: posts, maxCommentsPerPost: comments });

          try {
            const items = await callActor<RawItem>(REDDIT_ACTOR_ID, input, { token });
            const normalized = normalizeItems(items, {
              maxPosts: args.postUrl ? 1 : posts,
              maxCommentsPerPost: comments,
            });
            const nested = normalized.reduce((sum, p) => sum + p.comments.length, 0);
            console.log(
              `[reddit_research] ${summarizeRawItems(items)} → ${normalized.length} posts, ${nested} nested comments`,
            );
            if (items.length > 0 && normalized.length === 0) {
              const message = `reddit_research normalized 0 posts from ${items.length} raw items — field mapping mismatch; sample raw item: ${truncate(JSON.stringify(items[0]), 600)}`;
              console.warn(`[reddit_research] ${message}`);
              onWarning?.(message);
            }
            return asToolResult({
              posts: normalized,
              calls_remaining: maxCalls - callsUsed,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[reddit_research] call failed: ${message}`);
            onWarning?.(`reddit_research call failed: ${message}`);
            return asToolError(message);
          }
        },
      ),
    ],
  });
}
