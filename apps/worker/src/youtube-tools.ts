import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { callActor } from "./apify";

// YouTube comments are JS-rendered and unreachable via WebFetch, so they go
// through an Apify actor. username~name addressing avoids the internal ID.
export const YOUTUBE_ACTOR_ID = "streamers~youtube-comments-scraper";

export const YOUTUBE_TOOL_NAMES = ["mcp__youtube__youtube_comments"];

export type YoutubeComment = {
  text: string;
  likes: number;
  url: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Like counts may come as numbers or strings like "1.2K".
export function parseCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = str(value).trim().toUpperCase();
  if (!text) return 0;
  const match = text.match(/^([\d.,]+)\s*([KM])?$/);
  if (!match?.[1]) return 0;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  return Math.round(base * (match[2] === "M" ? 1e6 : match[2] === "K" ? 1e3 : 1));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type RawItem = Record<string, unknown>;

// The actor emits one item per comment: { cid, comment, voteCount,
// replyCount, videoId, pageUrl, … }. Fallback names cover actor updates.
export function normalizeComments(
  items: RawItem[],
  { videoUrl, maxComments }: { videoUrl: string; maxComments: number },
): YoutubeComment[] {
  const comments: YoutubeComment[] = [];
  for (const item of items) {
    if (comments.length >= maxComments) break;
    const text = str(item.comment ?? item.text ?? item.content);
    if (!text) continue;
    const videoId = str(item.videoId ?? item.video_id);
    const cid = str(item.cid ?? item.commentId ?? item.id);
    const url =
      videoId && cid
        ? `https://www.youtube.com/watch?v=${videoId}&lc=${cid}`
        : str(item.pageUrl ?? item.url) || videoUrl;
    comments.push({
      text: truncate(text, 800),
      likes: parseCount(item.voteCount ?? item.likeCount ?? item.likes ?? item.votes),
      url,
    });
  }
  return comments;
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

export type YoutubeToolsConfig = {
  token: string;
  /** One tool call = one video; hard budget (pay-per-result actor). */
  maxVideos: number;
  maxCommentsPerVideo: number;
  /** Surfaces tool-level problems into the run's output_json.warnings. */
  onWarning?: (message: string) => void;
};

export function createYoutubeMcpServer({
  token,
  maxVideos,
  maxCommentsPerVideo,
  onWarning,
}: YoutubeToolsConfig): McpSdkServerConfigWithInstance {
  let videosUsed = 0;

  return createSdkMcpServer({
    name: "youtube",
    version: "1.0.0",
    tools: [
      tool(
        "youtube_comments",
        `Fetch viewer comments for one YouTube video via a scraper actor (pay-per-result; each call takes ~30-90s — pick videos deliberately, don't sample broadly). Returns { comments: [{ text, likes, url }] } sorted as YouTube serves them; url deep-links to the comment when possible.`,
        {
          videoUrl: z
            .string()
            .url()
            .describe("Full YouTube video URL (youtube.com/watch?v=… or youtu.be/…)"),
          maxComments: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max comments to return (server-capped by run depth)"),
        },
        async ({ videoUrl, maxComments }) => {
          if (videosUsed >= maxVideos) {
            return asToolError(
              `Video budget exhausted (${maxVideos} videos) — stop researching and return your findings now.`,
            );
          }
          videosUsed += 1;

          const limit = Math.min(maxComments ?? maxCommentsPerVideo, maxCommentsPerVideo);
          try {
            const items = await callActor<RawItem>(
              YOUTUBE_ACTOR_ID,
              {
                startUrls: [{ url: videoUrl, method: "GET" }],
                maxComments: limit,
              },
              { token },
            );
            const comments = normalizeComments(items, { videoUrl, maxComments: limit });
            console.log(
              `[youtube_comments] ${items.length} raw items → ${comments.length} comments (${videoUrl})`,
            );
            if (items.length > 0 && comments.length === 0) {
              const message = `youtube_comments normalized 0 comments from ${items.length} raw items — field mapping mismatch; sample raw item: ${truncate(JSON.stringify(items[0]), 600)}`;
              console.warn(`[youtube_comments] ${message}`);
              onWarning?.(message);
            }
            return asToolResult({
              comments,
              videos_remaining: maxVideos - videosUsed,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[youtube_comments] call failed: ${message}`);
            onWarning?.(`youtube_comments call failed: ${message}`);
            return asToolError(message);
          }
        },
      ),
    ],
  });
}
