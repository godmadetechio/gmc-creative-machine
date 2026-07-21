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
  const { error } = await supabase.from("reference_library").insert(parsed.data);
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
  const { error } = await supabase
    .from("reference_library")
    .update(fields)
    .eq("id", reference_id);
  if (error) {
    return { status: "error", message: error.message };
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
