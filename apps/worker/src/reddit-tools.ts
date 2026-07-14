import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { callActor } from "./apify";

// Reddit access goes through an Apify actor (Reddit blocks all
// unauthenticated fetches, and the official API registration fell through).
export const REDDIT_ACTOR_ID = "oAuCIx3ItNrs2okjQ"; // trudax/reddit-scraper-lite

export const REDDIT_TOOL_NAMES = [
  "mcp__reddit__reddit_search",
  "mcp__reddit__reddit_comments",
];

// Normalized shape handed to the agent. The actor's raw field names
// (communityName, upVotes, numberOfComments, createdAt, dataType, …) are
// mapped with fallbacks since the actor's schema isn't versioned.
export type RedditItem = {
  title: string | null;
  text: string;
  url: string;
  subreddit: string;
  upvotes: number;
  num_comments: number | null;
  created_at: string;
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

export function normalizeItem(item: RawItem, kind: "post" | "comment"): RedditItem {
  return {
    title: kind === "post" ? str(item.title) || null : null,
    text: truncate(str(item.body ?? item.text ?? item.selftext), 1200),
    url: str(item.url ?? item.link ?? item.permalink),
    subreddit: str(
      item.parsedCommunityName ?? item.communityName ?? item.subreddit,
    ).replace(/^\/?r\//, ""),
    upvotes: num(item.upVotes ?? item.upvotes ?? item.score),
    num_comments:
      kind === "post"
        ? num(item.numberOfComments ?? item.num_comments ?? item.commentsCount)
        : null,
    created_at: str(item.createdAt ?? item.created_at),
  };
}

export function itemKind(item: RawItem): "post" | "comment" | "other" {
  const dataType = str(item.dataType).toLowerCase();
  if (dataType === "post") return "post";
  if (dataType === "comment") return "comment";
  // fallback when dataType is absent: posts have titles, comments don't
  if (dataType === "") return str(item.title) ? "post" : "comment";
  return "other";
}

function asToolResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function asToolError(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

export type RedditToolsConfig = {
  token: string;
  /** Hard cap on items per tool call (depth quick ≈20, full ≈100). */
  maxItemsCap: number;
};

export function createRedditMcpServer({
  token,
  maxItemsCap,
}: RedditToolsConfig): McpSdkServerConfigWithInstance {
  const clamp = (requested: number | undefined, fallback: number) =>
    Math.min(requested ?? fallback, maxItemsCap);

  return createSdkMcpServer({
    name: "reddit",
    version: "2.0.0",
    tools: [
      tool(
        "reddit_search",
        `Search Reddit posts (via an Apify scraper actor; each call takes ~30-90s, so batch your intent into few calls). Returns posts as { title, text, url, subreddit, upvotes, num_comments, created_at }. url is the real Reddit permalink. Omit subreddit to search all of Reddit.`,
        {
          query: z.string().describe("Search query"),
          subreddit: z
            .string()
            .optional()
            .describe("Restrict to one subreddit, e.g. 'loseit' (no r/ prefix)"),
          maxItems: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max posts to return (server-capped by run depth)"),
        },
        async ({ query, subreddit, maxItems }) => {
          try {
            const limit = clamp(maxItems, 15);
            const sub = subreddit?.replace(/^\/?r\//, "");
            const input = {
              ...(sub
                ? {
                    startUrls: [
                      {
                        url: `https://www.reddit.com/r/${sub}/search/?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&t=year`,
                      },
                    ],
                  }
                : { searches: [query] }),
              searchPosts: true,
              searchComments: false,
              searchCommunities: false,
              searchUsers: false,
              skipComments: true,
              sort: "relevance",
              time: "year",
              includeNSFW: false,
              maxItems: limit,
              maxPostCount: limit,
              proxy: { useApifyProxy: true },
            };
            const items = await callActor<RawItem>(REDDIT_ACTOR_ID, input, {
              token,
            });
            const posts = items
              .filter((item) => itemKind(item) === "post")
              .slice(0, limit)
              .map((item) => normalizeItem(item, "post"));
            return asToolResult({ posts });
          } catch (err) {
            return asToolError(err);
          }
        },
      ),
      tool(
        "reddit_comments",
        `Fetch comments for one Reddit thread by its full post URL (from reddit_search). Returns { post, comments } — comments as { text, url, subreddit, upvotes, created_at } with url = the comment's own permalink. Comments are the best source of verbatim market language.`,
        {
          postUrl: z
            .string()
            .url()
            .describe("Full Reddit post URL, exactly as returned by reddit_search"),
          maxItems: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max comments to return (server-capped by run depth)"),
        },
        async ({ postUrl, maxItems }) => {
          try {
            const limit = clamp(maxItems, 30);
            const input = {
              startUrls: [{ url: postUrl }],
              skipComments: false,
              searchCommunities: false,
              searchUsers: false,
              includeNSFW: false,
              maxItems: limit + 1, // + the post itself
              maxPostCount: 1,
              maxComments: limit,
              proxy: { useApifyProxy: true },
            };
            const items = await callActor<RawItem>(REDDIT_ACTOR_ID, input, {
              token,
            });
            const post =
              items
                .filter((item) => itemKind(item) === "post")
                .map((item) => normalizeItem(item, "post"))[0] ?? null;
            const comments = items
              .filter((item) => itemKind(item) === "comment")
              .slice(0, limit)
              .map((item) => normalizeItem(item, "comment"))
              .filter((c) => c.text && c.text !== "[deleted]" && c.text !== "[removed]");
            return asToolResult({ post, comments });
          } catch (err) {
            return asToolError(err);
          }
        },
      ),
    ],
  });
}
