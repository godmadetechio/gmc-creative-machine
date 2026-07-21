import { z } from "zod";
import { SeedVertical } from "./enums";

// GLOBAL REFERENCE LIBRARY — the agency-wide visual swipe file (image
// counterpart to format_library). Global rows are agency-curated; each
// client picks the references its generation runs use.

/** Private bucket for swipe-file images (signed-URL reads). */
export const REFERENCE_LIBRARY_BUCKET = "reference-library";

// 'needs_review': AI-annotated, awaiting human approval — visible in the
// Swipe File but excluded from client picks and generation manifests until
// approved (only 'active' references flow into runs).
export const ReferenceStatus = z.enum(["active", "needs_review", "archived"]);
export type ReferenceStatus = z.infer<typeof ReferenceStatus>;

// Who authored the current annotation. null = unannotated (eligible for
// the next reference_annotate run). Human-edited annotations are never
// overwritten by re-annotation.
export const AnnotationSource = z.enum(["ai", "human"]);
export type AnnotationSource = z.infer<typeof AnnotationSource>;

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
  // default(null) keeps rows readable if the annotate migration lags a deploy
  annotation_source: AnnotationSource.nullable().default(null),
  created_at: z.string(),
});
export type ReferenceLibraryEntry = z.infer<typeof ReferenceLibraryEntrySchema>;

// runs.input_json for a reference_annotate run (a global run: client_id null).
export const ReferenceAnnotateInputSchema = z.object({
  /** Max references annotated per run — the rest wait for the next run. */
  limit: z.number().int().min(1).max(100).default(40),
});
export type ReferenceAnnotateInput = z.infer<typeof ReferenceAnnotateInputSchema>;

// Vision-agent output for ONE reference image. format_name must be an
// exact conceptual match to a format_library entry or null — enforced in
// code against the real library, so the agent can never invent formats.
export const ReferenceAnnotationSchema = z.object({
  title: z.string().min(3).max(80),
  /** The what-to-take / what-to-ignore / use-when brief. */
  notes: z.string().min(30),
  /** kebab-case tags from the controlled vocabulary (extendable). */
  tags: z
    .array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "tags must be kebab-case"))
    .min(1)
    .max(8),
  vertical: SeedVertical.nullable(),
  format_name: z.string().nullable(),
});
export type ReferenceAnnotation = z.infer<typeof ReferenceAnnotationSchema>;

// A client_reference_picks row as read from the DB.
export const ClientReferencePickSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  reference_id: z.string().uuid(),
  note_override: z.string().nullable(),
  created_at: z.string(),
});
export type ClientReferencePick = z.infer<typeof ClientReferencePickSchema>;
