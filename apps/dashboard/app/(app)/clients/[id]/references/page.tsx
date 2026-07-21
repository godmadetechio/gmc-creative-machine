import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GalleryHorizontalEnd } from "lucide-react";
import { z } from "zod";
import {
  ClientReferencePickSchema,
  ClientSchema,
  REFERENCE_LIBRARY_BUCKET,
  ReferenceLibraryEntrySchema,
} from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { ReferencePickCard } from "./reference-pick-card";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function ClientReferencesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [clientResult, referencesResult, picksResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("reference_library")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase.from("client_reference_picks").select("*").eq("client_id", id),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const references = (referencesResult.data ?? []).map((row) =>
    ReferenceLibraryEntrySchema.parse(row),
  );
  const picks = (picksResult.data ?? []).map((row) =>
    ClientReferencePickSchema.parse(row),
  );
  const pickByReference = new Map(picks.map((p) => [p.reference_id, p]));

  const urlByPath = new Map<string, string>();
  const paths = references.map((r) => r.storage_path);
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(REFERENCE_LIBRARY_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
  }

  // Picked first so the client's active set reads at a glance.
  const sorted = [...references].sort(
    (a, b) =>
      Number(pickByReference.has(b.id)) - Number(pickByReference.has(a.id)),
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
          <h1 className="text-2xl font-bold tracking-tight">References</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pick which swipe-file references {client.name}&apos;s generation
            runs use as style references ({picks.length} picked). Add new ones
            in the global Swipe File.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/swipe-file">
            <GalleryHorizontalEnd />
            Open Swipe File
          </Link>
        </Button>
      </div>

      {references.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            The swipe file is empty — upload agency references there first.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {sorted.map((reference) => {
            const pick = pickByReference.get(reference.id);
            return (
              <ReferencePickCard
                key={reference.id}
                clientId={client.id}
                reference={reference}
                previewUrl={urlByPath.get(reference.storage_path) ?? null}
                picked={!!pick}
                noteOverride={pick?.note_override ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
