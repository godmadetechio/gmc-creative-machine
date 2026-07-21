import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  GalleryVerticalEnd,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { type Client } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunStatusBadge } from "@/components/run-status-badge";
import { relativeTime } from "@/lib/relative-time";
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
}): string {
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
            })}
          </p>
        </CardContent>
      </Card>

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
