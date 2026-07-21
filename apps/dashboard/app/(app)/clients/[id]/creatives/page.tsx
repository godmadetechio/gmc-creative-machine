import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trophy } from "lucide-react";
import { z } from "zod";
import {
  ClientSchema,
  CreativeSchema,
  CREATIVES_BUCKET,
  WinningCreativeSchema,
  type Creative,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { CreativeCard } from "./creative-card";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

type Filters = { avatar?: string; framework?: string; status?: string };

function filterHref(clientId: string, current: Filters, patch: Filters): string {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return `/clients/${clientId}/creatives${qs ? `?${qs}` : ""}`;
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

export default async function CreativesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Filters>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const filters = await searchParams;

  const supabase = await createClient();
  const [clientResult, creativesResult, winningResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("creatives")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("winning_creatives")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const all = (creativesResult.data ?? []).map((row) => CreativeSchema.parse(row));
  const winning = (winningResult.data ?? []).map((row) =>
    WinningCreativeSchema.parse(row),
  );

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

  // One signed-URL batch for every file behind the filtered grid.
  const paths = [
    ...new Set(
      creatives.flatMap((c) => [
        ...(c.storage_path ? [c.storage_path] : []),
        ...(c.aspect_files ?? []).map((f) => f.storage_path),
      ]),
    ),
  ];
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(CREATIVES_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
  }

  const aspectUrls = (creative: Creative): [string, string][] =>
    (creative.aspect_files ?? [])
      .map((f): [string, string | undefined] => [f.aspect, urlByPath.get(f.storage_path)])
      .filter((pair): pair is [string, string] => !!pair[1]);

  const drafts = creatives.filter((c) => c.status === "draft").length;

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
          <h1 className="text-2xl font-bold tracking-tight">Creatives</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Generated still ads — approve winners into the Winning Creative
            Doc, reject with feedback the next run learns from.
            {drafts > 0 && ` ${drafts} awaiting review.`}
          </p>
        </div>
        {winning.length > 0 && (
          <Badge variant="secondary" className="gap-1">
            <Trophy className="size-3" />
            {winning.length} in the Winning Doc
          </Badge>
        )}
      </div>

      {all.length > 0 && (
        <div className="mt-5 flex flex-col gap-2">
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
              ? "No creatives yet — run Still Ads from the client page."
              : "Nothing matches these filters."}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {creatives.map((creative) => (
            <CreativeCard
              key={creative.id}
              creative={creative}
              previewUrl={
                creative.storage_path
                  ? (urlByPath.get(creative.storage_path) ?? null)
                  : null
              }
              aspectUrls={aspectUrls(creative)}
            />
          ))}
        </div>
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
