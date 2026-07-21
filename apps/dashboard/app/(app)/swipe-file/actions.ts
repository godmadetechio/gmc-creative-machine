"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReferenceStatus, SeedVertical } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type ReferenceActionState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

// Comma-separated tags → clean array ("native-look, big-headline" style).
const tagsField = z
  .string()
  .transform((v) =>
    [...new Set(v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))],
  );

const verticalField = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .pipe(SeedVertical.nullable());

// The file goes browser → Storage (no server-action body limit); this only
// records the row once the upload succeeded.
const RegisterInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  storage_path: z.string().min(1),
  source_url: optionalText,
  notes: optionalText,
  tags: tagsField,
  vertical: verticalField,
});

export async function registerReference(
  input: z.input<typeof RegisterInputSchema>,
): Promise<ReferenceActionState> {
  const parsed = RegisterInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  // Notes typed at upload are human judgment; a bare upload stays
  // unannotated (annotation_source null) — the annotation run's target set.
  const { error } = await supabase.from("reference_library").insert({
    ...parsed.data,
    annotation_source: parsed.data.notes ? "human" : null,
    annotated_at: parsed.data.notes ? new Date().toISOString() : null,
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/swipe-file");
  return { status: "success" };
}

// "Annotate new (N)": enqueue a global reference_annotate run — the worker's
// vision agent drafts title/notes/tags/vertical/format for unannotated
// uploads, which land back here as "AI notes — review" cards.
export async function enqueueReferenceAnnotation(): Promise<ReferenceActionState> {
  const supabase = await createClient();

  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("type", "reference_annotate")
    .in("status", ["queued", "running"])
    .limit(1);
  if (activeError) {
    return { status: "error", message: activeError.message };
  }
  if (active && active.length > 0) {
    return {
      status: "error",
      message: "An annotation run is already queued or running.",
    };
  }

  const { error } = await supabase.from("runs").insert({
    client_id: null,
    type: "reference_annotate",
    status: "queued",
    input_json: {},
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/swipe-file");
  revalidatePath("/runs");
  return { status: "success" };
}

const ApproveInputSchema = z.object({
  reference_id: z.string().uuid(),
});

// One-click approve of an AI annotation: the reference joins the pool
// clients can pick from. The notes keep source 'ai' — only a human EDIT
// flips them to 'human' (see updateReference).
export async function approveReference(
  _prevState: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  const parsed = ApproveInputSchema.safeParse({
    reference_id: formData.get("reference_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("reference_library")
    .update({ status: "active" })
    .eq("id", parsed.data.reference_id)
    .eq("status", "needs_review");
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/swipe-file");
  return { status: "success" };
}

const UpdateInputSchema = z.object({
  reference_id: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required"),
  source_url: optionalText,
  notes: optionalText,
  tags: tagsField,
  vertical: verticalField,
  format_name: optionalText,
});

export async function updateReference(
  _prevState: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  const parsed = UpdateInputSchema.safeParse({
    reference_id: formData.get("reference_id"),
    title: formData.get("title"),
    source_url: formData.get("source_url") ?? "",
    notes: formData.get("notes") ?? "",
    tags: formData.get("tags") ?? "",
    vertical: formData.get("vertical") ?? "",
    format_name: formData.get("format_name") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { reference_id, ...fields } = parsed.data;

  const supabase = await createClient();
  // A human save takes ownership of the annotation: source flips to 'human'
  // (re-annotation will never touch it again) and edit-then-approve — a
  // needs_review row that gets edited is thereby reviewed.
  const { error } = await supabase
    .from("reference_library")
    .update({
      ...fields,
      annotation_source: "human",
      annotated_at: new Date().toISOString(),
    })
    .eq("id", reference_id);
  if (error) {
    return { status: "error", message: error.message };
  }
  const { error: statusError } = await supabase
    .from("reference_library")
    .update({ status: "active" })
    .eq("id", reference_id)
    .eq("status", "needs_review");
  if (statusError) {
    return { status: "error", message: statusError.message };
  }

  revalidatePath("/swipe-file");
  return { status: "success" };
}

const StatusInputSchema = z.object({
  reference_id: z.string().uuid(),
  status: ReferenceStatus,
});

export async function setReferenceStatus(
  _prevState: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  const parsed = StatusInputSchema.safeParse({
    reference_id: formData.get("reference_id"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }

  const supabase = await createClient();
  // Archive, don't delete: picks and past runs keep their history; archived
  // references simply stop flowing into new generation runs.
  const { error } = await supabase
    .from("reference_library")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.reference_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/swipe-file");
  return { status: "success" };
}
