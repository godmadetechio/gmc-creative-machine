import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Compass } from "lucide-react";
import { z } from "zod";
import {
  BriefSuggestionSchema,
  ClientSchema,
  CreativeDirectiveSchema,
  REFERENCE_LIBRARY_BUCKET,
} from "@gmc/shared";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompiledPreview } from "@/lib/directives";
import { createClient } from "@/lib/supabase/server";
import { BriefEditor, type PickerReference } from "../../../direction/brief-editor";
import { VersionHistory } from "../../../direction/version-history";
import { SuggestButton } from "./suggest-button";
import { SuggestionCard } from "./suggestion-card";

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const DEFAULT_VERTICAL = "coaching" as const;

export default async function ClientBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [clientResult, versionsResult, suggestionsResult, referencesResult, runResult] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("creative_directives")
        .select("*")
        .eq("scope", "client")
        .eq("client_id", id)
        .order("version", { ascending: false }),
      supabase
        .from("brief_suggestions")
        .select("*")
        .eq("client_id", id)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("reference_library")
        .select("id, title, storage_path")
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      supabase
        .from("runs")
        .select("id")
        .eq("client_id", id)
        .eq("type", "brief_suggestions")
        .in("status", ["queued", "running"])
        .limit(1),
    ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const versions = (versionsResult.data ?? []).map((row) =>
    CreativeDirectiveSchema.parse(row),
  );
  const active = versions.find((v) => v.is_active) ?? null;
  const suggestions = (suggestionsResult.data ?? []).map((row) =>
    BriefSuggestionSchema.parse(row),
  );
  const suggestRunActive = (runResult.data?.length ?? 0) > 0;

  const refRows = referencesResult.data ?? [];
  const urlByPath = new Map<string, string>();
  if (refRows.length > 0) {
    const { data: signed } = await supabase.storage
      .from(REFERENCE_LIBRARY_BUCKET)
      .createSignedUrls(
        refRows.map((r) => r.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
  }
  const pickerReferences: PickerReference[] = refRows.map((r) => ({
    id: r.id,
    title: r.title,
    url: urlByPath.get(r.storage_path) ?? null,
  }));

  const preview = await getCompiledPreview(
    supabase,
    client.id,
    client.vertical ?? DEFAULT_VERTICAL,
  );

  return (
    <div>
      <AutoRefresh active={suggestRunActive} />
      <Link
        href={`/clients/${client.id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        {client.name}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Creative brief</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Client-level standing orders — layered on top of the{" "}
            {client.vertical ?? DEFAULT_VERTICAL} vertical and agency briefs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SuggestButton clientId={client.id} runActive={suggestRunActive} />
          <Button asChild variant="outline" size="sm">
            <Link href="/direction">
              <Compass />
              Agency direction
            </Link>
          </Button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">
            Suggested brief updates ({suggestions.length})
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Drafted from rejection feedback — each acceptance creates a new
            brief version. Nothing applies without your click.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {suggestions.map((suggestion) => (
              <SuggestionCard key={suggestion.id} suggestion={suggestion} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Client brief</h2>
          <VersionHistory title={`${client.name} brief`} versions={versions} />
        </div>
        <BriefEditor
          title={client.name}
          scope="client"
          clientId={client.id}
          currentVersion={active?.version ?? null}
          initial={active?.sections ?? {}}
          references={pickerReferences}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Compiled direction</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Exactly what the generation agents read for {client.name} — sources:{" "}
          {Object.entries(preview.compiled.sources)
            .map(([scope, version]) => `${scope} v${version}`)
            .join(", ") || "none yet"}
          .
        </p>
        <Card className="mt-3">
          <CardHeader>
            <CardTitle className="text-sm">CREATIVE DIRECTION</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-muted-foreground text-xs whitespace-pre-wrap">
              {preview.text}
            </pre>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
