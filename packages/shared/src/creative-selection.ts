import { z } from "zod";
import { CandidateStatus } from "./enums";

// Creative Selection (Step 1.B) schemas — see GODMADE_SYSTEM_BUILD_PLAN.md
// section 5.

// runs.input_json for a creative_selection run.
export const CreativeSelectionInputSchema = z.object({
  max_candidates: z.number().int().min(5).max(100).default(25),
  /** ISO 3166-1 alpha-2, used in the Ad Library search URL. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/i, "country must be a 2-letter code")
    .transform((c) => c.toUpperCase())
    .default("US"),
  operator_prompt: z.string().default(""),
});
export type CreativeSelectionInput = z.infer<typeof CreativeSelectionInputSchema>;

// One Ad Library search target from the search-deriver agent. The Apify
// actor takes URLs, not keywords: 'keyword' targets are converted into
// Ad Library search URLs, 'page_url' targets are per-advertiser pulls.
export const SearchTargetSchema = z.object({
  kind: z.enum(["keyword", "page_url"]),
  value: z.string().min(2),
  /** Which BBM pain/desire/belief this target is expected to surface. */
  rationale: z.string().min(1),
});
export type SearchTarget = z.infer<typeof SearchTargetSchema>;

export const SearchTargetsSchema = z.object({
  targets: z.array(SearchTargetSchema).min(5).max(10),
});
export type SearchTargets = z.infer<typeof SearchTargetsSchema>;

// Regex rather than new URL(): this package compiles against pure ES2022
// (no DOM/Node globals). A page URL is https://…facebook.com/<something>
// that is not an /ads/… (Ad Library) path.
const FB_PAGE_URL_RE = /^https:\/\/(?:[\w-]+\.)?facebook\.com\/(?!ads\b)[\w.\-%]/i;

export function isValidFacebookPageUrl(value: string): boolean {
  return FB_PAGE_URL_RE.test(value);
}

// Per-ad output of the cross-reference scorer (rubric: angle match 40,
// belief work 30, longevity 20, transferability 10).
export const AdScoreSchema = z.object({
  ad_id: z.string().min(1),
  score: z.number().int().min(0).max(100),
  angle_match: z.object({
    pain_or_desire: z.string(),
    directness: z.string(),
  }),
  belief_work: z.object({
    belief: z.string(),
    mechanism: z.string(),
  }),
  hook_pattern: z.string(),
  format: z.string(),
  transferable_skeleton: z.string(),
  match_rationale: z.string().min(1),
});
export type AdScore = z.infer<typeof AdScoreSchema>;

export const ScorerOutputSchema = z.object({
  scores: z.array(AdScoreSchema),
});
export type ScorerOutput = z.infer<typeof ScorerOutputSchema>;

// An ad_candidates row as read from the DB.
export const AdCandidateSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  bbm_version_id: z.string().uuid().nullable(),
  source: z.string(),
  advertiser: z.string().nullable(),
  ad_url: z.string().nullable(),
  media_urls: z.array(z.string()).nullable(),
  ad_copy: z.string().nullable(),
  run_time_days: z.number().int().nullable(),
  match_score: z.number().int().min(0).max(100).nullable(),
  match_rationale_json: z.unknown().nullable(),
  status: CandidateStatus,
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});
export type AdCandidate = z.infer<typeof AdCandidateSchema>;
