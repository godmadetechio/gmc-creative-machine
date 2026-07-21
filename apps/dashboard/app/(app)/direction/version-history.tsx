"use client";

import { History } from "lucide-react";
import {
  SECTION_LABELS,
  type BriefSections,
  type CreativeDirective,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Section-level diff between two versions: text sections show old → new,
// list sections show added/removed items. Section granularity is the
// useful unit for a brief — no character diffing.

type SectionChange = {
  label: string;
  kind: "added" | "removed" | "changed";
  before?: string[];
  after?: string[];
};

function asLines(sections: BriefSections, key: keyof BriefSections): string[] {
  const value = sections[key];
  if (value == null) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value as string[];
  // hard_rules
  const rules = value as { never: string[]; always: string[] };
  return [
    ...rules.never.map((r) => `NEVER: ${r}`),
    ...rules.always.map((r) => `ALWAYS: ${r}`),
  ];
}

function diffSections(before: BriefSections, after: BriefSections): SectionChange[] {
  const changes: SectionChange[] = [];
  for (const key of Object.keys(SECTION_LABELS) as (keyof BriefSections)[]) {
    const beforeLines = asLines(before, key);
    const afterLines = asLines(after, key);
    if (JSON.stringify(beforeLines) === JSON.stringify(afterLines)) continue;
    // Line-level: only what actually left/arrived (an order-only change in
    // a list shows the full new order).
    const removed = beforeLines.filter((l) => !afterLines.includes(l));
    const added = afterLines.filter((l) => !beforeLines.includes(l));
    changes.push({
      label: SECTION_LABELS[key],
      kind:
        beforeLines.length === 0
          ? "added"
          : afterLines.length === 0
            ? "removed"
            : "changed",
      before: removed.length + added.length > 0 ? removed : [],
      after: removed.length + added.length > 0 ? added : afterLines,
    });
  }
  return changes;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function VersionHistory({
  title,
  versions,
}: {
  title: string;
  /** All versions for one scope-target, newest first. */
  versions: CreativeDirective[];
}) {
  if (versions.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History />
          History ({versions.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title} — version history</DialogTitle>
          <DialogDescription>
            Changes shown against the previous version. Every version is a
            full snapshot; nothing is ever overwritten.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {versions.map((version, i) => {
            const previous = versions[i + 1];
            const changes = previous
              ? diffSections(previous.sections, version.sections)
              : null;
            return (
              <div key={version.id} className="border-b pb-4 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">v{version.version}</span>
                  {version.is_active && <Badge>active</Badge>}
                  <span className="text-muted-foreground text-xs">
                    {dateTimeFormat.format(new Date(version.created_at))}
                    {version.author && ` · ${version.author}`}
                  </span>
                </div>
                {changes === null ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    Initial version.
                  </p>
                ) : changes.length === 0 ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    No section changes.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2 text-sm">
                    {changes.map((change) => (
                      <div key={change.label}>
                        <p className="font-medium">
                          {change.label}{" "}
                          <span className="text-muted-foreground text-xs font-normal">
                            ({change.kind})
                          </span>
                        </p>
                        {change.kind !== "added" &&
                          change.before?.map((line, j) => (
                            <p
                              key={`b${j}`}
                              className="text-destructive/80 pl-3 text-xs line-through"
                            >
                              {line}
                            </p>
                          ))}
                        {change.kind !== "removed" &&
                          change.after?.map((line, j) => (
                            <p key={`a${j}`} className="pl-3 text-xs text-emerald-500">
                              {line}
                            </p>
                          ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
