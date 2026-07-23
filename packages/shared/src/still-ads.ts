import { z } from "zod";
import {
  AgentAssetRequestSchema,
  MAX_ASSET_REQUESTS_PER_RUN,
} from "./asset-request";
import { CreativeModel, CreativeStatus, CreativeType } from "./enums";

// Still Ad Creation (Phase 3) schemas — see GODMADE_SYSTEM_BUILD_PLAN.md
// section 6 and AI_ADS_TRAINING_INTEGRATION.md section 2.

/** Private bucket for generated creatives (signed-URL reads). */
export const CREATIVES_BUCKET = "creatives";

// Aspect ratios Nano Banana Pro accepts that we ship to Meta placements.
// Default runs render 4:5 only — extra aspects are money spent on creatives
// that may be rejected; approved winners get more aspects later (Phase 5.5).
export const AspectRatio = z.enum(["4:5", "1:1", "9:16", "16:9"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

// Which Client Asset Library material the generation call references —
// 'none' is plain text-to-image (build plan §6, Asset Library modes).
export const ReferenceMode = z.enum(["identity", "style", "product", "none"]);
export type ReferenceMode = z.infer<typeof ReferenceMode>;

// The concept's visual EXECUTION language — orthogonal to format (an
// "Us vs Them" format can be typographic or hand-drawn). First-class so
// diversity quotas can span it and reviewers can filter by it.
export const VisualTreatment = z.enum([
  "screenshot_ui",
  "typographic",
  "photography",
  "illustration",
  "handwritten",
  "meme",
]);
export type VisualTreatment = z.infer<typeof VisualTreatment>;

// ---------------------------------------------------------------------------
// Diversity quotas (the same-style problem). Enforced in the worker after
// concept validation; the concept agent is told the same numbers up front.
// Quotas scale down for small (smoke-test) runs via min(quota, concept_count).

export const MIN_DISTINCT_FORMATS = 4;
export const MAX_CONCEPTS_PER_FORMAT = 2;
export const MIN_DISTINCT_TREATMENTS = 3;

/**
 * Quota violations for a concept batch — empty array means the batch passes.
 * Pure so the worker (enforce + retry) and dashboard (plan display) agree.
 */
export function conceptDiversityViolations(
  concepts: Pick<StillConcept, "format_name" | "visual_treatment">[],
): string[] {
  const violations: string[] = [];
  const formatCounts = new Map<string, number>();
  for (const c of concepts) {
    const key = c.format_name.trim().toLowerCase();
    formatCounts.set(key, (formatCounts.get(key) ?? 0) + 1);
  }
  const treatments = new Set(concepts.map((c) => c.visual_treatment));

  const requiredFormats = Math.min(MIN_DISTINCT_FORMATS, concepts.length);
  if (formatCounts.size < requiredFormats) {
    violations.push(
      `only ${formatCounts.size} distinct formats — need at least ${requiredFormats}`,
    );
  }
  for (const [format, count] of formatCounts) {
    if (count > MAX_CONCEPTS_PER_FORMAT) {
      violations.push(
        `${count} concepts share format "${format}" — max ${MAX_CONCEPTS_PER_FORMAT} per format`,
      );
    }
  }
  const requiredTreatments = Math.min(MIN_DISTINCT_TREATMENTS, concepts.length);
  if (treatments.size < requiredTreatments) {
    violations.push(
      `only ${treatments.size} distinct visual treatments (${[...treatments].join(", ")}) — need at least ${requiredTreatments}`,
    );
  }
  return violations;
}

// One concept from the concept agent: FORMAT × ANGLE × AVATAR, hook-first.
export const StillConceptSchema = z.object({
  headline: z.string().min(1),
  subhead: z.string().min(1),
  visual_description: z.string().min(20),
  cta: z.string().min(1),
  /** Format library entry name, or a selected winner's skeleton name. */
  format_name: z.string().min(1),
  /**
   * Visual execution language, distinct from format. catch() keeps
   * pre-migration concept_json rows readable (they default to typographic,
   * the most common legacy execution).
   */
  visual_treatment: VisualTreatment.catch("typographic").default("typographic"),
  /** Exactly one named BBM avatar this concept speaks to. */
  avatar: z.string().min(1),
  /** The specific BBM pain/desire/belief cited, e.g. "pain: …" / "belief: …". */
  angle_ref: z.string().min(10),
  /** 3-5 genuinely diverse hooks — different angle or avatar, not rewordings. */
  hooks: z.array(z.string().min(1)).min(3).max(5),
  reference_mode: ReferenceMode,
  /** client_assets ids backing reference_mode; empty for 'none'. */
  referenced_asset_ids: z.array(z.string().uuid()).default([]),
  /** Set when format_name came from a selected winner's transferable skeleton. */
  source_candidate_id: z.string().uuid().nullable().default(null),
});
export type StillConcept = z.infer<typeof StillConceptSchema>;

// runs.input_json for a still_ads run.
export const StillAdsInputSchema = z.object({
  concept_count: z.number().int().min(1).max(20).default(10),
  /**
   * Statics per concept — one per hook (training §2b: hook-first). This is
   * the text-native count; photo-compositing concepts compile extra hooks
   * (+2, capped at 5) since generation attrition is expected there.
   */
  variants_per_concept: z.number().int().min(1).max(5).default(3),
  aspects: z.array(AspectRatio).min(1).max(4).default(["4:5"]),
  operator_prompt: z.string().default(""),
  /** Hard ceiling on image-generation spend for the run. */
  max_generation_usd: z.number().positive().max(200).default(15),
  /**
   * Auto mode: when true the run goes straight from concepts to image
   * generation. Default OFF — the run pauses at 'plan_review' so a human
   * directs the plan BEFORE money is spent on pixels.
   */
  skip_review: z.boolean().default(false),
  /**
   * Written by the dashboard's plan-review approval: the human-curated
   * (possibly edited) concepts to generate. When present the pipeline skips
   * the concept stage entirely and generates exactly these.
   */
  approved_concepts: z.array(StillConceptSchema).min(1).nullable().default(null),
});
export type StillAdsInput = z.infer<typeof StillAdsInputSchema>;

// runs.output_json while a still_ads run is paused at status 'plan_review':
// the text-only concept plan awaiting human approval. Kept minimal — the
// dashboard renders/edits `plan.concepts` and writes the curated result back
// into input_json.approved_concepts.
export const StillAdsPlanSchema = z.object({
  concepts: z.array(StillConceptSchema).min(1),
});
export type StillAdsPlan = z.infer<typeof StillAdsPlanSchema>;

export const StillAdsPlanOutputSchema = z.object({
  plan: StillAdsPlanSchema,
});

export const ConceptAgentOutputSchema = z.object({
  concepts: z.array(StillConceptSchema).min(1),
  // NON-BLOCKING asset wishes — never a reason to skip/degrade a concept.
  asset_requests: z
    .array(AgentAssetRequestSchema)
    .max(MAX_ASSET_REQUESTS_PER_RUN)
    .default([]),
});
export type ConceptAgentOutput = z.infer<typeof ConceptAgentOutputSchema>;

// Image-compiler output: final generation prompts, one per (concept, hook).
// Indices refer to the concept/hook arrays the compiler was shown — resolved
// and validated in code so the agent can never invent a pairing.
export const CompiledVariantSchema = z.object({
  concept_index: z.number().int().min(0),
  hook_index: z.number().int().min(0),
  /** The full text prompt sent to the image model. */
  prompt: z.string().min(40),
});
export type CompiledVariant = z.infer<typeof CompiledVariantSchema>;

export const CompilerOutputSchema = z.object({
  variants: z.array(CompiledVariantSchema).min(1),
});
export type CompilerOutput = z.infer<typeof CompilerOutputSchema>;

// One rendered file of a variant (a variant = one creatives row; extra
// aspects of the same variant live in the same row's aspect_files).
export const AspectFileSchema = z.object({
  aspect: AspectRatio,
  storage_path: z.string().min(1),
});
export type AspectFile = z.infer<typeof AspectFileSchema>;

// A creatives row as read from the DB. Phase 3 columns default(null) so rows
// written before the still_ads migration stay readable.
export const CreativeSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  ad_candidate_id: z.string().uuid().nullable(),
  run_id: z.string().uuid().nullable().default(null),
  type: CreativeType,
  avatar: z.string().nullable().default(null),
  hook: z.string().nullable().default(null),
  framework: z.string().nullable().default(null),
  prompt_used: z.string().nullable(),
  model: CreativeModel.nullable(),
  storage_path: z.string().nullable().default(null),
  aspect_files: z.array(AspectFileSchema).nullable().default(null),
  concept_json: z.unknown().nullable().default(null),
  file_url: z.string().nullable(),
  drive_file_id: z.string().nullable(),
  status: CreativeStatus,
  feedback: z.string().nullable(),
  cost_usd: z.number().nullable().default(null),
  created_at: z.string(),
});
export type Creative = z.infer<typeof CreativeSchema>;

// A winning_creatives row — the per-client Winning Creative Doc.
export const WinningCreativeSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  creative_id: z.string().uuid(),
  concept_summary: z.string().min(1),
  why_approved: z.string().nullable(),
  created_at: z.string(),
});
export type WinningCreative = z.infer<typeof WinningCreativeSchema>;

// Creative → one-line Winning Creative Doc entry. Pure mapping so the
// dashboard approve action and future iteration briefs summarize identically.
export function conceptSummaryForCreative(creative: {
  avatar: string | null;
  hook: string | null;
  framework: string | null;
  concept_json: unknown;
}): string {
  const concept = StillConceptSchema.safeParse(creative.concept_json);
  const parts = [
    creative.framework ? `format: ${creative.framework}` : null,
    creative.avatar ? `avatar: ${creative.avatar}` : null,
    concept.success ? `angle: ${concept.data.angle_ref}` : null,
    creative.hook ? `hook: "${creative.hook}"` : null,
    concept.success ? `headline: "${concept.data.headline}"` : null,
  ].filter((p): p is string => p != null);
  return parts.length > 0 ? parts.join(" · ") : "creative approved";
}
