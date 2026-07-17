import { z } from "zod";
import { AssetKind } from "./enums";
import { MirroredMediaSchema } from "./creative-selection";

// Client Asset Library (Phase 2.5) — see GODMADE_SYSTEM_BUILD_PLAN.md
// section 6, "The Client Asset Library".

/** Private bucket for operator-uploaded client assets (signed-URL reads). */
export const CLIENT_ASSETS_BUCKET = "client-assets";
/** Public bucket holding media mirrored from selected ad candidates. */
export const AD_MEDIA_BUCKET = "ad-media";

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// clients.brand_json. Everything defaults to empty so a half-filled kit
// round-trips cleanly.
export const BrandKitSchema = z.object({
  /** Brand colors as hex codes, e.g. "#0F172A". */
  colors: z.array(z.string().regex(HEX_COLOR_RE, "must be a hex color like #1A2B3C")).default([]),
  fonts: z.array(z.string().trim().min(1)).default([]),
  tone_notes: z.string().default(""),
  /** Do/don't rules, e.g. "never show scales", "no red". */
  rules: z.array(z.string().trim().min(1)).default([]),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

// A client_assets row as read from the DB.
export const ClientAssetSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  kind: AssetKind,
  bucket: z.string(),
  storage_path: z.string(),
  drive_file_id: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  source_candidate_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type ClientAsset = z.infer<typeof ClientAssetSchema>;

// What auto-registration needs from an ad_candidates row.
export const InspirationSourceCandidateSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  advertiser: z.string().nullable(),
  match_score: z.number().int().nullable(),
  match_rationale_json: z.unknown().nullable(),
  media_storage_paths: z.array(MirroredMediaSchema).nullable(),
});
export type InspirationSourceCandidate = z.infer<
  typeof InspirationSourceCandidateSchema
>;

export type InspirationAssetRow = {
  client_id: string;
  kind: "inspiration_ad";
  bucket: string;
  storage_path: string;
  notes: string;
  source_candidate_id: string;
};

// Selected candidate → inspiration_ad asset rows, one per mirrored media
// file. Pure mapping (no IO) so the dashboard review action and the worker
// backfill script register identically. Upsert the result on
// (bucket, storage_path) to stay idempotent.
export function inspirationAssetsForCandidate(
  candidate: InspirationSourceCandidate,
): InspirationAssetRow[] {
  const skeleton = z
    .object({ transferable_skeleton: z.string() })
    .safeParse(candidate.match_rationale_json);

  const notes = [
    candidate.advertiser ?? "Unknown advertiser",
    candidate.match_score != null ? `score ${candidate.match_score}` : null,
    skeleton.success ? skeleton.data.transferable_skeleton : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  return (candidate.media_storage_paths ?? []).map((media) => ({
    client_id: candidate.client_id,
    kind: "inspiration_ad",
    bucket: AD_MEDIA_BUCKET,
    storage_path: media.storage_path,
    notes,
    source_candidate_id: candidate.id,
  }));
}
