import Link from "next/link";
import { Trophy } from "lucide-react";
import {
  CreativeSchema,
  CREATIVES_BUCKET,
  WinningCreativeSchema,
  type Client,
  type Creative,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ReviewKeysHint, ReviewKeysProvider } from "@/components/review-keys";
import { signMany } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { CreativeCard } from "../creatives/creative-card";
import { RunStillAdsButton } from "../run-still-ads-button";
import {
  isActiveRun,
  RUN_ROW_COLUMNS,
  RunRowSchema,
  runConceptCount,
  runCreativeCount,
  RunsTable,
} from "../run-tables";

type SearchParams = Record<string, string | string[] | undefined>;
type Filters = { avatar?: string; framework?: string; status?: string };

function parseFilters(sp: SearchParams): Filters {
  const pick = (key: keyof Filters) =>
    typeof sp[key] === "string" && sp[key] ? (sp[key] as string) : undefined;
  return { avatar: pick("avatar"), framework: pick("framework"), status: pick("status") };
}

function filterHref(clientId: string, current: Filters, patch: Filters): string {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams({ tab: "creatives" });
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  return `/clients/${clientId}?${params}`;
}

function FilterRow({
  label,
  values,
  active,
  hrefFor,
}: {
  label: string;
  values: string[];
  active?: string;
  hrefFor: (value?: string) => string;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium uppercase">
        {label}
      </span>
      <Badge asChild variant={active ? "outline" : "default"}>
        <Link href={hrefFor(undefined)}>All</Link>
      </Badge>
      {values.map((value) => (
        <Badge asChild key={value} variant={active === value ? "default" : "outline"}>
          <Link href={hrefFor(value)}>{value}</Link>
        </Badge>
      ))}
    </div>
  );
}

export async function CreativesTab({
  client,
  searchParams,
}: {
  client: Client;
  searchParams: SearchParams;
}) {
  const filters = parseFilters(searchParams);
  const supabase = await createClient();

  const [runsResult, activeBbmResult, winnersResult, creativesResult, winningResult] =
    await Promise.all([
      supabase
        .from("runs")
        .select(RUN_ROW_COLUMNS)
        .eq("client_id", client.id)
        .eq("type", "still_ads")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("bbm_versions")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .eq("is_active", true),
      supabase
        .from("ad_candidates")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .eq("status", "selected"),
      supabase
        .from("creatives")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("winning_creatives")
        .select("*")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
    ]);

  const stillAdsRuns = (runsResult.data ?? []).map((row) => RunRowSchema.parse(row));
  const hasActiveBbm = (activeBbmResult.count ?? 0) > 0;
  const selectedWinners = winnersResult.count ?? 0;
  const hasActiveStillAdsRun = stillAdsRuns.some(isActiveRun);
  const all = (creativesResult.data ?? []).map((row) => CreativeSchema.parse(row));
  const winning = (winningResult.data ?? []).map((row) => WinningCreativeSchema.parse(row));

  const avatars = [...new Set(all.map((c) => c.avatar).filter((v): v is string => !!v))];
  const frameworks = [
    ...new Set(all.map((c) => c.framework).filter((v): v is string => !!v)),
  ];

  const creatives = all.filter(
    (c) =>
      (!filters.avatar || c.avatar === filters.avatar) &&
      (!filters.framework || c.framework === filters.framework) &&
      (!filters.status || c.status === filters.status),
  );

  // One signed batch (full-res) + per-image thumbnail fan-out for the grid.
  const paths = creatives.flatMap((c) => [
    ...(c.storage_path ? [c.storage_path] : []),
    ...(c.aspect_files ?? []).map((f) => f.storage_path),
  ]);
  const signed = await signMany(CREATIVES_BUCKET, paths);

  const aspectUrls = (creative: Creative): [string, string][] =>
    (creative.aspect_files ?? [])
      .map((f): [string, string | undefined] => [f.aspect, signed.get(f.storage_path)?.url])
      .filter((pair): pair is [string, string] => !!pair[1]);

  const drafts = creatives.filter((c) => c.status === "draft").length;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Still Ads</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Generated still ads — approve winners into the Winning Creative
            Doc, reject with feedback the next run learns from.
            {drafts > 0 && ` ${drafts} awaiting review.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {winning.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Trophy className="size-3" />
              {winning.length} in the Winning Doc
            </Badge>
          )}
          <RunStillAdsButton
            clientId={client.id}
            disabled={hasActiveStillAdsRun}
            hasActiveBbm={hasActiveBbm}
            hasSelectedWinner={selectedWinners > 0}
          />
        </div>
      </div>

      {stillAdsRuns.length > 0 && (
        <RunsTable
          runs={stillAdsRuns}
          detailHead="Result"
          detail={(run) => {
            const count = runCreativeCount(run.output_json);
            const concepts = runConceptCount(run.input_json);
            return count != null
              ? `${count} creatives`
              : concepts != null
                ? `${concepts} concepts`
                : "—";
          }}
        />
      )}

      {all.length > 0 && (
        <div className="bg-background/95 sticky top-0 z-10 mt-5 flex flex-col gap-2 py-2 backdrop-blur">
          <FilterRow
            label="Status"
            values={["draft", "approved", "rejected"]}
            active={filters.status}
            hrefFor={(v) => filterHref(client.id, filters, { status: v })}
          />
          <FilterRow
            label="Avatar"
            values={avatars}
            active={filters.avatar}
            hrefFor={(v) => filterHref(client.id, filters, { avatar: v })}
          />
          <FilterRow
            label="Format"
            values={frameworks}
            active={filters.framework}
            hrefFor={(v) => filterHref(client.id, filters, { framework: v })}
          />
        </div>
      )}

      {creatives.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            {all.length === 0
              ? "No creatives yet — run Still Ads above."
              : "Nothing matches these filters."}
          </CardContent>
        </Card>
      ) : (
        <ReviewKeysProvider>
          <div className="mt-4">
            <ReviewKeysHint />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {creatives.map((creative) => {
              const primary = creative.storage_path
                ? signed.get(creative.storage_path)
                : undefined;
              return (
                <CreativeCard
                  key={creative.id}
                  creative={creative}
                  previewUrl={primary?.thumbUrl ?? null}
                  fullUrl={primary?.url ?? null}
                  aspectUrls={aspectUrls(creative)}
                />
              );
            })}
          </div>
        </ReviewKeysProvider>
      )}

      {winning.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Trophy className="size-4" />
            Winning Creative Doc
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            What worked for {client.name} — future concept rounds build on this.
          </p>
          <Card className="mt-3">
            <CardContent className="divide-y px-4 py-1">
              {winning.map((win) => (
                <div key={win.id} className="py-3 text-sm">
                  <p>{win.concept_summary}</p>
                  {win.why_approved && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {win.why_approved}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
