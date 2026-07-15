import { ExternalLink } from "lucide-react";
import type { FormatLibraryEntry, FormatStatus } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/relative-time";

const STATUS_STYLES: Record<FormatStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  fading: "bg-amber-500/15 text-amber-400",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<FormatStatus, string> = {
  active: "Active",
  fading: "Fading",
  archived: "Archived",
};

const MAX_EXAMPLES_SHOWN = 2;

export function FormatCard({ format }: { format: FormatLibraryEntry }) {
  const examples = format.example_ads.slice(0, MAX_EXAMPLES_SHOWN);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          {format.name}
          <Badge variant="secondary" className={cn(STATUS_STYLES[format.status])}>
            {STATUS_LABELS[format.status]}
          </Badge>
        </CardTitle>
        <CardDescription>{format.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{format.psychology}</p>
        <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
          {format.skeleton}
        </pre>
        {format.verticals_seen.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {format.verticals_seen.map((vertical) => (
              <Badge key={vertical} variant="outline">
                {vertical}
              </Badge>
            ))}
          </div>
        )}
        {examples.length > 0 && (
          <div className="flex flex-col gap-2">
            {examples.map((example) => (
              <div
                key={example.ad_url}
                className="border-border rounded-md border p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {example.advertiser ?? "Unknown advertiser"}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {example.days_running != null
                      ? `${example.days_running}d running`
                      : ""}
                  </span>
                </div>
                {example.copy_snippet && (
                  <p className="text-muted-foreground mt-1 line-clamp-2">
                    {example.copy_snippet}
                  </p>
                )}
                <a
                  href={example.ad_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1"
                >
                  <ExternalLink className="size-3" />
                  View in Ad Library
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="text-muted-foreground text-xs">
        {format.last_confirmed
          ? `Confirmed ${relativeTime(format.last_confirmed)}`
          : "Never confirmed in a scan yet"}
        {format.scans_missed > 0 &&
          ` · unseen for ${format.scans_missed} scan${format.scans_missed === 1 ? "" : "s"}`}
      </CardFooter>
    </Card>
  );
}
