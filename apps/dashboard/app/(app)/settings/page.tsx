import Link from "next/link";
import { BALANCE_PROVIDERS, PROVIDER_LABELS, ProviderBalanceSchema } from "@gmc/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeTime } from "@/lib/relative-time";
import { createClient } from "@/lib/supabase/server";
import { BalanceSettingsForm } from "./balance-settings-form";

export const metadata = { title: "Settings — GODMADE" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("provider_balances").select("*");
  const byProvider = new Map(
    (data ?? [])
      .map((row) => ProviderBalanceSchema.safeParse(row))
      .filter((parsed) => parsed.success)
      .map((parsed) => [parsed.data.provider, parsed.data] as const),
  );

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Balance alerts and operator-maintained balances. API keys live in{" "}
        <code className="font-mono text-xs">.env.local</code>.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Provider balance alerts</CardTitle>
          <p className="text-muted-foreground text-sm">
            When a provider&apos;s balance (or estimated remaining) drops below its
            threshold, the dashboard shows a banner and flags it on the{" "}
            <Link href="/usage" className="underline">
              Usage page
            </Link>
            . Alerts never block runs. fal.ai has no balance API — enter its
            balance manually here after topping up; the estimate burns it down
            using metered image spend.
          </p>
        </CardHeader>
        <CardContent className="divide-y">
          {BALANCE_PROVIDERS.map((provider) => {
            const row = byProvider.get(provider);
            return (
              <BalanceSettingsForm
                key={provider}
                provider={provider}
                label={PROVIDER_LABELS[provider]}
                initialThresholdUsd={row?.low_balance_threshold_usd ?? null}
                includeManualBalance={provider === "fal"}
                initialManualBalanceUsd={row?.manual_balance_usd ?? null}
                manualBalanceAtLabel={
                  row?.manual_balance_at ? relativeTime(row.manual_balance_at) : null
                }
              />
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
