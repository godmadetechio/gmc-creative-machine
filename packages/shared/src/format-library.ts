import { z } from "zod";
import {
  FormatDetection,
  FormatStatus,
  SeedAdvertiserStatus,
  SeedVertical,
} from "./enums";

// FORMAT LIBRARY (agency-level, cross-client) schemas — see
// AI_ADS_TRAINING_INTEGRATION.md §2a. Formats are layout/structure patterns
// (us-vs-them, testimonial card, …), not topics or offers.

// One example ad attached to a format, built in code from a real scraped ad.
export const FormatExampleAdSchema = z.object({
  advertiser: z.string().nullable(),
  ad_url: z.string(),
  copy_snippet: z.string(),
  vertical: SeedVertical,
  days_running: z.number().int().nullable(),
});
export type FormatExampleAd = z.infer<typeof FormatExampleAdSchema>;

// A format_library row as read from the DB.
export const FormatLibraryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  psychology: z.string(),
  skeleton: z.string(),
  example_ads: z.array(FormatExampleAdSchema).default([]),
  verticals_seen: z.array(SeedVertical).default([]),
  status: FormatStatus,
  // default keeps rows readable if the detection migration lags a deploy
  detection: FormatDetection.default("text"),
  scans_missed: z.number().int().default(0),
  first_seen: z.string(),
  last_confirmed: z.string().nullable(),
  created_at: z.string(),
});
export type FormatLibraryEntry = z.infer<typeof FormatLibraryEntrySchema>;

// A format_seed_advertisers row as read from the DB.
export const FormatSeedAdvertiserSchema = z.object({
  id: z.string().uuid(),
  vertical: SeedVertical,
  name: z.string().min(1),
  fb_page_url: z.string(),
  status: SeedAdvertiserStatus,
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type FormatSeedAdvertiser = z.infer<typeof FormatSeedAdvertiserSchema>;

// runs.input_json for a format_scan run (a global run: runs.client_id null).
export const FormatScanInputSchema = z.object({
  /** Ads pulled per advertiser page. The Apify actor bills a minimum of 10
   * charged results per run — values below 10 are clamped to 10 by
   * buildActorInput (and billed as 10). */
  limit_per_advertiser: z.number().int().min(3).max(30).default(25),
  /** ISO 3166-1 alpha-2, passed to the Apify actor's country filter. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/i, "country must be a 2-letter code")
    .transform((c) => c.toUpperCase())
    .default("US"),
  /** Restrict the scan to one vertical — for cheap smoke tests. A
   * vertical-restricted scan never runs the fading pass. */
  vertical: SeedVertical.optional(),
});
export type FormatScanInput = z.infer<typeof FormatScanInputSchema>;

// Format-extractor agent output: a DELTA against the library it was shown.
// The pipeline applies the merge in code and resolves example_ad_ids against
// the real scraped ads, so the agent can never mutate existing rows or
// invent ad URLs.
export const FormatExtractorOutputSchema = z.object({
  confirmations: z.array(
    z.object({
      format_id: z.string().min(1),
      example_ad_ids: z.array(z.string().min(1)).max(3),
    }),
  ),
  new_formats: z
    .array(
      z.object({
        name: z.string().min(3).max(60),
        description: z.string().min(10),
        psychology: z.string().min(10),
        skeleton: z.string().min(10),
        // 2+ real ads before something counts as a format.
        example_ad_ids: z.array(z.string().min(1)).min(2).max(5),
      }),
    )
    .max(8),
});
export type FormatExtractorOutput = z.infer<typeof FormatExtractorOutputSchema>;
