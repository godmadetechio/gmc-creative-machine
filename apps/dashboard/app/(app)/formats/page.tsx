import { RunStatus, FormatLibraryEntrySchema } from "@gmc/shared";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { RunStatusBadge } from "@/components/run-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { relativeTime } from "@/lib/relative-time";
import { createClient } from "@/lib/supabase/server";
import { FormatCard } from "./format-card";
import { RefreshLibraryButton } from "./refresh-library-button";

const ScanRunSchema = z.object({
  id: z.string().uuid(),
  status: RunStatus,
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

export default async function FormatsPage() {
  const supabase = await createClient();

  const [libraryResult, lastScanResult] = await Promise.all([
    supabase
      .from("format_library")
      .select("*")
      .order("status")
      .order("last_confirmed", { ascending: false, nullsFirst: false }),
    supabase
      .from("runs")
      .select("id, status, created_at, finished_at")
      .eq("type", "format_scan")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const formats = (libraryResult.data ?? []).map((row) =>
    FormatLibraryEntrySchema.parse(row),
  );
  const lastScan = lastScanResult.data
    ? ScanRunSchema.parse(lastScanResult.data)
    : null;
  const scanInFlight =
    lastScan?.status === "queued" || lastScan?.status === "running";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Formats</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The agency-wide library of proven static ad formats, confirmed by
            scanning heavy advertisers across verticals.
          </p>
          <p className="mt-2 text-sm font-medium">
            {lastScan
              ? lastScan.finished_at
                ? `Last scan: ${relativeTime(lastScan.finished_at)}`
                : `Last scan: started ${relativeTime(lastScan.created_at)}`
              : "Never scanned"}
            {lastScan && (
              <span className="ml-2 inline-flex align-middle">
                <RunStatusBadge status={lastScan.status} />
              </span>
            )}
          </p>
        </div>
        <RefreshLibraryButton disabled={scanInFlight} />
      </div>

      <AutoRefresh active={scanInFlight} />

      {libraryResult.error ? (
        <Card className="mt-8">
          <CardContent className="text-destructive py-12 text-center text-sm">
            Failed to load the format library: {libraryResult.error.message}
          </CardContent>
        </Card>
      ) : formats.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No formats yet — run a scan; the library seeds itself from the
            static frameworks file on the first one.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {formats.map((format) => (
            <FormatCard key={format.id} format={format} />
          ))}
        </div>
      )}
    </div>
  );
}
