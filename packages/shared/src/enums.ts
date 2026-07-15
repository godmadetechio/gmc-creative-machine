import { z } from "zod";

// Mirrors the Postgres enums in supabase/migrations — keep in lockstep.

export const RunType = z.enum([
  "buyer_brain",
  "creative_selection",
  "still_ads",
  "video_ads",
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

export const CandidateStatus = z.enum(["candidate", "selected", "rejected"]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const CreativeType = z.enum(["static", "carousel", "ugc", "hero_arc"]);
export type CreativeType = z.infer<typeof CreativeType>;

export const CreativeModel = z.enum(["nano_banana", "higgsfield", "arcads"]);
export type CreativeModel = z.infer<typeof CreativeModel>;

export const CreativeStatus = z.enum(["draft", "approved", "rejected"]);
export type CreativeStatus = z.infer<typeof CreativeStatus>;

export const CompetitorSource = z.enum(["agent", "manual", "bbm_research"]);
export type CompetitorSource = z.infer<typeof CompetitorSource>;

export const CompetitorStatus = z.enum(["active", "ignored"]);
export type CompetitorStatus = z.infer<typeof CompetitorStatus>;
