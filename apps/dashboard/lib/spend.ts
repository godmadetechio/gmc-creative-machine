import {
  addBreakdowns,
  runCostBreakdown,
  type CostBreakdown,
  type SpendProvider,
} from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

// INTERNAL SPEND rollups from runs.cost_usd — the authoritative metering
// (failed runs kept their spend, so all statuses count). Provider
// attribution via runCostBreakdown (structured cost_breakdown going
// forward, legacy-field heuristics for old rows).

type SpendRun = {
  client_id: string | null;
  type: string;
  cost_usd: number | null;
  created_at: string;
  output_json: unknown;
  clients: { name: string } | null;
};

export type SpendAggregates = {
  thisMonth: { totalUsd: number; byProvider: CostBreakdown };
  last30d: { totalUsd: number; byProvider: CostBreakdown };
  byClient30d: { clientId: string | null; name: string; totalUsd: number }[];
  byType30d: { type: string; totalUsd: number }[];
  /** Oldest → newest, 6 calendar months including the current one. */
  monthlyTrend: { month: string; totalUsd: number }[];
};

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function monthStartUtc(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

export async function getSpendAggregates(): Promise<SpendAggregates> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("runs")
    .select("client_id, type, cost_usd, created_at, output_json, clients (name)")
    .gte("created_at", monthStartUtc(-5).toISOString())
    .not("cost_usd", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  const runs = (data ?? []) as unknown as SpendRun[];

  const now = Date.now();
  const monthStart = monthStartUtc(0).getTime();
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000;

  let thisMonthTotal = 0;
  let thisMonthProviders: CostBreakdown = {};
  let last30Total = 0;
  let last30Providers: CostBreakdown = {};
  const byClient = new Map<string, { clientId: string | null; name: string; totalUsd: number }>();
  const byType = new Map<string, number>();
  const byMonth = new Map<string, number>();

  for (const run of runs) {
    const cost = run.cost_usd ?? 0;
    if (cost <= 0) continue;
    const at = new Date(run.created_at).getTime();
    const breakdown = runCostBreakdown(run);

    const monthKey = monthFormat.format(new Date(run.created_at));
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + cost);

    if (at >= monthStart) {
      thisMonthTotal += cost;
      thisMonthProviders = addBreakdowns(thisMonthProviders, breakdown);
    }
    if (at >= cutoff30d) {
      last30Total += cost;
      last30Providers = addBreakdowns(last30Providers, breakdown);
      const clientKey = run.client_id ?? "global";
      const entry = byClient.get(clientKey) ?? {
        clientId: run.client_id,
        name: run.clients?.name ?? (run.client_id ? "Unknown client" : "Global runs"),
        totalUsd: 0,
      };
      entry.totalUsd += cost;
      byClient.set(clientKey, entry);
      byType.set(run.type, (byType.get(run.type) ?? 0) + cost);
    }
  }

  const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
    const start = monthStartUtc(i - 5);
    const key = monthFormat.format(start);
    return { month: key, totalUsd: byMonth.get(key) ?? 0 };
  });

  return {
    thisMonth: { totalUsd: thisMonthTotal, byProvider: thisMonthProviders },
    last30d: { totalUsd: last30Total, byProvider: last30Providers },
    byClient30d: [...byClient.values()].sort((a, b) => b.totalUsd - a.totalUsd),
    byType30d: [...byType.entries()]
      .map(([type, totalUsd]) => ({ type, totalUsd }))
      .sort((a, b) => b.totalUsd - a.totalUsd),
    monthlyTrend,
  };
}

/** One client's spend — surfaced on the client Overview tab (margin visibility). */
export async function getClientSpend(clientId: string): Promise<{
  thisMonthUsd: number;
  last30dUsd: number;
  allTimeUsd: number;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("runs")
    .select("cost_usd, created_at")
    .eq("client_id", clientId)
    .not("cost_usd", "is", null)
    .limit(2000);

  const monthStart = monthStartUtc(0).getTime();
  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let thisMonthUsd = 0;
  let last30dUsd = 0;
  let allTimeUsd = 0;
  for (const row of data ?? []) {
    const cost = (row.cost_usd as number | null) ?? 0;
    if (cost <= 0) continue;
    const at = new Date(row.created_at as string).getTime();
    allTimeUsd += cost;
    if (at >= monthStart) thisMonthUsd += cost;
    if (at >= cutoff30d) last30dUsd += cost;
  }
  return { thisMonthUsd, last30dUsd, allTimeUsd };
}

/**
 * A provider's metered spend since an ISO timestamp — used to estimate
 * remaining balance from an operator-entered "balance as of <date>".
 */
export async function providerSpendSince(
  provider: SpendProvider,
  sinceIso: string,
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("runs")
    .select("type, cost_usd, output_json")
    .gte("created_at", sinceIso)
    .not("cost_usd", "is", null)
    .limit(5000);
  let total = 0;
  for (const row of data ?? []) {
    total +=
      runCostBreakdown(
        row as { type: string; cost_usd: number | null; output_json: unknown },
      )[provider] ?? 0;
  }
  return total;
}
