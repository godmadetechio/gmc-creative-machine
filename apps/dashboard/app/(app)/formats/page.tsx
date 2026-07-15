import {
  RunStatus,
  FormatLibraryEntrySchema,
  SeedVertical,
} from "@gmc/shared";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { RunStatusBadge } from "@/components/run-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { relativeTime } from "@/lib/relative-time";
import { createClient } from "@/lib/supabase/server";
import { FormatsExplorer } from "./formats-explorer";
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
    supabase.from("format_library").select("*"),
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

  const active = formats.filter((f) => f.status === "active");
  const fadingCount = formats.filter((f) => f.status === "fading").length;
  const perVertical = SeedVertical.options.map((vertical) => ({
    vertical,
    count: active.filter((f) => f.verticals_seen.includes(vertical)).length,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Formats</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The agency-wide library of proven static ad formats, confirmed by
            scanning heavy advertisers across verticals.
          </p>
        </div>
        <RefreshLibraryButton disabled={scanInFlight} />
      </div>

      <AutoRefresh active={scanInFlight} />

      {/* Summary strip */}
      <Card className="mt-6 py-3">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 text-sm">
          <span>
            <span className="font-semibold">{active.length}</span>{" "}
            <span className="text-muted-foreground">active formats</span>
          </span>
          <Separator orientation="vertical" className="hidden h-4 sm:block" />
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-3">
            {perVertical.map(({ vertical, count }) => (
              <span key={vertical}>
                {vertical} <span className="text-foreground">{count}</span>
              </span>
            ))}
          </span>
          <Separator orientation="vertical" className="hidden h-4 sm:block" />
          <span>
            <span className={fadingCount > 0 ? "text-amber-400" : ""}>
              {fadingCount}
            </span>{" "}
            <span className="text-muted-foreground">fading</span>
          </span>
          <Separator orientation="vertical" className="hidden h-4 sm:block" />
          <span className="text-muted-foreground flex items-center gap-2">
            {lastScan
              ? lastScan.finished_at
                ? `Last scan ${relativeTime(lastScan.finished_at)}`
                : `Last scan started ${relativeTime(lastScan.created_at)}`
              : "Never scanned"}
            {lastScan && <RunStatusBadge status={lastScan.status} />}
          </span>
        </CardContent>
      </Card>

      {libraryResult.error ? (
        <Card className="mt-6">
          <CardContent className="text-destructive py-12 text-center text-sm">
            Failed to load the format library: {libraryResult.error.message}
          </CardContent>
        </Card>
      ) : formats.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No formats yet — run a scan; the library seeds itself from the
            static frameworks file on the first one.
          </CardContent>
        </Card>
      ) : (
        <FormatsExplorer formats={formats} />
      )}
    </div>
  );
}
