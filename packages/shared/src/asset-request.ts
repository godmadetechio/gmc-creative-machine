import { z } from "zod";
import { AssetKind } from "./enums";

// ASSET REQUESTS — non-blocking resource requests emitted by generation
// agents. HARD RULE encoded everywhere this schema is consumed: a request
// is never a reason to skip, degrade, or defer a creative — the concept is
// always fully generated with the best available fallback.

export const AssetRequestPriority = z.enum(["nice_to_have", "high_impact"]);
export type AssetRequestPriority = z.infer<typeof AssetRequestPriority>;

export const AssetRequestStatus = z.enum(["open", "fulfilled", "dismissed"]);
export type AssetRequestStatus = z.infer<typeof AssetRequestStatus>;

/** Max requests the concept agent may emit per run. */
export const MAX_ASSET_REQUESTS_PER_RUN = 5;

// What the concept agent emits alongside concepts.
export const AgentAssetRequestSchema = z.object({
  kind: AssetKind,
  /** Specifics of the asset wanted ("owner mid-workout, phone-shot, gym"). */
  detail: z.string().min(10),
  /** Why this improves the concept, 1-2 lines. */
  reason: z.string().min(10),
  priority: AssetRequestPriority,
  /** Index into the run's concepts array: the concept that used a fallback. */
  concept_index: z.number().int().min(0).nullable().default(null),
});
export type AgentAssetRequest = z.infer<typeof AgentAssetRequestSchema>;

// An asset_requests row as read from the DB.
export const AssetRequestSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  creative_id: z.string().uuid().nullable(),
  requested_kind: AssetKind,
  detail: z.string(),
  reason: z.string(),
  priority: AssetRequestPriority,
  status: AssetRequestStatus,
  fulfilled_asset_id: z.string().uuid().nullable(),
  possibly_fulfilled_asset_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type AssetRequest = z.infer<typeof AssetRequestSchema>;

const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "with", "and", "or", "in", "on", "at",
  "to", "shot", "photo", "image", "picture",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

// Dedupe gate for new requests against existing OPEN ones: same kind plus
// substantially-overlapping detail means the ask already exists. Token
// Jaccard keeps "Ben lifting kettlebell in gym" ≈ "gym photo of Ben with a
// kettlebell" without a model call.
export function isSimilarRequestDetail(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  const jaccard = overlap / (ta.size + tb.size - overlap);
  return jaccard >= 0.5;
}

// runs.input_json for a creative_regen run: re-run ONE creative's
// generation, either with a newly-fulfilled real asset as reference
// (asset mode) or with rejection feedback appended to the stored prompt
// (retry mode — salvages near-misses without a full run). Exactly one of
// asset_id / feedback is set; rows written before retry existed carry only
// asset_id and still parse.
export const CreativeRegenInputSchema = z
  .object({
    creative_id: z.string().uuid(),
    /** Asset mode: the fulfilled client_assets id to attach as reference. */
    asset_id: z.string().uuid().nullable().default(null),
    /** Retry mode: the rejection feedback to append as revision notes. */
    feedback: z.string().trim().min(5).nullable().default(null),
  })
  .refine(
    (v) => (v.asset_id != null) !== (v.feedback != null),
    "set exactly one of asset_id (asset mode) or feedback (retry mode)",
  );
export type CreativeRegenInput = z.infer<typeof CreativeRegenInputSchema>;
