import { type Client } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

// Creative readiness — the material still_ads runs need to produce
// non-generic output. Computed server-side and shared by the Overview
// meter, the Run Still Ads button (soft-block) and the enqueue action
// (authoritative re-check). Distinct from the hard pipeline gates
// (active BBM, selected winner), which stay non-overridable.

export const MIN_STYLE_REFERENCES = 5;

export type ReadinessItem = {
  key: "style_refs" | "brand_colors" | "brief";
  label: string;
  ok: boolean;
  /** What exists / what's missing, shown verbatim in the UI. */
  detail: string;
  /** Where to fix it (tab URL). */
  href: string;
};

export type ClientReadiness = {
  ready: boolean;
  items: ReadinessItem[];
};

export async function getClientReadiness(client: Client): Promise<ClientReadiness> {
  const supabase = await createClient();
  const [picksResult, inspirationResult] = await Promise.all([
    supabase
      .from("client_reference_picks")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id),
    supabase
      .from("client_assets")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("kind", "inspiration_ad"),
  ]);

  const picks = picksResult.count ?? 0;
  const inspiration = inspirationResult.count ?? 0;
  const styleRefs = picks + inspiration;
  const colors = client.brand_json?.colors ?? [];
  const hasBrief = (client.brief ?? "").trim().length > 0;
  const assetsHref = `/clients/${client.id}?tab=assets`;

  const items: ReadinessItem[] = [
    {
      key: "style_refs",
      label: "Style references",
      ok: styleRefs >= MIN_STYLE_REFERENCES,
      detail:
        styleRefs >= MIN_STYLE_REFERENCES
          ? `${styleRefs} selected (${picks} swipe-file picks + ${inspiration} inspiration ads)`
          : `${styleRefs} of ${MIN_STYLE_REFERENCES} — pick swipe-file references or select winning ads (inspiration ads count)`,
      href: assetsHref,
    },
    {
      key: "brand_colors",
      label: "Brand kit colors",
      ok: colors.length > 0,
      detail:
        colors.length > 0
          ? `${colors.length} color${colors.length === 1 ? "" : "s"} set`
          : "no colors in the brand kit — creatives fall back to generic palettes",
      href: assetsHref,
    },
    {
      key: "brief",
      label: "Client brief",
      ok: hasBrief,
      detail: hasBrief
        ? "brief on file"
        : "no brief — the concept agent flies blind on offer and positioning",
      href: `/clients/${client.id}?tab=overview`,
    },
  ];

  return { ready: items.every((i) => i.ok), items };
}
