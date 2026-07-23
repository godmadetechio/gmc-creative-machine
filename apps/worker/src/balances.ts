import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  addBreakdowns,
  runCostBreakdown,
  type BalanceProvider,
  type BalanceSource,
  type CostBreakdown,
} from "@gmc/shared";
import { getApifyToken } from "./apify";

// EXTERNAL PROVIDER BALANCES — best-effort hourly snapshots into
// provider_balances. House rules: every live endpoint here is covered by
// `pnpm balances:test` (run it against real keys BEFORE trusting these
// adapters), and stale/missing balance data NEVER blocks runs — failures
// only write the error column.

export function getAnthropicAdminKey(): string | null {
  return process.env.ANTHROPIC_ADMIN_KEY ?? null;
}

export type BalanceSnapshot = {
  provider: BalanceProvider;
  balanceUsd: number | null;
  usageMonthUsd: number | null;
  source: BalanceSource;
  note: string | null;
  detail: unknown;
};

// ---------------------------------------------------------------------------
// Apify: GET /v2/users/me/limits — documented account endpoint carrying the
// month-to-date usage and the plan's monthly allowance. Remaining allowance
// stands in for "balance" on prepaid plans.

export const ApifyLimitsSchema = z.object({
  data: z.object({
    current: z.object({ monthlyUsageUsd: z.number() }).passthrough(),
    limits: z.object({ maxMonthlyUsageUsd: z.number() }).passthrough(),
  }),
});

export async function fetchApifyBalance(token: string): Promise<BalanceSnapshot> {
  const res = await fetch("https://api.apify.com/v2/users/me/limits", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Apify /v2/users/me/limits responded ${res.status}`);
  }
  const raw: unknown = await res.json();
  const parsed = ApifyLimitsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Apify limits payload shape drifted (run pnpm balances:test): ${parsed.error.issues[0]?.message}`,
    );
  }
  const usage = parsed.data.data.current.monthlyUsageUsd;
  const max = parsed.data.data.limits.maxMonthlyUsageUsd;
  return {
    provider: "apify",
    balanceUsd: Number((max - usage).toFixed(2)),
    usageMonthUsd: Number(usage.toFixed(2)),
    source: "api",
    note: `remaining monthly allowance of $${max.toFixed(0)} plan cap`,
    detail: raw,
  };
}

// ---------------------------------------------------------------------------
// Anthropic: the Admin Cost API (GET /v1/organizations/cost_report) needs an
// ADMIN key (sk-ant-admin…), not the workspace API key — configured via
// ANTHROPIC_ADMIN_KEY. Without it we fall back to internal metering.

// Amounts arrive as decimal strings in results[].amount; we only rely on
// that much and keep the raw payload in detail_json.
export const AnthropicCostReportSchema = z.object({
  data: z.array(
    z.object({
      results: z.array(z.object({ amount: z.string() }).passthrough()).default([]),
    }).passthrough(),
  ),
});

export async function fetchAnthropicCost(adminKey: string): Promise<BalanceSnapshot> {
  const monthStart = startOfMonthUtc();
  const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
  url.searchParams.set("starting_at", monthStart.toISOString());
  url.searchParams.set("limit", "31");
  const res = await fetch(url, {
    headers: {
      "x-api-key": adminKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic cost_report responded ${res.status}`);
  }
  const raw: unknown = await res.json();
  const parsed = AnthropicCostReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Anthropic cost_report payload shape drifted (run pnpm balances:test): ${parsed.error.issues[0]?.message}`,
    );
  }
  const total = parsed.data.data
    .flatMap((bucket) => bucket.results)
    .reduce((sum, r) => sum + (Number.parseFloat(r.amount) || 0), 0);
  return {
    provider: "anthropic",
    // Postpaid API billing — there is no "remaining balance" to report.
    balanceUsd: null,
    usageMonthUsd: Number(total.toFixed(2)),
    source: "api",
    note: "org-wide month-to-date cost from the Admin API (postpaid — no balance)",
    detail: raw,
  };
}

// ---------------------------------------------------------------------------
// Internal metering fallback: this month's per-provider spend summed from
// runs.cost_usd breakdowns. Used for Anthropic without an admin key, and
// always for fal (no public balance/billing endpoint as of integration —
// the operator keeps a manual "balance as of" in Settings instead).

export async function internalMonthSpend(
  supabase: SupabaseClient,
): Promise<CostBreakdown> {
  const { data, error } = await supabase
    .from("runs")
    .select("type, cost_usd, output_json")
    .gte("created_at", startOfMonthUtc().toISOString())
    .not("cost_usd", "is", null)
    .limit(2000);
  if (error) throw new Error(`internal metering query failed: ${error.message}`);
  let total: CostBreakdown = {};
  for (const row of data ?? []) {
    total = addBreakdowns(
      total,
      runCostBreakdown(row as { type: string; cost_usd: number | null; output_json: unknown }),
    );
  }
  return total;
}

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// ---------------------------------------------------------------------------
// Hourly refresh: one snapshot per provider upserted into provider_balances.
// Column-scoped upserts deliberately never touch the dashboard-owned fields
// (manual_balance_usd, low_balance_threshold_usd).

export async function refreshProviderBalances(supabase: SupabaseClient): Promise<void> {
  let internal: CostBreakdown | null = null;
  try {
    internal = await internalMonthSpend(supabase);
  } catch (err) {
    console.warn(
      `[balances] internal metering failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  const snapshots: Promise<BalanceSnapshot>[] = [];

  const apifyToken = getApifyToken();
  if (apifyToken) {
    snapshots.push(fetchApifyBalance(apifyToken));
  } else {
    snapshots.push(
      Promise.resolve({
        provider: "apify",
        balanceUsd: null,
        usageMonthUsd: null,
        source: "api",
        note: "APIFY_TOKEN not set — no balance read",
        detail: null,
      }),
    );
  }

  const adminKey = getAnthropicAdminKey();
  if (adminKey) {
    snapshots.push(fetchAnthropicCost(adminKey));
  } else {
    snapshots.push(
      Promise.resolve({
        provider: "anthropic",
        balanceUsd: null,
        usageMonthUsd: internal?.anthropic != null ? Number(internal.anthropic.toFixed(2)) : null,
        source: "internal_metering",
        note: "ANTHROPIC_ADMIN_KEY not set — month-to-date agent spend metered from runs",
        detail: null,
      }),
    );
  }

  // fal has no balance/billing API — internal metering + the operator's
  // manual balance (Settings) carry this provider.
  snapshots.push(
    Promise.resolve({
      provider: "fal",
      balanceUsd: null,
      usageMonthUsd: internal?.fal != null ? Number(internal.fal.toFixed(2)) : null,
      source: "internal_metering",
      note: "fal.ai exposes no balance API — month-to-date image spend metered from runs; set a manual balance in Settings for a remaining estimate",
      detail: null,
    }),
  );

  const results = await Promise.allSettled(snapshots);
  const now = new Date().toISOString();
  for (const [i, outcome] of results.entries()) {
    const provider = (["apify", "anthropic", "fal"] as const)[i]!;
    if (outcome.status === "fulfilled") {
      const snap = outcome.value;
      const { error } = await supabase.from("provider_balances").upsert({
        provider: snap.provider,
        balance_usd: snap.balanceUsd,
        usage_month_usd: snap.usageMonthUsd,
        source: snap.source,
        note: snap.note,
        detail_json: snap.detail,
        error: null,
        fetched_at: now,
        updated_at: now,
      });
      if (error) console.warn(`[balances] upsert failed for ${snap.provider}: ${error.message}`);
    } else {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      console.warn(`[balances] ${provider} refresh failed: ${message}`);
      // Keep the previous snapshot's numbers; only record the failure.
      const { error } = await supabase
        .from("provider_balances")
        .upsert({ provider, error: message, updated_at: now });
      if (error) console.warn(`[balances] error upsert failed for ${provider}: ${error.message}`);
    }
  }
  console.log("[balances] provider balances refreshed");
}
