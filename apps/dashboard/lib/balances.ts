import {
  BALANCE_PROVIDERS,
  effectiveBalanceUsd,
  ProviderBalanceSchema,
  type ProviderBalance,
} from "@gmc/shared";
import { providerSpendSince } from "@/lib/spend";
import { createClient } from "@/lib/supabase/server";

// External provider balances as the dashboard consumes them: the worker's
// hourly snapshot + the operator's manual balance, resolved into one
// effective figure per provider, with the low-threshold verdict. Unknown
// or stale data NEVER counts as low (alerts must not cry wolf, and runs
// are never blocked on balance data).

export type BalanceView = {
  balance: ProviderBalance;
  /** The figure alerts compare: API balance, or manual minus metered spend. */
  effectiveUsd: number | null;
  /** True when effectiveUsd is derived from the manual balance. */
  estimated: boolean;
  low: boolean;
};

export async function getBalanceViews(): Promise<BalanceView[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("provider_balances").select("*");
  const rows = (data ?? [])
    .map((row) => ProviderBalanceSchema.safeParse(row))
    .filter((parsed): parsed is { success: true; data: ProviderBalance } => parsed.success)
    .map((parsed) => parsed.data);

  const views: BalanceView[] = [];
  for (const balance of rows) {
    let metered: number | null = null;
    if (
      balance.balance_usd == null &&
      balance.manual_balance_usd != null &&
      balance.manual_balance_at
    ) {
      metered = await providerSpendSince(balance.provider, balance.manual_balance_at);
    }
    const { valueUsd, estimated } = effectiveBalanceUsd(balance, metered);
    const low =
      balance.low_balance_threshold_usd != null &&
      valueUsd != null &&
      valueUsd < balance.low_balance_threshold_usd;
    views.push({ balance, effectiveUsd: valueUsd, estimated, low });
  }
  return views.sort(
    (a, b) =>
      BALANCE_PROVIDERS.indexOf(a.balance.provider) -
      BALANCE_PROVIDERS.indexOf(b.balance.provider),
  );
}
