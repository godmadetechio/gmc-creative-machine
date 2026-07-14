import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { z } from "zod";
import {
  BBMSchema,
  ClientSchema,
  type BBM,
  type VerbatimQuote,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { VersionSelect } from "./version-select";

const SECTION_STYLES = {
  pains: "border-red-500/40",
  desires: "border-emerald-500/40",
  beliefs: "border-amber-500/40",
  patterns: "border-blue-500/40",
} as const;

function QuoteList({ quotes }: { quotes: VerbatimQuote[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {quotes.map((q, i) => (
        <li key={i} className="text-sm">
          <a
            href={q.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground group block"
          >
            <span className="italic">“{q.quote}”</span>{" "}
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs opacity-70 group-hover:opacity-100">
              — {q.platform}
              <ExternalLink className="size-3" />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function IntensityBadge({ value }: { value: number }) {
  return (
    <Badge variant="secondary" className="bg-muted text-muted-foreground">
      intensity {value}/5
    </Badge>
  );
}

function SectionHeading({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <h2 className="mt-10 text-lg font-semibold">
      {title} <span className="text-muted-foreground font-normal">({count})</span>
    </h2>
  );
}

export default async function BbmViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [clientResult, versionsResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("bbm_versions")
      .select("version, is_active, created_at, matrix_json")
      .eq("client_id", id)
      .order("version", { ascending: false }),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const versions = versionsResult.data ?? [];

  if (versions.length === 0) {
    return (
      <div>
        <BackLink id={id} name={client.name} />
        <Card className="mt-6">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No Buyer Brain Matrix yet — run the pipeline from the client page.
          </CardContent>
        </Card>
      </div>
    );
  }

  const requested = Number(v);
  const selectedRow =
    versions.find((row) => row.version === requested) ??
    versions.find((row) => row.is_active) ??
    versions[0];

  const parsed = BBMSchema.safeParse(selectedRow.matrix_json);

  return (
    <div>
      <BackLink id={id} name={client.name} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Buyer Brain Matrix
            {selectedRow.is_active && (
              <Badge
                variant="secondary"
                className="ml-3 bg-emerald-500/15 align-middle text-emerald-400"
              >
                Active
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {client.name} · {client.niche ?? "no niche set"}
          </p>
        </div>
        <VersionSelect
          versions={versions.map(({ version, is_active, created_at }) => ({
            version,
            is_active,
            created_at,
          }))}
          selected={selectedRow.version}
        />
      </div>

      {!parsed.success ? (
        <Card className="mt-6">
          <CardContent className="text-destructive py-12 text-center text-sm">
            This version&apos;s matrix does not match the current BBM schema —
            it may predate a schema change. ({parsed.error.issues.length}{" "}
            validation issues)
          </CardContent>
        </Card>
      ) : (
        <BbmSections bbm={parsed.data} />
      )}
    </div>
  );
}

function BackLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/clients/${id}`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-3.5" />
      {name}
    </Link>
  );
}

function BbmSections({ bbm }: { bbm: BBM }) {
  return (
    <>
      {bbm.change_summary && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              What changed in v{bbm.version}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm whitespace-pre-wrap">
            {bbm.change_summary}
          </CardContent>
        </Card>
      )}

      <SectionHeading title="Pains" count={bbm.pains.length} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {bbm.pains.map((pain, i) => (
          <Card key={i} className={SECTION_STYLES.pains}>
            <CardHeader>
              <CardTitle className="text-base leading-snug">
                {pain.current}
              </CardTitle>
              <div className="flex flex-wrap gap-2 pt-1">
                <IntensityBadge value={pain.intensity} />
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  {pain.frequency}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="text-muted-foreground">Where it leads: </span>
                {pain.future}
              </p>
              <QuoteList quotes={pain.verbatim_quotes} />
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionHeading title="Desires" count={bbm.desires.length} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {bbm.desires.map((desire, i) => (
          <Card key={i} className={SECTION_STYLES.desires}>
            <CardHeader>
              <CardTitle className="text-base leading-snug">
                {desire.current}
              </CardTitle>
              <div className="pt-1">
                <IntensityBadge value={desire.intensity} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="text-muted-foreground">
                  Really buying:{" "}
                </span>
                {desire.future}
              </p>
              <QuoteList quotes={desire.verbatim_quotes} />
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionHeading title="Beliefs" count={bbm.beliefs.length} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {bbm.beliefs.map((belief, i) => (
          <Card key={i} className={SECTION_STYLES.beliefs}>
            <CardHeader>
              <CardTitle className="text-base leading-snug">
                {belief.belief}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="text-muted-foreground">How it formed: </span>
                {belief.development}
              </p>
              <p className="mt-2 text-sm">
                <span className="font-medium text-amber-400">
                  Breaking angle:{" "}
                </span>
                {belief.breaking_angle}
              </p>
              <QuoteList quotes={belief.verbatim_quotes} />
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionHeading title="Patterns" count={bbm.patterns.length} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {bbm.patterns.map((pattern, i) => (
          <Card key={i} className={SECTION_STYLES.patterns}>
            <CardHeader>
              <CardTitle className="text-base leading-snug">
                {pattern.pattern}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                <span className="text-muted-foreground">
                  Creative implication:{" "}
                </span>
                {pattern.implication}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionHeading title="Language bank" count={bbm.language_bank.length} />
      <div className="mt-3 flex flex-wrap gap-2">
        {bbm.language_bank.map((phrase, i) => (
          <Badge key={i} variant="secondary" className="text-sm font-normal">
            “{phrase}”
          </Badge>
        ))}
      </div>

      <p className="text-muted-foreground mt-10 text-xs">
        Sources:{" "}
        {Object.entries(bbm.sources_summary)
          .map(([platform, count]) => `${platform} × ${count}`)
          .join(" · ")}{" "}
        · Generated {new Date(bbm.generated_at).toLocaleString("en-GB")}
      </p>
    </>
  );
}
