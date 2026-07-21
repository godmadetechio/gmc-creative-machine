import Link from "next/link";
import { Archive } from "lucide-react";
import {
  REFERENCE_LIBRARY_BUCKET,
  ReferenceLibraryEntrySchema,
  type ReferenceLibraryEntry,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { ReferenceCard } from "./reference-card";
import { ReferenceUploader } from "./reference-uploader";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

type Filters = { tag?: string; vertical?: string; format?: string; archived?: string };

function filterHref(current: Filters, patch: Filters): string {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return `/swipe-file${qs ? `?${qs}` : ""}`;
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

export default async function SwipeFilePage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;
  const showArchived = filters.archived === "1";

  const supabase = await createClient();
  const [referencesResult, formatsResult] = await Promise.all([
    supabase
      .from("reference_library")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("format_library")
      .select("name")
      .eq("status", "active")
      .order("name"),
  ]);

  const all = (referencesResult.data ?? []).map((row) =>
    ReferenceLibraryEntrySchema.parse(row),
  );
  const formatNames = (formatsResult.data ?? []).map((row) => row.name as string);

  const tags = [...new Set(all.flatMap((r) => r.tags))].sort();
  const verticals: string[] = [
    ...new Set(all.flatMap((r) => (r.vertical ? [r.vertical] : []))),
  ];
  const formats = [
    ...new Set(all.map((r) => r.format_name).filter((v): v is string => !!v)),
  ];

  const references = all.filter(
    (r) =>
      (showArchived ? true : r.status === "active") &&
      (!filters.tag || r.tags.includes(filters.tag)) &&
      (!filters.vertical || r.vertical === filters.vertical) &&
      (!filters.format || r.format_name === filters.format),
  );
  const archivedCount = all.filter((r) => r.status === "archived").length;

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

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Swipe File</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The agency-wide reference library — curated style references every
            client can pick from. Notes are the brief the concept agent reads:
            what to take, what to ignore, when to use it.
          </p>
        </div>
        {archivedCount > 0 && (
          <Button asChild variant="outline" size="sm">
            <Link
              href={filterHref(filters, { archived: showArchived ? undefined : "1" })}
            >
              <Archive />
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </Link>
          </Button>
        )}
      </div>

      <div className="mt-6">
        <ReferenceUploader />
      </div>

      {all.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          <FilterRow
            label="Tag"
            values={tags}
            active={filters.tag}
            hrefFor={(v) => filterHref(filters, { tag: v })}
          />
          <FilterRow
            label="Vertical"
            values={verticals}
            active={filters.vertical}
            hrefFor={(v) => filterHref(filters, { vertical: v })}
          />
          <FilterRow
            label="Format"
            values={formats}
            active={filters.format}
            hrefFor={(v) => filterHref(filters, { format: v })}
          />
        </div>
      )}

      {references.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            {all.length === 0
              ? "Nothing in the swipe file yet — upload the ads worth stealing from."
              : "Nothing matches these filters."}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {references.map((reference: ReferenceLibraryEntry) => (
            <ReferenceCard
              key={reference.id}
              reference={reference}
              previewUrl={urlByPath.get(reference.storage_path) ?? null}
              formatNames={formatNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}
