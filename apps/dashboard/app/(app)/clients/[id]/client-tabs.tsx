import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// URL-addressable tab bar for the client page: the URL (?tab=) is the state,
// so this stays a server component of prefetched links — no Radix state.

export const CLIENT_TAB_KEYS = [
  "overview",
  "research",
  "selection",
  "creatives",
  "assets",
  "brief",
] as const;
export type ClientTabKey = (typeof CLIENT_TAB_KEYS)[number];

export function parseClientTab(value: string | string[] | undefined): ClientTabKey {
  return CLIENT_TAB_KEYS.includes(value as ClientTabKey)
    ? (value as ClientTabKey)
    : "overview";
}

export type ClientTabCounts = {
  pendingCandidates: number;
  draftCreatives: number;
  openAssetRequests: number;
  pendingSuggestions: number;
};

const TAB_LABELS: Record<ClientTabKey, string> = {
  overview: "Overview",
  research: "Research",
  selection: "Selection",
  creatives: "Creatives",
  assets: "Assets",
  brief: "Brief",
};

export function ClientTabs({
  clientId,
  active,
  counts,
}: {
  clientId: string;
  active: ClientTabKey;
  counts: ClientTabCounts;
}) {
  const countFor: Partial<Record<ClientTabKey, number>> = {
    selection: counts.pendingCandidates,
    creatives: counts.draftCreatives,
    assets: counts.openAssetRequests,
    brief: counts.pendingSuggestions,
  };
  return (
    <nav
      aria-label="Client sections"
      className="bg-muted text-muted-foreground inline-flex flex-wrap items-center gap-1 rounded-lg p-1"
    >
      {CLIENT_TAB_KEYS.map((key) => {
        const count = countFor[key] ?? 0;
        return (
          <Link
            key={key}
            href={key === "overview" ? `/clients/${clientId}` : `/clients/${clientId}?tab=${key}`}
            aria-current={active === key ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === key
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground",
            )}
          >
            {TAB_LABELS[key]}
            {count > 0 && (
              <Badge
                variant={active === key ? "secondary" : "outline"}
                className="px-1.5 py-0 text-[11px]"
              >
                {count}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
