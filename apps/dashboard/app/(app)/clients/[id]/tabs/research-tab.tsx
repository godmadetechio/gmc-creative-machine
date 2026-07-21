import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { CompetitorSchema, type Client } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaginationBar } from "@/components/pagination-bar";
import { SearchInput } from "@/components/search-input";
import { ilikePattern, parsePageParams } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { CompetitorsCard } from "../competitors-card";
import { RunBuyerBrainButton } from "../run-buyer-brain-button";
import {
  isActiveRun,
  RUN_ROW_COLUMNS,
  RunRowSchema,
  runDepth,
  RunsTable,
} from "../run-tables";

type SearchParams = Record<string, string | string[] | undefined>;

export async function ResearchTab({
  client,
  searchParams,
}: {
  client: Client;
  searchParams: SearchParams;
}) {
  const { page, q, from, to } = parsePageParams(searchParams);
  const supabase = await createClient();

  let competitorsQuery = supabase
    .from("competitors")
    .select("*", { count: "exact" })
    .eq("client_id", client.id)
    .order("status", { ascending: true })
    .order("created_at", { ascending: true })
    .range(from, to);
  if (q) competitorsQuery = competitorsQuery.ilike("name", ilikePattern(q));

  const [runsResult, bbmResult, competitorsResult] = await Promise.all([
    supabase
      .from("runs")
      .select(RUN_ROW_COLUMNS)
      .eq("client_id", client.id)
      .eq("type", "buyer_brain")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("bbm_versions")
      .select("version")
      .eq("client_id", client.id)
      .order("version", { ascending: false })
      .limit(1),
    competitorsQuery,
  ]);

  const bbmRuns = (runsResult.data ?? []).map((row) => RunRowSchema.parse(row));
  const latestBbm = bbmResult.data?.[0] ?? null;
  const competitors = (competitorsResult.data ?? []).map((row) =>
    CompetitorSchema.parse(row),
  );
  const competitorCount = competitorsResult.count ?? competitors.length;
  const hasActiveBbmRun = bbmRuns.some(isActiveRun);

  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams({ tab: "research" });
    if (q) params.set("q", q);
    if (nextPage > 1) params.set("page", String(nextPage));
    return `/clients/${client.id}?${params}`;
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Buyer Brain</h2>
          {latestBbm && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/clients/${client.id}/bbm`}>
                <BookOpenText />
                View BBM (v{latestBbm.version})
              </Link>
            </Button>
          )}
        </div>
        <RunBuyerBrainButton clientId={client.id} disabled={hasActiveBbmRun} />
      </div>

      {bbmRuns.length === 0 ? (
        <Card className="mt-3">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No Buyer Brain runs yet. Kick one off to build the first matrix.
          </CardContent>
        </Card>
      ) : (
        <RunsTable
          runs={bbmRuns}
          detailHead="Depth"
          detail={(run) => runDepth(run.input_json)}
        />
      )}

      <div className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Competitors</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Scouted automatically on each Creative Selection run, or added by
              hand. Ignored competitors are never searched.
            </p>
          </div>
          <SearchInput placeholder="Search competitors…" />
        </div>
        <CompetitorsCard clientId={client.id} competitors={competitors} />
        <div className="mt-3">
          <PaginationBar
            page={page}
            totalCount={competitorCount}
            makeHref={makeHref}
            label="competitors"
          />
        </div>
      </div>
    </div>
  );
}
