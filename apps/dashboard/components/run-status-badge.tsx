import type { RunStatus, RunType } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const RUN_TYPE_LABELS: Record<RunType, string> = {
  buyer_brain: "Buyer Brain",
  creative_selection: "Creative Selection",
  still_ads: "Still Ads",
  video_ads: "Video Ads",
  format_scan: "Format Scan",
  reference_annotate: "Reference Annotation",
  brief_suggestions: "Brief Suggestions",
  creative_regen: "Creative Regen",
};

const STATUS_STYLES: Record<RunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-400",
  needs_review: "bg-amber-500/15 text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
};

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  needs_review: "Needs review",
  approved: "Approved",
  failed: "Failed",
};

// Stage slugs the worker writes at pipeline section boundaries → labels.
// Unknown slugs render as-is (underscores swapped), so new stages need no
// dashboard change.
const STAGE_LABELS: Record<string, string> = {
  mining: "mining",
  composing: "composing",
  scouting: "scouting",
  building_targets: "building targets",
  scraping: "scraping",
  deduping: "deduping",
  scoring: "scoring",
  selecting: "selecting",
  archiving: "archiving",
  concepting: "concepting",
  compiling: "compiling prompts",
  generating: "generating images",
  delivering: "delivering",
  persisting: "saving",
};

export function runStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replaceAll("_", " ");
}

export function RunStatusBadge({
  status,
  stage,
}: {
  status: RunStatus;
  /** Live pipeline stage — shown only while running ("Running · scoring"). */
  stage?: string | null;
}) {
  return (
    <Badge variant="secondary" className={cn(STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
      {status === "running" && stage && ` · ${runStageLabel(stage)}`}
    </Badge>
  );
}
