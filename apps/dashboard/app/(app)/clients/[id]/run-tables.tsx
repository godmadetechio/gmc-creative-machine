import { z } from "zod";
import { RunStatus } from "@gmc/shared";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RunStatusBadge } from "@/components/run-status-badge";

// Per-pipeline run history tables + the run-row helpers, shared by the
// client tabs (Research / Selection / Creatives) since the tab split.

export const RunRowSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: RunStatus,
  stage: z.string().nullable().optional(),
  input_json: z.unknown().nullable(),
  output_json: z.unknown().nullable(),
  cost_usd: z.number().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type RunRow = z.infer<typeof RunRowSchema>;

export const RUN_ROW_COLUMNS =
  "id, type, status, stage, input_json, output_json, cost_usd, created_at, finished_at";

// A run sitting queued this long with no worker pickup is probably stalled
// (worker down or wedged) — matches the offline-banner threshold family.
export const STUCK_QUEUED_MS = 3 * 60 * 1000;

export function isStuckQueued(run: { status: string; created_at: string }): boolean {
  return (
    run.status === "queued" &&
    Date.now() - new Date(run.created_at).getTime() > STUCK_QUEUED_MS
  );
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function runDepth(input: unknown): string {
  const parsed = z.object({ depth: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.depth : "full";
}

export function runCountry(input: unknown): string {
  const parsed = z.object({ country: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.country : "US";
}

export function runError(output: unknown): string | null {
  const parsed = z.object({ error: z.string() }).safeParse(output);
  return parsed.success ? parsed.data.error : null;
}

export function runCandidateCount(output: unknown): number | null {
  const parsed = z.object({ candidate_count: z.number() }).safeParse(output);
  return parsed.success ? parsed.data.candidate_count : null;
}

export function runCreativeCount(output: unknown): number | null {
  const parsed = z.object({ creative_count: z.number() }).safeParse(output);
  return parsed.success ? parsed.data.creative_count : null;
}

export function runConceptCount(input: unknown): number | null {
  const parsed = z.object({ concept_count: z.number() }).safeParse(input);
  return parsed.success ? parsed.data.concept_count : null;
}

export const isActiveRun = (run: RunRow) =>
  run.status === "queued" || run.status === "running";

export function RunsTable({
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
                        <RunStatusBadge status={run.status} stage={run.stage} />
                      </span>
                      {run.status === "failed" && error && (
                        <span className="text-destructive max-w-96 truncate text-xs">
                          {error}
                        </span>
                      )}
                      {isStuckQueued(run) && (
                        <span className="text-xs text-amber-500">
                          queued &gt;3 min — is the worker running?
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
