import { z } from "zod";

// Buyer Brain schemas — see GODMADE_SYSTEM_BUILD_PLAN.md section 4.

export const SignalType = z.enum(["pain", "desire", "belief", "pattern"]);
export type SignalType = z.infer<typeof SignalType>;

// One raw research finding from a miner. Quotes are verbatim — they become
// ad copy raw material, so paraphrasing is a validation-level concern too.
export const FindingSchema = z.object({
  quote: z.string().min(1),
  source_url: z.string().url(),
  platform: z.string().min(1),
  signal: SignalType,
  intensity: z.number().int().min(1).max(5),
  context: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const MinerOutputSchema = z.object({
  findings: z.array(FindingSchema),
});
export type MinerOutput = z.infer<typeof MinerOutputSchema>;

export const VerbatimQuoteSchema = z.object({
  quote: z.string().min(1),
  source_url: z.string().url(),
  platform: z.string().min(1),
});
export type VerbatimQuote = z.infer<typeof VerbatimQuoteSchema>;

export const BBMPainSchema = z.object({
  current: z.string(),
  future: z.string(),
  verbatim_quotes: z.array(VerbatimQuoteSchema).min(1),
  intensity: z.number().int().min(1).max(5),
  frequency: z.string(),
});

export const BBMDesireSchema = z.object({
  current: z.string(),
  future: z.string(),
  verbatim_quotes: z.array(VerbatimQuoteSchema).min(1),
  intensity: z.number().int().min(1).max(5),
});

export const BBMBeliefSchema = z.object({
  belief: z.string(),
  development: z.string(),
  breaking_angle: z.string(),
  verbatim_quotes: z.array(VerbatimQuoteSchema).min(1),
});

export const BBMPatternSchema = z.object({
  pattern: z.string(),
  implication: z.string(),
});

export const BBMSchema = z.object({
  client: z.string(),
  niche: z.string(),
  version: z.number().int().min(1),
  generated_at: z.string(),
  pains: z.array(BBMPainSchema).min(1),
  desires: z.array(BBMDesireSchema).min(1),
  beliefs: z.array(BBMBeliefSchema).min(1),
  patterns: z.array(BBMPatternSchema).min(1),
  language_bank: z.array(z.string()).min(1),
  sources_summary: z.record(z.number().int().min(0)),
  change_summary: z.string().optional(),
});
export type BBM = z.infer<typeof BBMSchema>;

// runs.input_json for a buyer_brain run.
export const BuyerBrainInputSchema = z.object({
  depth: z.enum(["quick", "full"]).default("full"),
  operator_prompt: z.string().default(""),
});
export type BuyerBrainInput = z.infer<typeof BuyerBrainInputSchema>;

// A bbm_versions row as read from the DB.
export const BbmVersionSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  version: z.number().int(),
  matrix_json: BBMSchema,
  sources_json: z.unknown().nullable(),
  created_at: z.string(),
  is_active: z.boolean(),
});
export type BbmVersion = z.infer<typeof BbmVersionSchema>;
