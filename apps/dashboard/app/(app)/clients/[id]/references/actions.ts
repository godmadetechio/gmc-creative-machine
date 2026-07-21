"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type PickActionState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const ToggleInputSchema = z.object({
  client_id: z.string().uuid(),
  reference_id: z.string().uuid(),
  picked: z.enum(["true", "false"]),
});

export async function toggleReferencePick(
  _prevState: PickActionState,
  formData: FormData,
): Promise<PickActionState> {
  const parsed = ToggleInputSchema.safeParse({
    client_id: formData.get("client_id"),
    reference_id: formData.get("reference_id"),
    picked: formData.get("picked"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { client_id, reference_id, picked } = parsed.data;

  const supabase = await createClient();
  if (picked === "true") {
    const { error } = await supabase
      .from("client_reference_picks")
      .upsert(
        { client_id, reference_id },
        { onConflict: "client_id,reference_id" },
      );
    if (error) return { status: "error", message: error.message };
  } else {
    const { error } = await supabase
      .from("client_reference_picks")
      .delete()
      .eq("client_id", client_id)
      .eq("reference_id", reference_id);
    if (error) return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/references`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const NoteInputSchema = z.object({
  client_id: z.string().uuid(),
  reference_id: z.string().uuid(),
  note_override: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v)),
});

export async function saveReferencePickNote(
  _prevState: PickActionState,
  formData: FormData,
): Promise<PickActionState> {
  const parsed = NoteInputSchema.safeParse({
    client_id: formData.get("client_id"),
    reference_id: formData.get("reference_id"),
    note_override: formData.get("note_override") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { client_id, reference_id, note_override } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_reference_picks")
    .update({ note_override })
    .eq("client_id", client_id)
    .eq("reference_id", reference_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/references`);
  return { status: "success" };
}
