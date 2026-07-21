"use server";

import { revalidatePath } from "next/cache";
import { ClientInputSchema } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type ClientFormState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

export async function saveClient(
  _prevState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const parsed = ClientInputSchema.safeParse({
    name: formData.get("name"),
    niche: formData.get("niche"),
    vertical: formData.get("vertical") ?? "",
    brief: formData.get("brief"),
    website: formData.get("website"),
    drive_folder_id: formData.get("drive_folder_id"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { status: "error", message: first?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const id = formData.get("id");

  const { error } =
    typeof id === "string" && id !== ""
      ? await supabase.from("clients").update(parsed.data).eq("id", id)
      : await supabase.from("clients").insert(parsed.data);

  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/clients");
  return { status: "success" };
}

export async function deleteClient(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    throw new Error(`Failed to delete client: ${error.message}`);
  }
  revalidatePath("/clients");
}
