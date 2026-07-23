import Link from "next/link";
import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import { PROVIDER_LABELS, RunType, type SpendProvider } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RUN_TYPE_LABELS } from "@/components/run-status-badge";
import { getBalanceViews, type BalanceView } from "@/lib/balances";
import { relativeTime } from "@/lib/relative-time";
import { getSpendAggregates } from "@/lib/spend";
import { cn } from "@/lib/utils";

export const metadata = { title: "Usage — GODMADE" };

// Snapshots refresh hourly; anything much older means the worker (which
// writes them) has likely been down.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-muted-foreground text-xs font-medium uppercase">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function BalanceCard({ view, burnPerDayUsd }: { view: BalanceView; burnPerDayUsd: number }) {
  const { balance, effectiveUsd, estimated, low } = view;
  const stale =
    balance.fetched_at != null &&
    Date.now() - new Date(balance.fetched_at).getTime() > STALE_AFTER_MS;
  const daysLeft =
    effectiveUsd != null && burnPerDayUsd > 0 ? effectiveUsd / burnPerDayUsd : null;

  return (
    <Card className={cn(low && "border-red-500/60")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {PROVIDER_LABELS[balance.provider]}
          <Badge variant="outline" className="font-normal">
            {balance.source === "api" ? "live API" : "internal metering"}
          </Badge>
          {low && (
            <Badge className="border-transparent bg-red-600 text-white">
              <AlertTriangle className="size-3" />
              below threshold
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 text-sm">
        {effectiveUsd != null && (
          <p>
            <span className="text-xl font-bold">{usd(effectiveUsd)}</span>{" "}
            <span className="text-muted-foreground">
              {estimated ? "est. remaining" : "remaining"}
            </span>
          </p>
        )}
        {balance.usage_month_usd != null && (
          <p className="text-muted-foreground">
            {usd(balance.usage_month_usd)} used this month
          </p>
        )}
        {estimated && balance.manual_balance_at && (
          <p className="text-muted-foreground text-xs">
            from manual balance {usd(balance.manual_balance_usd ?? 0)} as of{" "}
            {relativeTime(balance.manual_balance_at)}
            {daysLeft != null &&
              ` · ~${Math.floor(daysLeft)} day${Math.floor(daysLeft) === 1 ? "" : "s"} at current burn`}
          </p>
        )}
        {balance.low_balance_threshold_usd != null && (
          <p className="text-muted-foreground text-xs">
            alert threshold {usd(balance.low_balance_threshold_usd)}
          </p>
        )}
        {balance.note && <p className="text-muted-foreground text-xs">{balance.note}</p>}
        {balance.error && (
          <p className="text-destructive text-xs">last refresh failed: {balance.error}</p>
        )}
        <p className={cn("text-xs", stale ? "text-amber-500" : "text-muted-foreground")}>
          {balance.fetched_at
            ? `fetched ${relativeTime(balance.fetched_at)}${stale ? " — stale (worker down?)" : ""}`
            : "no snapshot yet — the worker refreshes hourly"}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function UsagePage() {
  const [spend, balances] = await Promise.all([getSpendAggregates(), getBalanceViews()]);
  const trendMax = Math.max(...spend.monthlyTrend.map((m) => m.totalUsd), 1);
  const burnPerDayUsd = {
    anthropic: (spend.last30d.byProvider.anthropic ?? 0) / 30,
    fal: (spend.last30d.byProvider.fal ?? 0) / 30,
    apify: (spend.last30d.byProvider.apify ?? 0) / 30,
  };
  const providerLine = (byProvider: Partial<Record<SpendProvider, number>>) =>
    (["anthropic", "fal", "apify"] as const)
      .map((p) => `${PROVIDER_LABELS[p]} ${usd(byProvider[p] ?? 0)}`)
      .join(" · ");

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Wallet className="size-6" />
        Usage
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Internal spend metered from runs (authoritative) and best-effort external
        balances. Apify bills per scrape result and is not in internal metering —
        its own balance card below is the real number. Thresholds and manual
        balances live in{" "}
        <Link href="/settings" className="underline">
          Settings
        </Link>
        .
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="This month"
          value={usd(spend.thisMonth.totalUsd)}
          sub={providerLine(spend.thisMonth.byProvider)}
        />
        <StatTile
          label="Last 30 days"
          value={usd(spend.last30d.totalUsd)}
          sub={providerLine(spend.last30d.byProvider)}
        />
        <StatTile
          label="Anthropic (30d)"
          value={usd(spend.last30d.byProvider.anthropic ?? 0)}
          sub={`~${usd(burnPerDayUsd.anthropic)}/day burn`}
        />
        <StatTile
          label="fal.ai (30d)"
          value={usd(spend.last30d.byProvider.fal ?? 0)}
          sub={`~${usd(burnPerDayUsd.fal)}/day burn`}
        />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">External balances</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Refreshed hourly by the worker. Best-effort only — stale or missing
          balance data never blocks runs.
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          {balances.length === 0 ? (
            <Card className="lg:col-span-3">
              <CardContent className="text-muted-foreground py-8 text-center text-sm">
                No balance snapshots yet — start the worker (
                <code className="font-mono text-xs">pnpm worker:dev</code>) and verify
                the adapters with{" "}
                <code className="font-mono text-xs">pnpm balances:test</code>.
              </CardContent>
            </Card>
          ) : (
            balances.map((view) => (
              <BalanceCard
                key={view.balance.provider}
                view={view}
                burnPerDayUsd={burnPerDayUsd[view.balance.provider]}
              />
            ))
          )}
        </div>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly trend</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {spend.monthlyTrend.map((m) => (
              <div key={m.month} className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground w-14 shrink-0">{m.month}</span>
                <div className="bg-muted h-4 flex-1 overflow-hidden rounded-sm">
                  <div
                    className="bg-primary/70 h-full rounded-sm"
                    style={{ width: `${Math.round((m.totalUsd / trendMax) * 100)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right tabular-nums">
                  {usd(m.totalUsd)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By run type (30d)</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Pipeline</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spend.byType30d.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground pl-4">
                      No spend in the last 30 days.
                    </TableCell>
                  </TableRow>
                ) : (
                  spend.byType30d.map((row) => (
                    <TableRow key={row.type}>
                      <TableCell className="pl-4">
                        {RUN_TYPE_LABELS[row.type as RunType] ?? row.type}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usd(row.totalUsd)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Top clients (30d)</CardTitle>
          <p className="text-muted-foreground text-sm">
            We bill clients — this is margin visibility. Per-client spend also
            shows on each client&apos;s Overview tab.
          </p>
        </CardHeader>
        <CardContent className="px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Client</TableHead>
                <TableHead className="text-right">Spend (30d)</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {spend.byClient30d.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground pl-4">
                    No spend in the last 30 days.
                  </TableCell>
                </TableRow>
              ) : (
                spend.byClient30d.slice(0, 10).map((row) => (
                  <TableRow key={row.clientId ?? "global"}>
                    <TableCell className="pl-4">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usd(row.totalUsd)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.clientId && (
                        <Link
                          href={`/clients/${row.clientId}`}
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                        >
                          Open <ArrowRight className="size-3" />
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
