import { RunStatus, RunType } from "@gmc/shared";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RUN_TYPE_LABELS,
  RunStatusBadge,
} from "@/components/run-status-badge";
import { createClient } from "@/lib/supabase/server";

const RunRowSchema = z.object({
  id: z.string().uuid(),
  type: RunType,
  status: RunStatus,
  cost_usd: z.number().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
  clients: z.object({ name: z.string() }).nullable(),
});

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string | null) {
  return value ? dateTimeFormat.format(new Date(value)) : "—";
}

export default async function RunsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("runs")
    .select(
      "id, type, status, cost_usd, started_at, finished_at, created_at, clients (name)",
    )
    .order("created_at", { ascending: false });

  const runs = (data ?? []).map((row) => RunRowSchema.parse(row));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Every pipeline execution, newest first.
      </p>

      {error ? (
        <Card className="mt-8">
          <CardContent className="text-destructive py-12 text-center text-sm">
            Failed to load runs: {error.message}
          </CardContent>
        </Card>
      ) : runs.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No runs yet — the Buyer Brain pipeline arrives in Phase 1.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-8 py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Client</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Finished</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="pl-4 font-medium">
                      {/* only global run types legitimately have no client */}
                      {run.clients?.name ??
                        (run.type === "format_scan" ? "Global" : "—")}
                    </TableCell>
                    <TableCell>{RUN_TYPE_LABELS[run.type]}</TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.cost_usd != null
                        ? `$${run.cost_usd.toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(run.started_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(run.finished_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
