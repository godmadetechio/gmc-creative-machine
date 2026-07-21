import Link from "next/link";
import { Archive, CheckCircle2, Loader2, ScanEye, Sparkles } from "lucide-react";
import { z } from "zod";
import {
  REFERENCE_LIBRARY_BUCKET,
  ReferenceLibraryEntrySchema,
  type ReferenceLibraryEntry,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AutoRefresh } from "@/components/auto-refresh";
import { signMany } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { AnnotateButton } from "./annotate-button";
import { ReferenceCard } from "./reference-card";
import { ReferenceUploader } from "./reference-uploader";


type Filters = {
  tag?: string;
  vertical?: string;
  format?: string;
  status?: string;
  archived?: string;
};

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
  const [referencesResult, formatsResult, annotateRunResult] = await Promise.all([
    supabase
      .from("reference_library")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("format_library")
      .select("name")
      .eq("status", "active")
      .order("name"),
    supabase
      .from("runs")
      .select("id, status, started_at, input_json")
      .eq("type", "reference_annotate")
      .in("status", ["queued", "running"])
      .limit(1),
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

  const references = all
    .filter(
      (r) =>
        (showArchived ? true : r.status !== "archived") &&
        (!filters.status || r.status === filters.status) &&
        (!filters.tag || r.tags.includes(filters.tag)) &&
        (!filters.vertical || r.vertical === filters.vertical) &&
        (!filters.format || r.format_name === filters.format),
    )
    // AI drafts awaiting review float to the top of the grid.
    .sort(
      (a, b) =>
        Number(b.status === "needs_review") - Number(a.status === "needs_review"),
    );
  const archivedCount = all.filter((r) => r.status === "archived").length;
  const needsReviewCount = all.filter((r) => r.status === "needs_review").length;
  const unannotatedCount = all.filter(
    (r) => r.annotation_source === null && r.status !== "archived",
  ).length;
  // Approved = in the pool clients pick from, with reviewed notes (human-
  // written or accepted-AI).
  const approvedCount = all.filter(
    (r) => r.status === "active" && r.annotation_source !== null,
  ).length;

  // Live run progress: rows the active run has annotated so far (stamped
  // annotated_at after the run started) vs what it set out to do.
  const annotateRun = annotateRunResult.data?.[0] ?? null;
  const annotateRunActive = annotateRun !== null;
  let runProgress: { done: number; total: number } | null = null;
  if (annotateRun?.started_at) {
    const startedAt = annotateRun.started_at as string;
    const limitParsed = z
      .object({ limit: z.number().int() })
      .safeParse(annotateRun.input_json);
    const limit = limitParsed.success ? limitParsed.data.limit : 40;
    const done = all.filter(
      (r) =>
        r.annotation_source === "ai" &&
        r.annotated_at !== null &&
        r.annotated_at > startedAt,
    ).length;
    runProgress = { done, total: Math.min(limit, done + unannotatedCount) };
  }

  // Grid previews are width-transformed thumbnails; full-res stays a click
  // away via the card's source link.
  const signed = await signMany(
    REFERENCE_LIBRARY_BUCKET,
    references.map((r) => r.storage_path),
  );

  return (
    <div>
      <AutoRefresh active={annotateRunActive} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Swipe File</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The agency-wide reference library — curated style references every
            client can pick from. Notes are the brief the concept agent reads:
            what to take, what to ignore, when to use it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnnotateButton
            unannotatedCount={unannotatedCount}
            runActive={annotateRunActive}
          />
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
      </div>

      {/* Annotation status strip */}
      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-2.5 py-1">
          <ScanEye className="size-3.5" />
          {unannotatedCount} unannotated
        </span>
        <Link
          href={filterHref(filters, {
            status: filters.status === "needs_review" ? undefined : "needs_review",
          })}
          className={
            filters.status === "needs_review"
              ? "inline-flex items-center gap-1.5 rounded-md bg-amber-500/90 px-2.5 py-1 text-white"
              : "inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1 text-amber-500 hover:bg-amber-500/25"
          }
        >
          <Sparkles className="size-3.5" />
          {needsReviewCount} AI notes to review
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 text-emerald-500">
          <CheckCircle2 className="size-3.5" />
          {approvedCount} approved
        </span>
        {annotateRunActive && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            {runProgress
              ? `annotation run in progress: ${runProgress.done} of ${runProgress.total} done`
              : "annotation run queued…"}
          </span>
        )}
      </div>

      <div className="mt-6">
        <ReferenceUploader />
      </div>

      {all.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          <FilterRow
            label="Status"
            values={["needs_review"]}
            active={filters.status}
            hrefFor={(v) => filterHref(filters, { status: v })}
          />
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
              previewUrl={signed.get(reference.storage_path)?.thumbUrl ?? null}
              formatNames={formatNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}
