"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { SeedVertical, type FormatLibraryEntry } from "@gmc/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FormatCard } from "./format-card";
import { FormatDetailDialog } from "./format-detail-dialog";

const STATUS_OPTIONS = ["active", "fading", "archived", "all"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

const DETECTION_OPTIONS = ["all", "text", "visual"] as const;
type DetectionFilter = (typeof DETECTION_OPTIONS)[number];

const SORT_OPTIONS = ["recent", "verticals", "alpha", "stale"] as const;
type SortKey = (typeof SORT_OPTIONS)[number];

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently confirmed",
  verticals: "Most verticals",
  alpha: "Alphabetical",
  stale: "Oldest unconfirmed",
};

type Filters = {
  vertical: "all" | SeedVertical;
  status: StatusFilter;
  detection: DetectionFilter;
  q: string;
  sort: SortKey;
};

const DEFAULTS: Filters = {
  vertical: "all",
  status: "active",
  detection: "all",
  q: "",
  sort: "recent",
};

function parseFilters(params: URLSearchParams): Filters {
  const pick = <T extends string>(
    key: keyof Filters,
    options: readonly T[],
  ): T => {
    const value = params.get(key);
    return options.includes(value as T) ? (value as T) : (DEFAULTS[key] as T);
  };
  return {
    vertical: pick("vertical", ["all", ...SeedVertical.options] as const),
    status: pick("status", STATUS_OPTIONS),
    detection: pick("detection", DETECTION_OPTIONS),
    q: params.get("q") ?? "",
    sort: pick("sort", SORT_OPTIONS),
  };
}

// Shareable state: non-default filters live in the query string. Written
// via history.replaceState so filtering stays fully client-side (no server
// round-trip per keystroke).
function writeFilters(filters: Filters) {
  const params = new URLSearchParams(window.location.search);
  for (const key of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    if (filters[key] === DEFAULTS[key]) params.delete(key);
    else params.set(key, String(filters[key]));
  }
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    query ? `?${query}` : window.location.pathname,
  );
}

const confirmedAt = (f: FormatLibraryEntry) =>
  f.last_confirmed ? new Date(f.last_confirmed).getTime() : null;

const SORTERS: Record<
  SortKey,
  (a: FormatLibraryEntry, b: FormatLibraryEntry) => number
> = {
  recent: (a, b) =>
    (confirmedAt(b) ?? -Infinity) - (confirmedAt(a) ?? -Infinity),
  verticals: (a, b) =>
    b.verticals_seen.length - a.verticals_seen.length ||
    a.name.localeCompare(b.name),
  alpha: (a, b) => a.name.localeCompare(b.name),
  // stalest first: never-confirmed, then oldest confirmation
  stale: (a, b) => (confirmedAt(a) ?? -Infinity) - (confirmedAt(b) ?? -Infinity),
};

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-input text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function FormatsExplorer({
  formats,
}: {
  formats: FormatLibraryEntry[];
}) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(new URLSearchParams(searchParams.toString())),
  );
  const [openFormat, setOpenFormat] = useState<FormatLibraryEntry | null>(null);

  // Only ever called from event handlers — the URL write must never run
  // during render (React errors: "Cannot update a component (Router) while
  // rendering a different component"), so it stays out of the setState
  // updater, which React may invoke mid-render.
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    writeFilters(next);
  };

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return formats
      .filter((f) => {
        if (filters.status !== "all" && f.status !== filters.status) return false;
        if (
          filters.vertical !== "all" &&
          !f.verticals_seen.includes(filters.vertical)
        ) {
          return false;
        }
        // "text" = text-confirmable (text or both); "visual" = visual-only
        if (filters.detection === "text" && f.detection === "visual") return false;
        if (filters.detection === "visual" && f.detection !== "visual") return false;
        if (
          q &&
          !f.name.toLowerCase().includes(q) &&
          !f.description.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort(SORTERS[filters.sort]);
  }, [formats, filters]);

  const selectClass =
    "border-input bg-background h-8 rounded-md border px-2 text-sm";

  return (
    <div className="mt-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={filters.vertical === "all"}
            onClick={() => update({ vertical: "all" })}
          >
            All
          </FilterChip>
          {SeedVertical.options.map((vertical) => (
            <FilterChip
              key={vertical}
              active={filters.vertical === vertical}
              onClick={() => update({ vertical })}
            >
              {vertical.toUpperCase()}
            </FilterChip>
          ))}
        </div>

        <select
          value={filters.status}
          onChange={(e) => update({ status: e.target.value as StatusFilter })}
          className={selectClass}
          aria-label="Status filter"
        >
          <option value="active">Active</option>
          <option value="fading">Fading</option>
          <option value="archived">Archived</option>
          <option value="all">All statuses</option>
        </select>

        <select
          value={filters.detection}
          onChange={(e) =>
            update({ detection: e.target.value as DetectionFilter })
          }
          className={selectClass}
          aria-label="Detection filter"
        >
          <option value="all">All detection</option>
          <option value="text">Text-confirmed</option>
          <option value="visual">Visual</option>
        </select>

        <select
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value as SortKey })}
          className={selectClass}
          aria-label="Sort"
        >
          {SORT_OPTIONS.map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>

        <div className="relative min-w-44 flex-1 sm:max-w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search formats…"
            className="h-8 pl-8"
            aria-label="Search formats"
          />
        </div>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No formats match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((format) => (
            <FormatCard
              key={format.id}
              format={format}
              onOpen={() => setOpenFormat(format)}
            />
          ))}
        </div>
      )}

      <FormatDetailDialog
        format={openFormat}
        onClose={() => setOpenFormat(null)}
      />
    </div>
  );
}
