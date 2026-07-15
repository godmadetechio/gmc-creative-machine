import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { AdCandidateSchema, ClientSchema, type AdCandidate } from "@gmc/shared";
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

export default async function CandidatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

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
  const reviewed = candidates.filter((c) => c.status !== "candidate");

  return (
    <div>
      <Link
        href={`/clients/${client.id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        {client.name}
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">Ad candidates</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Competitor ads scored against the Buyer Brain Matrix — select the
        winners worth rebuilding, reject the rest.
      </p>

      {candidates.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No ad candidates yet — run Creative Selection from the client page.
          </CardContent>
        </Card>
      ) : (
        <>
          <h2 className="mt-8 text-lg font-semibold">
            Pending review ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              All caught up — nothing waiting for review.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pending.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  mirroredPreviewUrl={mirroredPreview(candidate)}
                />
              ))}
            </div>
          )}

          {reviewed.length > 0 && (
            <>
              <h2 className="mt-10 text-lg font-semibold">
                Reviewed ({reviewed.length})
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {reviewed.map((candidate) => (
                  <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  mirroredPreviewUrl={mirroredPreview(candidate)}
                />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
