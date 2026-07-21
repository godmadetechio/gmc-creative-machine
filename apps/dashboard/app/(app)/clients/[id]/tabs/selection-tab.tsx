import Link from "next/link";
import { Archive } from "lucide-react";
import { AdCandidateSchema, type AdCandidate, type Client } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaginationBar } from "@/components/pagination-bar";
import { SearchInput } from "@/components/search-input";
import { ilikePattern, PAGE_SIZE, parsePageParams } from "@/lib/pagination";
import { adMediaThumbUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { CandidateCard } from "../candidates/candidate-card";
import { RunCreativeSelectionButton } from "../run-creative-selection-button";
import {
  isActiveRun,
  RUN_ROW_COLUMNS,
  RunRowSchema,
  runCandidateCount,
  runCountry,
  RunsTable,
} from "../run-tables";

type SearchParams = Record<string, string | string[] | undefined>;

// Prefer the mirrored (Storage) copy for previews — the original fbcdn URLs
// are signed and expire. Grid previews use the width-transformed public
// render endpoint.
function mirroredPreview(candidate: AdCandidate): string | undefined {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return undefined;
  const image = (candidate.media_storage_paths ?? []).find(
    (m) => !/\.(mp4|webm)$/i.test(m.storage_path),
  );
  return image ? adMediaThumbUrl(supabaseUrl, image.storage_path) : undefined;
}

function CandidateGrid({ candidates }: { candidates: AdCandidate[] }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          mirroredPreviewUrl={mirroredPreview(candidate)}
        />
      ))}
    </div>
  );
}

export async function SelectionTab({
  client,
  searchParams,
}: {
  client: Client;
  searchParams: SearchParams;
}) {
  const showSuperseded = searchParams.superseded === "1";
  const { page, q, from, to } = parsePageParams(searchParams);
  const supabase = await createClient();

  let pendingQuery = supabase
    .from("ad_candidates")
    .select("*", { count: "exact" })
    .eq("client_id", client.id)
    .eq("status", "candidate")
    .order("match_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) pendingQuery = pendingQuery.ilike("advertiser", ilikePattern(q));

  const [runsResult, activeBbmResult, pendingResult, reviewedResult, supersededResult] =
    await Promise.all([
      supabase
        .from("runs")
        .select(RUN_ROW_COLUMNS)
        .eq("client_id", client.id)
        .eq("type", "creative_selection")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("bbm_versions")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .eq("is_active", true),
      pendingQuery,
      supabase
        .from("ad_candidates")
        .select("*", { count: "exact" })
        .eq("client_id", client.id)
        .in("status", ["selected", "rejected"])
        .order("match_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
      showSuperseded
        ? supabase
            .from("ad_candidates")
            .select("*", { count: "exact" })
            .eq("client_id", client.id)
            .eq("status", "superseded")
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE)
        : supabase
            .from("ad_candidates")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("status", "superseded"),
    ]);

  const selectionRuns = (runsResult.data ?? []).map((row) => RunRowSchema.parse(row));
  const hasActiveBbm = (activeBbmResult.count ?? 0) > 0;
  const hasActiveSelectionRun = selectionRuns.some(isActiveRun);
  const pending = (pendingResult.data ?? []).map((row) => AdCandidateSchema.parse(row));
  const pendingCount = pendingResult.count ?? pending.length;
  const reviewed = (reviewedResult.data ?? []).map((row) => AdCandidateSchema.parse(row));
  const reviewedCount = reviewedResult.count ?? reviewed.length;
  const superseded = showSuperseded
    ? (supersededResult.data ?? []).map((row) => AdCandidateSchema.parse(row))
    : [];
  const supersededCount = supersededResult.count ?? 0;

  // Breadth review: group by advertiser so the queue reads as "each
  // creator's best ~3". Rows arrive score-desc, so each group's first ad is
  // its best; groups are ordered by that best score. Grouping happens
  // within the current page — a large advertiser can continue on the next.
  const groups = new Map<string, AdCandidate[]>();
  for (const candidate of pending) {
    const key = candidate.advertiser ?? "Unknown advertiser";
    const list = groups.get(key);
    if (list) list.push(candidate);
    else groups.set(key, [candidate]);
  }
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => (b[1][0]?.match_score ?? 0) - (a[1][0]?.match_score ?? 0),
  );

  const makeHref = (nextPage: number, patch: { superseded?: boolean } = {}) => {
    const params = new URLSearchParams({ tab: "selection" });
    if (q) params.set("q", q);
    if (nextPage > 1) params.set("page", String(nextPage));
    if (patch.superseded ?? showSuperseded) params.set("superseded", "1");
    return `/clients/${client.id}?${params}`;
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Creative Selection</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Competitor ads scored against the Buyer Brain Matrix, grouped by
            advertiser — select the winners worth rebuilding, reject the rest.
          </p>
        </div>
        <RunCreativeSelectionButton
          clientId={client.id}
          disabled={hasActiveSelectionRun}
          hasActiveBbm={hasActiveBbm}
        />
      </div>

      {selectionRuns.length === 0 ? (
        <Card className="mt-3">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No Creative Selection runs yet.
            {hasActiveBbm
              ? " Kick one off to scout competitor ads against the BBM."
              : " Build a Buyer Brain Matrix first — it is the lens ads are scored through."}
          </CardContent>
        </Card>
      ) : (
        <RunsTable
          runs={selectionRuns}
          detailHead="Result"
          detail={(run) => {
            const count = runCandidateCount(run.output_json);
            return count != null
              ? `${count} candidates (${runCountry(run.input_json)})`
              : runCountry(run.input_json);
          }}
        />
      )}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Pending review ({pendingCount} ads
          {q && ` matching "${q}"`})
        </h2>
        <div className="flex items-center gap-2">
          <SearchInput placeholder="Search advertisers…" />
          {supersededCount > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href={makeHref(1, { superseded: !showSuperseded })}>
                <Archive />
                {showSuperseded
                  ? "Hide superseded"
                  : `Show superseded (${supersededCount})`}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {pending.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {pendingCount === 0 && !q
            ? "All caught up — nothing waiting for review."
            : "Nothing on this page — adjust the search or go back a page."}
        </p>
      ) : (
        sortedGroups.map(([advertiser, ads]) => (
          <section key={advertiser} className="mt-6">
            <h3 className="flex items-baseline gap-2 font-medium">
              {advertiser}
              <span className="text-muted-foreground text-sm font-normal">
                {ads.length} {ads.length === 1 ? "ad" : "ads"} · top score{" "}
                {ads[0]?.match_score ?? "—"}
              </span>
            </h3>
            <CandidateGrid candidates={ads} />
          </section>
        ))
      )}
      <div className="mt-4">
        <PaginationBar
          page={page}
          totalCount={pendingCount}
          makeHref={(p) => makeHref(p)}
          label="pending ads"
        />
      </div>

      {reviewed.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">
            Reviewed ({reviewedCount})
            {reviewedCount > reviewed.length && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                showing the latest {reviewed.length}
              </span>
            )}
          </h2>
          <CandidateGrid candidates={reviewed} />
        </>
      )}

      {showSuperseded && superseded.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">
            Superseded ({supersededCount})
            {supersededCount > superseded.length && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                showing the latest {superseded.length}
              </span>
            )}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Unreviewed candidates archived by a newer run. Restore one to put
            it back in the queue.
          </p>
          <CandidateGrid candidates={superseded} />
        </>
      )}
    </div>
  );
}
