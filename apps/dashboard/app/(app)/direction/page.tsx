import { Eye } from "lucide-react";
import {
  CreativeDirectiveSchema,
  REFERENCE_LIBRARY_BUCKET,
  SeedVertical,
  type CreativeDirective,
} from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompiledPreview } from "@/lib/directives";
import { signMany } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { BriefEditor, type PickerReference } from "./brief-editor";
import { VersionHistory } from "./version-history";

const DEFAULT_VERTICAL = "coaching" as const;

export default async function DirectionPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string; preview?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [directivesResult, referencesResult, clientsResult] = await Promise.all([
    supabase
      .from("creative_directives")
      .select("*")
      .order("version", { ascending: false }),
    supabase
      .from("reference_library")
      .select("id, title, storage_path")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name, vertical").order("name"),
  ]);

  const directives = (directivesResult.data ?? []).map((row) =>
    CreativeDirectiveSchema.parse(row),
  );
  const agencyVersions = directives.filter((d) => d.scope === "agency");
  const verticalVersions = new Map<string, CreativeDirective[]>();
  for (const d of directives) {
    if (d.scope !== "vertical" || !d.vertical) continue;
    const list = verticalVersions.get(d.vertical);
    if (list) list.push(d);
    else verticalVersions.set(d.vertical, [d]);
  }
  // A vertical requested via ?vertical= gets an empty editor.
  const requestedVertical = SeedVertical.safeParse(params.vertical);
  if (requestedVertical.success && !verticalVersions.has(requestedVertical.data)) {
    verticalVersions.set(requestedVertical.data, []);
  }
  const unusedVerticals = SeedVertical.options.filter(
    (v) => !verticalVersions.has(v),
  );

  // Reference picker thumbnails (signed, small grid).
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

  // Compiled preview for the selected client.
  const clients = clientsResult.data ?? [];
  const previewClient = clients.find((c) => c.id === params.preview) ?? null;
  const preview = previewClient
    ? await getCompiledPreview(
        supabase,
        previewClient.id,
        previewClient.vertical ?? DEFAULT_VERTICAL,
      )
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Creative Direction</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Standing briefs every generation agent obeys. Precedence: client &gt;
        vertical &gt; agency — hard rules and references union across levels,
        so a NEVER set here applies everywhere.
      </p>

      <section className="mt-6 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Agency brief</h2>
          <VersionHistory title="Agency brief" versions={agencyVersions} />
        </div>
        <BriefEditor
          title="Agency-wide"
          scope="agency"
          currentVersion={agencyVersions.find((d) => d.is_active)?.version ?? null}
          initial={agencyVersions.find((d) => d.is_active)?.sections ?? {}}
          references={pickerReferences}
        />
      </section>

      {[...verticalVersions.entries()].map(([vertical, versions]) => (
        <section key={vertical} className="mt-8 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold capitalize">{vertical} vertical brief</h2>
            <VersionHistory title={`${vertical} vertical brief`} versions={versions} />
          </div>
          <BriefEditor
            title={`Applies to every ${vertical} client`}
            scope="vertical"
            vertical={vertical as SeedVertical}
            currentVersion={versions.find((d) => d.is_active)?.version ?? null}
            initial={versions.find((d) => d.is_active)?.sections ?? {}}
            references={pickerReferences}
          />
        </section>
      ))}

      {unusedVerticals.length > 0 && (
        <form method="GET" className="mt-6 flex items-center gap-2">
          {params.preview && (
            <input type="hidden" name="preview" value={params.preview} />
          )}
          <select
            name="vertical"
            defaultValue=""
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            aria-label="Add vertical brief"
          >
            <option value="" disabled>
              Add a vertical brief…
            </option>
            {unusedVerticals.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            Open editor
          </Button>
        </form>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Compiled preview</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Exactly what the concept agent and image compiler will read for a
          client — same compiler, byte for byte.
        </p>
        <form method="GET" className="mt-3 flex items-center gap-2">
          {params.vertical && (
            <input type="hidden" name="vertical" value={params.vertical} />
          )}
          <select
            name="preview"
            defaultValue={previewClient?.id ?? ""}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            aria-label="Preview client"
          >
            <option value="" disabled>
              Choose a client…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.vertical ?? DEFAULT_VERTICAL})
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            <Eye />
            Preview
          </Button>
        </form>
        {preview && (
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-sm">
                {previewClient!.name} — sources:{" "}
                {Object.entries(preview.compiled.sources)
                  .map(([scope, version]) => `${scope} v${version}`)
                  .join(", ") || "none"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-muted-foreground text-xs whitespace-pre-wrap">
                {preview.text}
              </pre>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
