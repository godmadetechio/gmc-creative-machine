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

export function itemKind(item: RawItem): "post" | "comment" | "other" {
  const dataType = str(item.dataType).toLowerCase();
  if (dataType === "post") return "post";
  if (dataType === "comment") return "comment";
  // fallback when dataType is absent: posts have titles, comments don't
  if (dataType === "") return str(item.title) ? "post" : "comment";
  return "other";
}

// The actor returns a flat list of post and comment items; comments are
// re-nested under their post by the thread id in the permalink.
function threadId(url: string): string | null {
  return url.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? null;
}

export function normalizeItems(
  items: RawItem[],
  { maxPosts, maxCommentsPerPost }: { maxPosts: number; maxCommentsPerPost: number },
): RedditPost[] {
  const posts: RedditPost[] = [];
  const byThread = new Map<string, RedditPost>();

  for (const item of items) {
    if (itemKind(item) !== "post" || posts.length >= maxPosts) continue;
    const url = str(item.url ?? item.link ?? item.permalink);
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
    const url = str(item.url ?? item.link ?? item.permalink);
    const id = threadId(url ?? "");
    const post = id ? byThread.get(id) : undefined;
    if (!post || post.comments.length >= maxCommentsPerPost) continue;
    post.comments.push({
      body: truncate(body, 800),
      upvotes: num(item.upVotes ?? item.upvotes ?? item.score),
      url,
    });
  }

  return posts;
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
};

export function createRedditMcpServer({
  token,
  maxCalls,
  maxPosts,
  maxCommentsPerPost,
}: RedditToolsConfig): McpSdkServerConfigWithInstance {
  let callsUsed = 0;

  return createSdkMcpServer({
    name: "reddit",
    version: "3.0.0",
    tools: [
      tool(
        "reddit_research",
        `Research Reddit via a scraper actor (pay-per-result — plan calls, don't explore one post at a time; each call takes ~30-90s). Two modes: (1) search mode — pass query (plus optional subreddit/sort/time) to get posts WITH their top comments nested; (2) thread mode — pass postUrl to deep-dive one thread's comments. Returns { posts: [{ title, body, url, subreddit, upvotes, num_comments, created_at, comments: [{ body, upvotes, url }] }] }; url fields are real Reddit permalinks.`,
        {
          query: z.string().optional().describe("Search query (search mode)"),
          subreddit: z
            .string()
            .optional()
            .describe("Restrict search to one subreddit, e.g. 'loseit' (no r/ prefix)"),
          sort: z
            .enum(["relevance", "hot", "top", "new", "rising", "comments"])
            .optional()
            .describe("Search sort (default relevance; 'comments' = most discussed)"),
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

          const input = args.postUrl
            ? {
                startUrls: [{ url: args.postUrl }],
                skipComments: false,
                maxComments: comments,
                maxItems: 1 + comments,
                includeNSFW: false,
                includeMediaLinks: false,
                proxy: { useApifyProxy: true },
              }
            : {
                searches: [args.query],
                ...(args.subreddit
                  ? { searchCommunityName: args.subreddit.replace(/^\/?r\//, "") }
                  : {}),
                searchPosts: true,
                searchComments: false,
                skipComments: false,
                maxComments: comments,
                maxItems: posts,
                sort: args.sort ?? "relevance",
                time: args.time ?? "year",
                includeNSFW: false,
                includeMediaLinks: false,
                proxy: { useApifyProxy: true },
              };

          try {
            const items = await callActor<RawItem>(REDDIT_ACTOR_ID, input, { token });
            return asToolResult({
              posts: normalizeItems(items, {
                maxPosts: args.postUrl ? 1 : posts,
                maxCommentsPerPost: comments,
              }),
              calls_remaining: maxCalls - callsUsed,
            });
          } catch (err) {
            return asToolError(err instanceof Error ? err.message : String(err));
          }
        },
      ),
    ],
  });
}
