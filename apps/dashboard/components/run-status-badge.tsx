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

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
