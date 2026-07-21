import { z } from "zod";
import { SeedVertical } from "./enums";

// GLOBAL REFERENCE LIBRARY — the agency-wide visual swipe file (image
// counterpart to format_library). Global rows are agency-curated; each
// client picks the references its generation runs use.

/** Private bucket for swipe-file images (signed-URL reads). */
export const REFERENCE_LIBRARY_BUCKET = "reference-library";

export const ReferenceStatus = z.enum(["active", "archived"]);
export type ReferenceStatus = z.infer<typeof ReferenceStatus>;

// A reference_library row as read from the DB.
export const ReferenceLibraryEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  storage_path: z.string().min(1),
  source_url: z.string().nullable(),
  /** The what-to-take / what-to-ignore / use-when brief. */
  notes: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  vertical: SeedVertical.nullable(),
  /** Set when this reference exemplifies a format_library format. */
  format_name: z.string().nullable(),
  status: ReferenceStatus,
  created_at: z.string(),
});
export type ReferenceLibraryEntry = z.infer<typeof ReferenceLibraryEntrySchema>;

// A client_reference_picks row as read from the DB.
export const ClientReferencePickSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  reference_id: z.string().uuid(),
  note_override: z.string().nullable(),
  created_at: z.string(),
});
export type ClientReferencePick = z.infer<typeof ClientReferencePickSchema>;
