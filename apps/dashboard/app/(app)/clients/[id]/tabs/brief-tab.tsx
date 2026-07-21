import Link from "next/link";
import { Compass } from "lucide-react";
import {
  BriefSuggestionSchema,
  CreativeDirectiveSchema,
  REFERENCE_LIBRARY_BUCKET,
  type Client,
} from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompiledPreview } from "@/lib/directives";
import { signMany } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { BriefEditor, type PickerReference } from "../../../direction/brief-editor";
import { VersionHistory } from "../../../direction/version-history";
import { SuggestButton } from "../brief/suggest-button";
import { SuggestionCard } from "../brief/suggestion-card";

const DEFAULT_VERTICAL = "coaching" as const;

export async function BriefTab({ client }: { client: Client }) {
  const supabase = await createClient();
  const [versionsResult, suggestionsResult, referencesResult, runResult] =
    await Promise.all([
      supabase
        .from("creative_directives")
        .select("*")
        .eq("scope", "client")
        .eq("client_id", client.id)
        .order("version", { ascending: false }),
      supabase
        .from("brief_suggestions")
        .select("*")
        .eq("client_id", client.id)
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
        .eq("client_id", client.id)
        .eq("type", "brief_suggestions")
        .in("status", ["queued", "running"])
        .limit(1),
    ]);

  const versions = (versionsResult.data ?? []).map((row) =>
    CreativeDirectiveSchema.parse(row),
  );
  const active = versions.find((v) => v.is_active) ?? null;
  const suggestions = (suggestionsResult.data ?? []).map((row) =>
    BriefSuggestionSchema.parse(row),
  );
  const suggestRunActive = (runResult.data?.length ?? 0) > 0;

  const refRows = referencesResult.data ?? [];
  const signed = await signMany(
    REFERENCE_LIBRARY_BUCKET,
    refRows.map((r) => r.storage_path),
    { thumbWidth: 320 },
  );
  const pickerReferences: PickerReference[] = refRows.map((r) => ({
    id: r.id,
    title: r.title,
    url: signed.get(r.storage_path)?.thumbUrl ?? null,
  }));

  const preview = await getCompiledPreview(
    supabase,
    client.id,
    client.vertical ?? DEFAULT_VERTICAL,
  );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Creative brief</h2>
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
          <h3 className="text-lg font-semibold">
            Suggested brief updates ({suggestions.length})
          </h3>
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
          <h3 className="text-lg font-semibold">Client brief</h3>
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
        <h3 className="text-lg font-semibold">Compiled direction</h3>
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
