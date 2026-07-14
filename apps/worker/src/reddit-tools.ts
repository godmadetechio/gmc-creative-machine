import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { RedditClient, type RedditCredentials } from "./reddit";

export const REDDIT_TOOL_NAMES = [
  "mcp__reddit__search_posts",
  "mcp__reddit__get_comments",
];

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

// In-process MCP server the reddit-miner agent calls instead of WebFetch —
// Reddit blocks all unauthenticated access, so data comes via the official
// Data API (see reddit.ts).
export function createRedditMcpServer(
  creds: RedditCredentials,
): McpSdkServerConfigWithInstance {
  const client = new RedditClient(creds);

  return createSdkMcpServer({
    name: "reddit",
    version: "1.0.0",
    tools: [
      tool(
        "search_posts",
        "Search Reddit posts via the official Reddit API. Returns posts with id, subreddit, title, selftext, score, num_comments, and permalink. Omit subreddit to search across all of Reddit.",
        {
          query: z.string().describe("Search query"),
          subreddit: z
            .string()
            .optional()
            .describe("Restrict to one subreddit, e.g. 'loseit' (no r/ prefix)"),
          sort: z
            .enum(["relevance", "hot", "top", "new", "comments"])
            .optional()
            .describe("Sort order (default relevance; 'comments' = most discussed)"),
          time: z
            .enum(["hour", "day", "week", "month", "year", "all"])
            .optional()
            .describe("Time window (default year)"),
          limit: z.number().int().min(1).max(25).optional().describe("Max posts (default 10)"),
        },
        async ({ query, subreddit, sort, time, limit }) => {
          try {
            const posts = await client.searchPosts(query, {
              subreddit,
              sort,
              time,
              limit,
            });
            return asToolResult({ posts });
          } catch (err) {
            return asToolError(err);
          }
        },
      ),
      tool(
        "get_comments",
        "Fetch top comments for a Reddit post by its id (from search_posts). Returns the post plus a flattened list of comments with author, body, score, and permalink. Comments are the best source of verbatim market language.",
        {
          post_id: z.string().describe("Post id from search_posts (e.g. '1abc2d')"),
          limit: z.number().int().min(1).max(100).optional().describe("Max comments (default 30)"),
          depth: z.number().int().min(1).max(5).optional().describe("Reply depth (default 2)"),
        },
        async ({ post_id, limit, depth }) => {
          try {
            const result = await client.getComments(post_id, { limit, depth });
            return asToolResult(result);
          } catch (err) {
            return asToolError(err);
          }
        },
      ),
    ],
  });
}
