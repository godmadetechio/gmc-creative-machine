import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageCount, PAGE_SIZE } from "@/lib/pagination";
import { Button } from "@/components/ui/button";

// Link-based pager (server component) — callers supply makeHref so every
// other searchParam (tab, filters, q) is preserved. Renders nothing for a
// single page.
export function PaginationBar({
  page,
  totalCount,
  makeHref,
  label,
}: {
  page: number;
  totalCount: number;
  makeHref: (page: number) => string;
  /** Plural noun for the count line, e.g. "competitors". */
  label: string;
}) {
  const pages = pageCount(totalCount);
  if (totalCount <= PAGE_SIZE && page === 1) return null;
  const clamped = Math.min(page, pages);
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        {totalCount} {label} · page {clamped} of {pages}
      </p>
      <div className="flex items-center gap-1">
        {clamped > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={makeHref(clamped - 1)} rel="prev">
              <ChevronLeft />
              Prev
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft />
            Prev
          </Button>
        )}
        {clamped < pages ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={makeHref(clamped + 1)} rel="next">
              Next
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
