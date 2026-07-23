import { z } from "zod";

// USAGE & BALANCES — internal spend attribution + external provider
// balance snapshots. Internal spend (runs.cost_usd) is authoritative;
// external balances are best-effort adapter reads and NEVER gate runs.

// ---------------------------------------------------------------------------
// Internal spend: per-provider attribution of runs.cost_usd.

export const SPEND_PROVIDERS = ["anthropic", "fal", "apify", "other"] as const;
export type SpendProvider = (typeof SPEND_PROVIDERS)[number];

/**
 * Structured per-provider breakdown written into runs.output_json as
 * `cost_breakdown` by every pipeline going forward. Values are USD.
 */
export const CostBreakdownSchema = z.object({
  anthropic: z.number().nonnegative().optional(),
  fal: z.number().nonnegative().optional(),
  apify: z.number().nonnegative().optional(),
  other: z.number().nonnegative().optional(),
});
export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

// Legacy cost fields older runs carry instead of cost_breakdown.
const LegacyCostFieldsSchema = z.object({
  cost_breakdown: CostBreakdownSchema.optional(),
  agent_cost_usd: z.number().optional(),
  generation_cost_usd: z.number().optional(),
});

/**
 * Per-provider attribution for one run. Prefers the structured
 * cost_breakdown; falls back to the legacy still_ads fields
 * (agent_cost_usd/generation_cost_usd), then to a per-type heuristic:
 * creative_regen is pure fal image spend, everything else is Anthropic
 * agent spend. Apify was historically never metered into cost_usd (its
 * pay-per-result billing shows up in the provider balance instead).
 */
export function runCostBreakdown(run: {
  type: string;
  cost_usd: number | null;
  output_json: unknown;
}): CostBreakdown {
  const total = run.cost_usd ?? 0;
  if (total <= 0) return {};

  const fields = LegacyCostFieldsSchema.safeParse(run.output_json ?? {});
  if (fields.success && fields.data.cost_breakdown) {
    return fields.data.cost_breakdown;
  }
  if (
    fields.success &&
    (fields.data.agent_cost_usd != null || fields.data.generation_cost_usd != null)
  ) {
    const fal = fields.data.generation_cost_usd ?? 0;
    const anthropic = fields.data.agent_cost_usd ?? Math.max(0, total - fal);
    return { anthropic, fal };
  }
  if (run.type === "creative_regen") return { fal: total };
  return { anthropic: total };
}

/** a + b, per provider. */
export function addBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  const out: CostBreakdown = { ...a };
  for (const provider of SPEND_PROVIDERS) {
    const value = b[provider];
    if (value != null) out[provider] = (out[provider] ?? 0) + value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// External balances: provider_balances rows.

export const BALANCE_PROVIDERS = ["anthropic", "apify", "fal"] as const;
export type BalanceProvider = (typeof BALANCE_PROVIDERS)[number];

export const BalanceSource = z.enum(["api", "internal_metering"]);
export type BalanceSource = z.infer<typeof BalanceSource>;

// A provider_balances row as read from the DB.
export const ProviderBalanceSchema = z.object({
  provider: z.enum(BALANCE_PROVIDERS),
  /** Provider-reported remaining credit, when the API exposes one. */
  balance_usd: z.number().nullable(),
  /** Provider-reported month-to-date spend, when the API exposes it. */
  usage_month_usd: z.number().nullable(),
  source: BalanceSource.catch("api"),
  note: z.string().nullable(),
  detail_json: z.unknown().nullable(),
  /** Last refresh error, cleared on success. Never blocks runs. */
  error: z.string().nullable(),
  fetched_at: z.string().nullable(),
  /** Operator-entered "balance as of <date>" for providers with no API. */
  manual_balance_usd: z.number().nullable(),
  manual_balance_at: z.string().nullable(),
  /** Below this → dashboard banner + Usage-page flag. Null = no alert. */
  low_balance_threshold_usd: z.number().nullable(),
  updated_at: z.string(),
});
export type ProviderBalance = z.infer<typeof ProviderBalanceSchema>;

export const PROVIDER_LABELS: Record<SpendProvider, string> = {
  anthropic: "Anthropic",
  fal: "fal.ai",
  apify: "Apify",
  other: "Other",
};

/**
 * The balance figure to alert on: the provider-reported balance when the
 * API gives one, else the operator's manual balance minus metered spend
 * since it was entered (the fal path). `meteredSinceManualUsd` is that
 * provider's internal spend since manual_balance_at, computed by the
 * caller from runs. Returns null when nothing is known — unknown NEVER
 * counts as low.
 */
export function effectiveBalanceUsd(
  balance: Pick<ProviderBalance, "balance_usd" | "manual_balance_usd">,
  meteredSinceManualUsd: number | null,
): { valueUsd: number | null; estimated: boolean } {
  if (balance.balance_usd != null) {
    return { valueUsd: balance.balance_usd, estimated: false };
  }
  if (balance.manual_balance_usd != null) {
    return {
      valueUsd: Math.max(0, balance.manual_balance_usd - (meteredSinceManualUsd ?? 0)),
      estimated: true,
    };
  }
  return { valueUsd: null, estimated: false };
}
