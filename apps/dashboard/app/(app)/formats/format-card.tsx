"use client";

import { Eye } from "lucide-react";
import type { FormatLibraryEntry, FormatStatus } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";

export const STATUS_STYLES: Record<FormatStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  fading: "bg-amber-500/15 text-amber-400",
  archived: "bg-muted text-muted-foreground",
};

export const STATUS_LABELS: Record<FormatStatus, string> = {
  active: "Active",
  fading: "Fading",
  archived: "Archived",
};

export function FormatStatusBadge({ status }: { status: FormatStatus }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

// "confirmed 3 days ago" — or the visual-format note: a text-only extractor
// cannot confirm visually-defined formats, so "never confirmed" would read
// as a defect when it's a known limitation.
export function freshnessLine(format: FormatLibraryEntry): string {
  if (format.last_confirmed) {
    return `Confirmed ${relativeTime(format.last_confirmed)}`;
  }
  return format.detection === "visual"
    ? "Visual format — not auto-confirmed"
    : "Never confirmed in a scan yet";
}

// Compact grid tile: name, one-line description, vertical badges,
// freshness. Click opens the detail dialog.
export function FormatCard({
  format,
  onOpen,
}: {
  format: FormatLibraryEntry;
  onOpen: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="hover:border-ring/40 cursor-pointer gap-2 py-4 transition-colors"
    >
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1.5">
            {format.name}
            {format.detection === "visual" && (
              <Eye
                className="text-muted-foreground size-3.5 shrink-0"
                aria-label="Visual format"
              />
            )}
          </span>
          <FormatStatusBadge status={format.status} />
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {format.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {format.verticals_seen.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {format.verticals_seen.map((vertical) => (
              <Badge key={vertical} variant="outline" className="text-xs">
                {vertical}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">{freshnessLine(format)}</p>
      </CardContent>
    </Card>
  );
}
