"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { FormatLibraryEntry } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormatStatusBadge, freshnessLine } from "./format-card";

function CopySkeletonButton({ skeleton }: { skeleton: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        navigator.clipboard.writeText(skeleton).then(() => setCopied(true))
      }
    >
      {copied ? <Check className="text-emerald-400" /> : <Copy />}
      {copied ? "Copied" : "Copy skeleton"}
    </Button>
  );
}

export function FormatDetailDialog({
  format,
  onClose,
}: {
  format: FormatLibraryEntry | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={format !== null} onOpenChange={(open) => !open && onClose()}>
      {format && (
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
              {format.name}
              <FormatStatusBadge status={format.status} />
              {format.detection === "visual" && (
                <Badge variant="outline">visual — not auto-confirmed</Badge>
              )}
            </DialogTitle>
            <DialogDescription>{format.description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 text-sm">
            <section>
              <h3 className="mb-1 font-medium">Why it works</h3>
              <p className="text-muted-foreground">{format.psychology}</p>
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="font-medium">Skeleton</h3>
                <CopySkeletonButton skeleton={format.skeleton} />
              </div>
              <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                {format.skeleton}
              </pre>
            </section>

            {format.verticals_seen.length > 0 && (
              <section>
                <h3 className="mb-1 font-medium">Proven in</h3>
                <div className="flex flex-wrap gap-1.5">
                  {format.verticals_seen.map((vertical) => (
                    <Badge key={vertical} variant="outline">
                      {vertical}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            {format.example_ads.length > 0 && (
              <section>
                <h3 className="mb-1 font-medium">
                  Example ads ({format.example_ads.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {format.example_ads.map((example) => (
                    <div
                      key={example.ad_url}
                      className="border-border rounded-md border p-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {example.advertiser ?? "Unknown advertiser"}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {example.vertical}
                          {example.days_running != null &&
                            ` · ${example.days_running}d running`}
                        </span>
                      </div>
                      {example.copy_snippet && (
                        <p className="text-muted-foreground mt-1">
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
              </section>
            )}

            <p className="text-muted-foreground text-xs">
              {freshnessLine(format)}
              {format.scans_missed > 0 &&
                ` · unseen for ${format.scans_missed} scan${format.scans_missed === 1 ? "" : "s"}`}
            </p>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
