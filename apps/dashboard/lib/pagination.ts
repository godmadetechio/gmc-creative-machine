// Shared server-side pagination: 25 per page, ?page= + ?q= searchParams,
// Supabase .range() windows. Used by competitors, candidates, references
// and the runs page.

export const PAGE_SIZE = 25;

export type PageParams = {
  page: number;
  q: string;
  /** Inclusive range bounds for supabase .range(from, to). */
  from: number;
  to: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

export function parsePageParams(
  sp: SearchParams,
  opts: { pageKey?: string; qKey?: string } = {},
): PageParams {
  const rawPage = sp[opts.pageKey ?? "page"];
  const rawQ = sp[opts.qKey ?? "q"];
  const page = Math.max(1, Math.floor(Number(typeof rawPage === "string" ? rawPage : "1")) || 1);
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  return { page, q, from: (page - 1) * PAGE_SIZE, to: page * PAGE_SIZE - 1 };
}

export function pageCount(totalCount: number): number {
  return Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
}

/** Escape %/_ so user input can't act as ilike wildcards. */
export function ilikePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}
