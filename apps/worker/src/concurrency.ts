// Shared bounded worker pool. Extracted from fb-ads.ts so ad scraping and
// image generation ration their third-party calls the same way.

export type SettledResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

// Runs fn over items with at most `limit` calls in flight. Results are
// index-aligned with `items`, in Promise.allSettled shape — a rejection
// never sinks the batch.
export async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<SettledResult<O>[]> {
  const results: SettledResult<O>[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        try {
          results[i] = { status: "fulfilled", value: await fn(items[i]!, i) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}
