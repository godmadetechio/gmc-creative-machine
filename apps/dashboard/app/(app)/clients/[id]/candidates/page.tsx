import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive } from "lucide-react";
import { z } from "zod";
import { AdCandidateSchema, ClientSchema, type AdCandidate } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { storagePublicUrl } from "@/lib/media-mirror";
import { createClient } from "@/lib/supabase/server";
import { CandidateCard } from "./candidate-card";

// Prefer the mirrored (Storage) copy for previews — the original fbcdn URLs
// are signed and expire, so mirrored winners keep rendering.
function mirroredPreview(candidate: AdCandidate): string | undefined {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return undefined;
  const image = (candidate.media_storage_paths ?? []).find(
    (m) => !/\.(mp4|webm)$/i.test(m.storage_path),
  );
  return image ? storagePublicUrl(supabaseUrl, image.storage_path) : undefined;
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

export default async function CandidatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ superseded?: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const showSuperseded = (await searchParams).superseded === "1";

  const supabase = await createClient();

  const [clientResult, candidatesResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("ad_candidates")
      .select("*")
      .eq("client_id", id)
      .order("match_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const candidates = (candidatesResult.data ?? []).map((row) =>
    AdCandidateSchema.parse(row),
  );

  const pending = candidates.filter((c) => c.status === "candidate");
  const reviewed = candidates.filter(
    (c) => c.status === "selected" || c.status === "rejected",
  );
  const superseded = candidates.filter((c) => c.status === "superseded");

  // Breadth review: group by advertiser so the queue reads as "each
  // creator's best ~3". Rows arrive score-desc, so each group's first ad is
  // its best; groups are ordered by that best score.
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

  return (
    <div>
      <Link
        href={`/clients/${client.id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        {client.name}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ad candidates</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Competitor ads scored against the Buyer Brain Matrix, grouped by
            advertiser — select the winners worth rebuilding, reject the rest.
          </p>
        </div>
        {superseded.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <Link
              href={
                showSuperseded
                  ? `/clients/${client.id}/candidates`
                  : `/clients/${client.id}/candidates?superseded=1`
              }
            >
              <Archive />
              {showSuperseded
                ? "Hide superseded"
                : `Show superseded (${superseded.length})`}
            </Link>
          </Button>
        )}
      </div>

      {candidates.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No ad candidates yet — run Creative Selection from the client page.
          </CardContent>
        </Card>
      ) : (
        <>
          <h2 className="mt-8 text-lg font-semibold">
            Pending review ({pending.length} ads · {sortedGroups.length}{" "}
            advertisers)
          </h2>
          {pending.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              All caught up — nothing waiting for review.
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

          {reviewed.length > 0 && (
            <>
              <h2 className="mt-10 text-lg font-semibold">
                Reviewed ({reviewed.length})
              </h2>
              <CandidateGrid candidates={reviewed} />
            </>
          )}

          {showSuperseded && superseded.length > 0 && (
            <>
              <h2 className="mt-10 text-lg font-semibold">
                Superseded ({superseded.length})
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Unreviewed candidates archived by a newer run. Restore one to
                put it back in the queue.
              </p>
              <CandidateGrid candidates={superseded} />
            </>
          )}
        </>
      )}
    </div>
  );
}
