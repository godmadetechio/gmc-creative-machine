import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  CircleAlert,
  GalleryVerticalEnd,
  Gauge,
  Lightbulb,
  Sparkles,
  Wallet,
} from "lucide-react";
import { type Client } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunStatusBadge } from "@/components/run-status-badge";
import { getClientReadiness, type ClientReadiness } from "@/lib/readiness";
import { relativeTime } from "@/lib/relative-time";
import { getClientSpend } from "@/lib/spend";
import { createClient } from "@/lib/supabase/server";
import { RunBuyerBrainButton } from "../run-buyer-brain-button";
import { RunCreativeSelectionButton } from "../run-creative-selection-button";
import { RunStillAdsButton } from "../run-still-ads-button";
import {
  isActiveRun,
  RUN_ROW_COLUMNS,
  RunRowSchema,
  runCandidateCount,
  runCreativeCount,
  runDepth,
  type RunRow,
} from "../run-tables";

// Overview tab: brief summary, latest run per pipeline, pending-review
// counts and a "what's next" hint. Full run histories live on the
// Research / Selection / Creatives tabs.

function nextAction(state: {
  hasActiveBbm: boolean;
  pendingCandidates: number;
  selectedWinners: number;
  draftCreatives: number;
  anyRunActive: boolean;
  planReviewPending: boolean;
}): string {
  if (state.planReviewPending)
    return "A still-ads concept plan is awaiting your review on the Creatives tab — generation starts after approval.";
  if (state.anyRunActive) return "A run is in flight — results land here when it finishes.";
  if (!state.hasActiveBbm)
    return "Run Buyer Brain first — every later step scores against the matrix.";
  if (state.pendingCandidates > 0)
    return `Review the ${state.pendingCandidates} pending ad candidate${state.pendingCandidates === 1 ? "" : "s"} on the Selection tab.`;
  if (state.selectedWinners === 0)
    return "Run Creative Selection to scout competitor ads worth rebuilding.";
  if (state.draftCreatives > 0)
    return `Review the ${state.draftCreatives} draft creative${state.draftCreatives === 1 ? "" : "s"} on the Creatives tab.`;
  return "Run Still Ads to turn the BBM and selected winners into creatives.";
}

// Creative-readiness meter: the material still_ads needs, visible at
// onboarding instead of discovered at run time.
function ReadinessMeter({ readiness }: { readiness: ClientReadiness }) {
  const done = readiness.items.filter((i) => i.ok).length;
  const total = readiness.items.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4" />
          Creative readiness
          <span
            className={
              readiness.ready
                ? "text-sm font-normal text-emerald-500"
                : "text-sm font-normal text-amber-500"
            }
          >
            {done}/{total}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={readiness.ready ? "h-full bg-emerald-500" : "h-full bg-amber-500"}
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {readiness.items.map((item) => (
            <li key={item.key} className="flex items-start gap-2">
              {item.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <span>
                <span className="font-medium">{item.label}</span>{" "}
                <span className="text-muted-foreground">— {item.detail}</span>
                {!item.ok && (
                  <>
                    {" "}
                    <Link href={item.href} className="underline">
                      Fix
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// We bill clients — internal run spend per client is margin visibility.
function ClientSpendCard({
  spend,
}: {
  spend: { thisMonthUsd: number; last30dUsd: number; allTimeUsd: number };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4" />
          Spend
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-2xl font-bold tracking-tight">{usd(spend.thisMonthUsd)}</p>
        <p className="text-muted-foreground text-sm">
          this month · {usd(spend.last30dUsd)} last 30 days · {usd(spend.allTimeUsd)}{" "}
          all time
        </p>
        <p className="text-muted-foreground text-xs">
          Internal pipeline cost (agents + generation) metered from runs — what
          this client costs us against what we bill. Agency-wide view on the{" "}
          <Link href="/usage" className="underline">
            Usage page
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function LatestRunLine({ run }: { run: RunRow | undefined }) {
  if (!run) return <p className="text-muted-foreground text-sm">No runs yet.</p>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <RunStatusBadge status={run.status} />
      <span className="text-muted-foreground">
        {relativeTime(run.created_at)}
        {run.cost_usd != null && ` · $${run.cost_usd.toFixed(2)}`}
      </span>
    </div>
  );
}

export async function OverviewTab({ client }: { client: Client }) {
  const supabase = await createClient();
  const [
    runsResult,
    bbmResult,
    activeBbmResult,
    pendingCandidatesResult,
    selectedWinnersResult,
    draftCreativesResult,
  ] = await Promise.all([
    supabase
      .from("runs")
      .select(RUN_ROW_COLUMNS)
      .eq("client_id", client.id)
      .in("type", ["buyer_brain", "creative_selection", "still_ads"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("bbm_versions")
      .select("version")
      .eq("client_id", client.id)
      .order("version", { ascending: false })
      .limit(1),
    supabase
      .from("bbm_versions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("is_active", true),
    supabase
      .from("ad_candidates")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("status", "candidate"),
    supabase
      .from("ad_candidates")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("status", "selected"),
    supabase
      .from("creatives")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("status", "draft"),
  ]);

  const runs = (runsResult.data ?? []).map((row) => RunRowSchema.parse(row));
  const latestOf = (type: string) => runs.find((run) => run.type === type);
  const bbmRun = latestOf("buyer_brain");
  const selectionRun = latestOf("creative_selection");
  const stillAdsRun = latestOf("still_ads");
  const latestBbmVersion = bbmResult.data?.[0]?.version ?? null;
  const hasActiveBbm = (activeBbmResult.count ?? 0) > 0;
  const pendingCandidates = pendingCandidatesResult.count ?? 0;
  const selectedWinners = selectedWinnersResult.count ?? 0;
  const draftCreatives = draftCreativesResult.count ?? 0;
  const anyRunActive = runs.some(isActiveRun);
  const planReviewPending = stillAdsRun?.status === "plan_review";
  const [readiness, spend] = await Promise.all([
    getClientReadiness(client),
    getClientSpend(client.id),
  ]);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardContent className="flex items-start gap-3 py-4">
          <Lightbulb className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-sm">
            {nextAction({
              hasActiveBbm,
              pendingCandidates,
              selectedWinners,
              draftCreatives,
              anyRunActive,
              planReviewPending,
            })}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReadinessMeter readiness={readiness} />
        <ClientSpendCard spend={spend} />
      </div>

      {client.brief && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brief</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm whitespace-pre-wrap">
            {client.brief}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenText className="size-4" />
              Buyer Brain
              {latestBbmVersion != null && (
                <span className="text-muted-foreground text-sm font-normal">
                  v{latestBbmVersion}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LatestRunLine run={bbmRun} />
            {bbmRun && (
              <p className="text-muted-foreground text-xs capitalize">
                depth: {runDepth(bbmRun.input_json)}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <RunBuyerBrainButton
                clientId={client.id}
                disabled={!!bbmRun && isActiveRun(bbmRun)}
              />
              <Button asChild variant="ghost" size="sm">
                <Link href={`/clients/${client.id}?tab=research`}>
                  Research
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GalleryVerticalEnd className="size-4" />
              Creative Selection
              {pendingCandidates > 0 && (
                <span className="text-muted-foreground text-sm font-normal">
                  {pendingCandidates} pending
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LatestRunLine run={selectionRun} />
            {selectionRun && runCandidateCount(selectionRun.output_json) != null && (
              <p className="text-muted-foreground text-xs">
                {runCandidateCount(selectionRun.output_json)} candidates last run
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <RunCreativeSelectionButton
                clientId={client.id}
                disabled={!!selectionRun && isActiveRun(selectionRun)}
                hasActiveBbm={hasActiveBbm}
              />
              <Button asChild variant="ghost" size="sm">
                <Link href={`/clients/${client.id}?tab=selection`}>
                  Selection
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" />
              Still Ads
              {draftCreatives > 0 && (
                <span className="text-muted-foreground text-sm font-normal">
                  {draftCreatives} to review
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LatestRunLine run={stillAdsRun} />
            {stillAdsRun && runCreativeCount(stillAdsRun.output_json) != null && (
              <p className="text-muted-foreground text-xs">
                {runCreativeCount(stillAdsRun.output_json)} creatives last run
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <RunStillAdsButton
                clientId={client.id}
                disabled={!!stillAdsRun && isActiveRun(stillAdsRun)}
                hasActiveBbm={hasActiveBbm}
                hasSelectedWinner={selectedWinners > 0}
                readiness={readiness}
                planPending={planReviewPending}
              />
              <Button asChild variant="ghost" size="sm">
                <Link href={`/clients/${client.id}?tab=creatives`}>
                  Creatives
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
