import { z } from "zod";

// Mirrors the Postgres enums in supabase/migrations — keep in lockstep.

export const RunType = z.enum([
  "buyer_brain",
  "creative_selection",
  "still_ads",
  "video_ads",
  "format_scan",
  "reference_annotate",
]);
export type RunType = z.infer<typeof RunType>;

export const RunStatus = z.enum([
  "queued",
  "running",
  "needs_review",
  "approved",
  "failed",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const CandidateStatus = z.enum([
  "candidate",
  "selected",
  "rejected",
  "superseded",
]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const CreativeType = z.enum(["static", "carousel", "ugc", "hero_arc"]);
export type CreativeType = z.infer<typeof CreativeType>;

export const CreativeModel = z.enum(["nano_banana", "higgsfield", "arcads"]);
export type CreativeModel = z.infer<typeof CreativeModel>;

export const CreativeStatus = z.enum(["draft", "approved", "rejected"]);
export type CreativeStatus = z.infer<typeof CreativeStatus>;

export const AssetKind = z.enum([
  "owner_photo",
  "logo",
  "product_shot",
  "lifestyle_photo",
  "example_ad",
  "inspiration_ad",
  "testimonial_screenshot",
  "brand_doc",
]);
export type AssetKind = z.infer<typeof AssetKind>;

export const CompetitorSource = z.enum([
  "agent",
  "manual",
  "bbm_research",
  "ad_library_discovery",
]);
export type CompetitorSource = z.infer<typeof CompetitorSource>;

export const CompetitorStatus = z.enum(["active", "ignored"]);
export type CompetitorStatus = z.infer<typeof CompetitorStatus>;

export const CompetitorAdStatus = z.enum(["unknown", "active", "not_running"]);
export type CompetitorAdStatus = z.infer<typeof CompetitorAdStatus>;

export const FormatStatus = z.enum(["active", "fading", "archived"]);
export type FormatStatus = z.infer<typeof FormatStatus>;

export const SeedVertical = z.enum(["dtc", "saas", "coaching", "info", "other"]);
export type SeedVertical = z.infer<typeof SeedVertical>;

export const SeedAdvertiserStatus = z.enum(["active", "inactive"]);
export type SeedAdvertiserStatus = z.infer<typeof SeedAdvertiserStatus>;

// How a format can be recognized in scraped ads: 'text' via ad copy,
// 'visual' only by looking at the creative (exempt from fading until a
// vision pass exists), 'both' when either works.
export const FormatDetection = z.enum(["text", "visual", "both"]);
export type FormatDetection = z.infer<typeof FormatDetection>;
