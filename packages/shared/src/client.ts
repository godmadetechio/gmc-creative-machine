import { z } from "zod";

export const ClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  niche: z.string().nullable(),
  brief: z.string().nullable(),
  website: z.string().nullable(),
  drive_folder_id: z.string().nullable(),
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
  brief: optionalText,
  website: optionalText.refine(
    (v) => v === null || /^https?:\/\/\S+\.\S+/.test(v),
    "Website must be a valid http(s) URL",
  ),
  drive_folder_id: optionalText,
});
export type ClientInput = z.infer<typeof ClientInputSchema>;
