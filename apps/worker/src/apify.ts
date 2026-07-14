// Minimal Apify REST client — used by the reddit-miner today and reused in
// Phase 2 for the Facebook Ad Library actor.

const API_BASE = "https://api.apify.com/v2";

export function getApifyToken(): string | null {
  return process.env.APIFY_TOKEN || null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function apiError(res: Response, what: string): Promise<Error> {
  return new Error(
    `Apify ${what} failed: ${res.status} ${truncate(await res.text(), 300)}`,
  );
}

export type CallActorOptions = {
  token: string;
  /** Actor run timeout (and sync wait budget), seconds. Sync endpoint waits max 300s. */
  timeoutSecs?: number;
  /** Total budget for the async run+poll fallback, ms. */
  maxWaitMs?: number;
};

// Preferred path: run-sync-get-dataset-items — one POST, dataset items back.
// Apify answers 408 when the run outlives the sync wait; we then fall back
// to starting an async run and polling it.
export async function callActor<T = Record<string, unknown>>(
  actorId: string,
  input: unknown,
  { token, timeoutSecs = 180, maxWaitMs = 10 * 60 * 1000 }: CallActorOptions,
): Promise<T[]> {
  const url =
    `${API_BASE}/acts/${actorId}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=${Math.min(timeoutSecs, 300)}&format=json&clean=true`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    // sync endpoint holds the connection; give it headroom beyond the wait
    signal: AbortSignal.timeout((Math.min(timeoutSecs, 300) + 30) * 1000),
  }).catch((err) => {
    // network-level timeout → treat like a sync-wait timeout
    if (err instanceof Error && err.name === "TimeoutError") return null;
    throw err;
  });

  if (res && res.ok) {
    return (await res.json()) as T[];
  }
  if (res && res.status !== 408) {
    throw await apiError(res, `actor ${actorId} sync run`);
  }

  console.warn(`[apify] sync run of ${actorId} timed out — falling back to run+poll`);
  return runActorAndPoll<T>(actorId, input, { token, maxWaitMs });
}

async function runActorAndPoll<T>(
  actorId: string,
  input: unknown,
  { token, maxWaitMs = 10 * 60 * 1000 }: { token: string; maxWaitMs?: number },
): Promise<T[]> {
  const startRes = await fetch(
    `${API_BASE}/acts/${actorId}/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!startRes.ok) throw await apiError(startRes, `actor ${actorId} async start`);
  const started = (await startRes.json()) as {
    data: { id: string; defaultDatasetId: string };
  };
  const runId = started.data.id;

  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(
      `${API_BASE}/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    if (!statusRes.ok) throw await apiError(statusRes, `run ${runId} status`);
    const status = ((await statusRes.json()) as { data: { status: string } })
      .data.status;

    if (status === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      throw new Error(`Apify run ${runId} (actor ${actorId}) ended ${status}`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Apify run ${runId} (actor ${actorId}) still ${status} after ${Math.round(maxWaitMs / 1000)}s — giving up`,
      );
    }
  }

  const itemsRes = await fetch(
    `${API_BASE}/actor-runs/${runId}/dataset/items?token=${encodeURIComponent(token)}&format=json&clean=true`,
  );
  if (!itemsRes.ok) throw await apiError(itemsRes, `run ${runId} dataset items`);
  return (await itemsRes.json()) as T[];
}
