import { NextResponse } from "next/server";
import { PROVIDER_LABELS } from "@gmc/shared";
import { getBalanceViews } from "@/lib/balances";
import { createClient } from "@/lib/supabase/server";

// Lightweight low-balance read for the LowBalanceBanner — same pattern as
// /api/worker-status. Alerts are advisory only; nothing here gates runs.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const views = await getBalanceViews();
  const alerts = views
    .filter((view) => view.low)
    .map((view) => ({
      provider: view.balance.provider,
      label: PROVIDER_LABELS[view.balance.provider],
      valueUsd: view.effectiveUsd,
      thresholdUsd: view.balance.low_balance_threshold_usd,
      estimated: view.estimated,
    }));

  return NextResponse.json({ alerts });
}
