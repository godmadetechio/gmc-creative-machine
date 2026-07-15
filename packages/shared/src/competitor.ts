import { z } from "zod";
import { CompetitorSource, CompetitorStatus } from "./enums";

// Competitor research as a first-class asset — scouted by an agent as step 0
// of creative selection, or added manually in the dashboard.

// A competitors row as read from the DB.
export const CompetitorSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  name: z.string().min(1),
  fb_page_url: z.string().nullable(),
  ig_handle: z.string().nullable(),
  website: z.string().nullable(),
  positioning_notes: z.string().nullable(),
  source: CompetitorSource,
  status: CompetitorStatus,
  created_at: z.string(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

// One competitor found by the competitor-scout agent.
export const ScoutedCompetitorSchema = z.object({
  name: z.string().min(1),
  /** Only when verified as the brand's real page — never guessed. */
  fb_page_url: z.string().optional(),
  ig_handle: z.string().optional(),
  website: z.string().optional(),
  positioning_notes: z.string().min(1),
  /** 5 = verified FB page + clearly direct competitor; 1 = adjacent guess. */
  confidence: z.number().int().min(1).max(5),
});
export type ScoutedCompetitor = z.infer<typeof ScoutedCompetitorSchema>;

export const CompetitorScoutOutputSchema = z.object({
  competitors: z.array(ScoutedCompetitorSchema).max(15),
});
export type CompetitorScoutOutput = z.infer<typeof CompetitorScoutOutputSchema>;
