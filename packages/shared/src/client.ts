import { z } from "zod";
import { BrandKitSchema } from "./asset";
import { SeedVertical } from "./enums";

export const ClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  niche: z.string().nullable(),
  // Drives format-library provenance and vertical-brief lookups.
  // default(null) keeps rows readable if the direction migration lags a
  // deploy; code falls back to 'coaching'.
  vertical: SeedVertical.nullable().catch(null).default(null),
  brief: z.string().nullable(),
  website: z.string().nullable(),
  drive_folder_id: z.string().nullable(),
  // default(null) keeps rows readable if the Phase 2.5 migration lags a
  // deploy; catch(null) degrades a malformed kit to "none" instead of
  // crashing every page that parses the client.
  brand_json: BrandKitSchema.nullable().catch(null).default(null),
  created_at: z.string(),
});
export type Client = z.infer<typeof ClientSchema>;

// Form input for create/edit. Empty strings normalize to null so optional
// fields stay NULL in the DB instead of accumulating "".
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null);

export const ClientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  niche: optionalText,
  vertical: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(SeedVertical.nullable())
    .default(""),
  brief: optionalText,
  website: optionalText.refine(
    (v) => v === null || /^https?:\/\/\S+\.\S+/.test(v),
    "Website must be a valid http(s) URL",
  ),
  drive_folder_id: optionalText,
});
export type ClientInput = z.infer<typeof ClientInputSchema>;
