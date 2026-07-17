import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpenText,
  ExternalLink,
  GalleryVerticalEnd,
  ImageIcon,
  Pencil,
} from "lucide-react";
import { z } from "zod";
import { ClientSchema, CompetitorSchema, RunStatus } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RunStatusBadge } from "@/components/run-status-badge";
import { createClient } from "@/lib/supabase/server";
import { ClientDialog } from "../client-dialog";
import { AutoRefresh } from "@/components/auto-refresh";
import { CompetitorsCard } from "./competitors-card";
import { RunBuyerBrainButton } from "./run-buyer-brain-button";
import { RunCreativeSelectionButton } from "./run-creative-selection-button";

const RunRowSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: RunStatus,
  input_json: z.unknown().nullable(),
  output_json: z.unknown().nullable(),
  cost_usd: z.number().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
type RunRow = z.infer<typeof RunRowSchema>;

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function runDepth(input: unknown): string {
  const parsed = z.object({ depth: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.depth : "full";
}

function runCountry(input: unknown): string {
  const parsed = z.object({ country: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.country : "US";
}

function runError(output: unknown): string | null {
  const parsed = z.object({ error: z.string() }).safeParse(output);
  return parsed.success ? parsed.data.error : null;
}

function runCandidateCount(output: unknown): number | null {
  const parsed = z.object({ candidate_count: z.number() }).safeParse(output);
  return parsed.success ? parsed.data.candidate_count : null;
}

function RunsTable({
  runs,
  detailHead,
  detail,
}: {
  runs: RunRow[];
  detailHead: string;
  detail: (run: RunRow) => string;
}) {
  return (
    <Card className="mt-3 py-2">
      <CardContent className="px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Started</TableHead>
              <TableHead>{detailHead}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Finished</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const error = runError(run.output_json);
              return (
                <TableRow key={run.id}>
                  <TableCell className="pl-4">
                    {dateTimeFormat.format(new Date(run.created_at))}
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {detail(run)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span>
                        <RunStatusBadge status={run.status} />
                      </span>
                      {run.status === "failed" && error && (
                        <span className="text-destructive max-w-96 truncate text-xs">
                          {error}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.cost_usd != null ? `$${run.cost_usd.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.finished_at
                      ? dateTimeFormat.format(new Date(run.finished_at))
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();

  const [
    clientResult,
    runsResult,
    bbmResult,
    activeBbmResult,
    candidatesResult,
    competitorsResult,
    assetsResult,
  ] = await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("runs")
        .select(
          "id, type, status, input_json, output_json, cost_usd, created_at, finished_at",
        )
        .eq("client_id", id)
        .in("type", ["buyer_brain", "creative_selection"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("bbm_versions")
        .select("version, is_active")
        .eq("client_id", id)
        .order("version", { ascending: false })
        .limit(1),
      supabase
        .from("bbm_versions")
        .select("id")
        .eq("client_id", id)
        .eq("is_active", true)
        .limit(1),
      supabase
        .from("ad_candidates")
        .select("id, status")
        .eq("client_id", id),
      supabase
        .from("competitors")
        .select("*")
        .eq("client_id", id)
        .order("status", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("client_assets")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id),
    ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const allRuns = (runsResult.data ?? []).map((row) => RunRowSchema.parse(row));
  const bbmRuns = allRuns.filter((run) => run.type === "buyer_brain").slice(0, 10);
  const selectionRuns = allRuns
    .filter((run) => run.type === "creative_selection")
    .slice(0, 10);
  const latestBbm = bbmResult.data?.[0] ?? null;
  const hasActiveBbm = (activeBbmResult.data?.length ?? 0) > 0;
  const candidates = candidatesResult.data ?? [];
  const pendingCandidates = candidates.filter(
    (c) => c.status === "candidate",
  ).length;
  const competitors = (competitorsResult.data ?? []).map((row) =>
    CompetitorSchema.parse(row),
  );
  const assetCount = assetsResult.count ?? 0;

  const isActive = (run: RunRow) =>
    run.status === "queued" || run.status === "running";
  const hasActiveBbmRun = bbmRuns.some(isActive);
  const hasActiveSelectionRun = selectionRuns.some(isActive);

  return (
    <div>
      <AutoRefresh active={hasActiveBbmRun || hasActiveSelectionRun} />

      <Link
        href="/clients"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        All clients
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            <ClientDialog
              client={client}
              trigger={
                <Button variant="ghost" size="icon">
                  <Pencil />
                  <span className="sr-only">Edit {client.name}</span>
                </Button>
              }
            />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {client.niche ?? "No niche set"}
            {client.website && (
              <>
                {" · "}
                <a
                  href={client.website}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-1"
                >
                  {new URL(client.website).hostname}
                  <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </p>
        </div>
      </div>

      {client.brief && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Brief</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm whitespace-pre-wrap">
            {client.brief}
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Asset Library</h2>
        <Button asChild variant="outline" size="sm">
          <Link href={`/clients/${client.id}/assets`}>
            <ImageIcon />
            {assetCount > 0
              ? `${assetCount} asset${assetCount === 1 ? "" : "s"}`
              : "Upload assets"}
            {client.brand_json && " · brand kit set"}
          </Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Buyer Brain</h2>
          {latestBbm && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/clients/${client.id}/bbm`}>
                <BookOpenText />
                View BBM (v{latestBbm.version})
              </Link>
            </Button>
          )}
        </div>
        <RunBuyerBrainButton clientId={client.id} disabled={hasActiveBbmRun} />
      </div>

      {bbmRuns.length === 0 ? (
        <Card className="mt-3">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No Buyer Brain runs yet. Kick one off to build the first matrix.
          </CardContent>
        </Card>
      ) : (
        <RunsTable
          runs={bbmRuns}
          detailHead="Depth"
          detail={(run) => runDepth(run.input_json)}
        />
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold">Competitors</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Scouted automatically on each Creative Selection run, or added by
          hand. Ignored competitors are never searched.
        </p>
        <CompetitorsCard clientId={client.id} competitors={competitors} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Creative Selection</h2>
          {candidates.length > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/clients/${client.id}/candidates`}>
                <GalleryVerticalEnd />
                Review candidates
                {pendingCandidates > 0 && ` (${pendingCandidates} pending)`}
              </Link>
            </Button>
          )}
        </div>
        <RunCreativeSelectionButton
          clientId={client.id}
          disabled={hasActiveSelectionRun}
          hasActiveBbm={hasActiveBbm}
        />
      </div>

      {selectionRuns.length === 0 ? (
        <Card className="mt-3">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No Creative Selection runs yet.
            {hasActiveBbm
              ? " Kick one off to scout competitor ads against the BBM."
              : " Build a Buyer Brain Matrix first — it is the lens ads are scored through."}
          </CardContent>
        </Card>
      ) : (
        <RunsTable
          runs={selectionRuns}
          detailHead="Result"
          detail={(run) => {
            const count = runCandidateCount(run.output_json);
            return count != null
              ? `${count} candidates (${runCountry(run.input_json)})`
              : runCountry(run.input_json);
          }}
        />
      )}
    </div>
  );
}
