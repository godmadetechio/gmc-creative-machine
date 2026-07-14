import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpenText, ExternalLink, Pencil } from "lucide-react";
import { z } from "zod";
import { ClientSchema, RunStatus } from "@gmc/shared";
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
import { AutoRefresh } from "./auto-refresh";
import { RunBuyerBrainButton } from "./run-buyer-brain-button";

const RunRowSchema = z.object({
  id: z.string().uuid(),
  status: RunStatus,
  input_json: z.unknown().nullable(),
  output_json: z.unknown().nullable(),
  cost_usd: z.number().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function runDepth(input: unknown): string {
  const parsed = z.object({ depth: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.depth : "full";
}

function runError(output: unknown): string | null {
  const parsed = z.object({ error: z.string() }).safeParse(output);
  return parsed.success ? parsed.data.error : null;
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();

  const [clientResult, runsResult, bbmResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("runs")
      .select(
        "id, status, input_json, output_json, cost_usd, created_at, finished_at",
      )
      .eq("client_id", id)
      .eq("type", "buyer_brain")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("bbm_versions")
      .select("version, is_active")
      .eq("client_id", id)
      .order("version", { ascending: false })
      .limit(1),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const runs = (runsResult.data ?? []).map((row) => RunRowSchema.parse(row));
  const latestBbm = bbmResult.data?.[0] ?? null;

  const hasActiveRun = runs.some(
    (run) => run.status === "queued" || run.status === "running",
  );

  return (
    <div>
      <AutoRefresh active={hasActiveRun} />

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
        <RunBuyerBrainButton clientId={client.id} disabled={hasActiveRun} />
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

      <div className="mt-6 flex items-center justify-between">
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

      {runs.length === 0 ? (
        <Card className="mt-3">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No Buyer Brain runs yet. Kick one off to build the first matrix.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-3 py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Started</TableHead>
                  <TableHead>Depth</TableHead>
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
                        {runDepth(run.input_json)}
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
      )}
    </div>
  );
}
