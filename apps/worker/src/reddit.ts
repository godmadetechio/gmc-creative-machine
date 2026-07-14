// Official Reddit Data API client (OAuth2 client-credentials).
// Reddit blocked all unauthenticated access (including .json endpoints) in
// May 2026, so the reddit-miner goes through this instead of WebFetch.

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

// Client-credentials apps get 100 QPM; serialize requests with a gap that
// keeps us well under it even with token refreshes in the mix.
const MIN_REQUEST_GAP_MS = 1_200; // ≈50 QPM

export type RedditCredentials = {
  clientId: string;
  clientSecret: string;
  userAgent: string;
};

export function getRedditCredentials(): RedditCredentials | null {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT;
  if (!clientId || !clientSecret || !userAgent) return null;
  return { clientId, clientSecret, userAgent };
}

export type RedditPost = {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  permalink: string;
  created_utc: number;
};

export type RedditComment = {
  author: string;
  body: string;
  score: number;
  permalink: string;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export class RedditClient {
  private token: { value: string; expiresAt: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private creds: RedditCredentials) {}

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token.value;
    }
    const basic = Buffer.from(
      `${this.creds.clientId}:${this.creds.clientSecret}`,
    ).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "User-Agent": this.creds.userAgent,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(
        `Reddit token request failed: ${res.status} ${truncate(await res.text(), 200)}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: json.access_token,
      // refresh a minute early
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  // All requests flow through one queue with a minimum gap — the simplest
  // rate limiter that can't burst past Reddit's QPM budget.
  private request<T>(path: string, params: Record<string, string>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return this.doRequest<T>(path, params, /* retryOn429 */ true);
    });
    // keep the chain alive even when a request fails
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doRequest<T>(
    path: string,
    params: Record<string, string>,
    retryOn429: boolean,
  ): Promise<T> {
    const token = await this.getToken();
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("raw_json", "1");

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": this.creds.userAgent,
      },
    });

    if (res.status === 401) {
      // token revoked/expired early — refresh once
      this.token = null;
      return this.doRequest<T>(path, params, retryOn429);
    }
    if (res.status === 429 && retryOn429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 5;
      console.warn(`[reddit] 429 rate limited, waiting ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.doRequest<T>(path, params, false);
    }
    if (!res.ok) {
      throw new Error(
        `Reddit API ${path} failed: ${res.status} ${truncate(await res.text(), 200)}`,
      );
    }
    return (await res.json()) as T;
  }

  async searchPosts(
    query: string,
    opts: {
      subreddit?: string;
      sort?: "relevance" | "hot" | "top" | "new" | "comments";
      time?: "hour" | "day" | "week" | "month" | "year" | "all";
      limit?: number;
    } = {},
  ): Promise<RedditPost[]> {
    const subreddit = opts.subreddit?.replace(/^\/?r\//, "");
    const path = subreddit ? `/r/${subreddit}/search` : "/search";
    const listing = await this.request<{
      data: { children: { data: Record<string, unknown> }[] };
    }>(path, {
      q: query,
      sort: opts.sort ?? "relevance",
      t: opts.time ?? "year",
      limit: String(Math.min(opts.limit ?? 10, 25)),
      ...(subreddit ? { restrict_sr: "1" } : {}),
      type: "link",
    });

    return listing.data.children.map(({ data }) => ({
      id: String(data.id),
      subreddit: String(data.subreddit),
      title: String(data.title),
      selftext: truncate(String(data.selftext ?? ""), 1500),
      score: Number(data.score ?? 0),
      num_comments: Number(data.num_comments ?? 0),
      permalink: `https://www.reddit.com${data.permalink}`,
      created_utc: Number(data.created_utc ?? 0),
    }));
  }

  async getComments(
    postId: string,
    opts: { limit?: number; depth?: number } = {},
  ): Promise<{ post: RedditPost | null; comments: RedditComment[] }> {
    const id = postId.replace(/^t3_/, "");
    const limit = Math.min(opts.limit ?? 30, 100);
    const [postListing, commentListing] = await this.request<
      [
        { data: { children: { data: Record<string, unknown> }[] } },
        { data: { children: unknown[] } },
      ]
    >(`/comments/${id}`, {
      limit: String(limit),
      depth: String(Math.min(opts.depth ?? 2, 5)),
      sort: "top",
    });

    const postData = postListing.data.children[0]?.data;
    const post: RedditPost | null = postData
      ? {
          id: String(postData.id),
          subreddit: String(postData.subreddit),
          title: String(postData.title),
          selftext: truncate(String(postData.selftext ?? ""), 1500),
          score: Number(postData.score ?? 0),
          num_comments: Number(postData.num_comments ?? 0),
          permalink: `https://www.reddit.com${postData.permalink}`,
          created_utc: Number(postData.created_utc ?? 0),
        }
      : null;

    const comments: RedditComment[] = [];
    const walk = (nodes: unknown[]) => {
      for (const node of nodes) {
        if (comments.length >= limit) return;
        const item = node as {
          kind?: string;
          data?: Record<string, unknown>;
        };
        if (item.kind !== "t1" || !item.data) continue; // skip "more" nodes
        const body = String(item.data.body ?? "");
        if (body && body !== "[deleted]" && body !== "[removed]") {
          comments.push({
            author: String(item.data.author ?? "unknown"),
            body: truncate(body, 800),
            score: Number(item.data.score ?? 0),
            permalink: `https://www.reddit.com${item.data.permalink}`,
          });
        }
        const replies = item.data.replies as
          | { data?: { children?: unknown[] } }
          | ""
          | undefined;
        if (replies && typeof replies === "object") {
          walk(replies.data?.children ?? []);
        }
      }
    };
    walk(commentListing.data.children);

    return { post, comments };
  }
}
