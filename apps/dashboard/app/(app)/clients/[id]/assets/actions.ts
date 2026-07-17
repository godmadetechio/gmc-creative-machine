"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  AssetKind,
  BrandKitSchema,
  CLIENT_ASSETS_BUCKET,
} from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type AssetActionState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

// The file itself is uploaded straight from the browser to Storage (server
// actions would buffer multi-MB media through the Next.js body limit); this
// action only records the row once the upload succeeded.
const RegisterInputSchema = z
  .object({
    client_id: z.string().uuid(),
    kind: AssetKind,
    storage_path: z.string().min(1),
    notes: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v)),
  })
  .refine(
    (v) => v.storage_path.startsWith(`${v.client_id}/`),
    "storage_path must live under the client's folder",
  );

export async function registerAsset(
  input: z.input<typeof RegisterInputSchema>,
): Promise<AssetActionState> {
  const parsed = RegisterInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { client_id, kind, storage_path, notes } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("client_assets").insert({
    client_id,
    kind,
    bucket: CLIENT_ASSETS_BUCKET,
    storage_path,
    notes,
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/assets`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const DeleteInputSchema = z.object({
  asset_id: z.string().uuid(),
  client_id: z.string().uuid(),
});

export async function deleteAsset(
  _prevState: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = DeleteInputSchema.safeParse({
    asset_id: formData.get("asset_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { asset_id, client_id } = parsed.data;

  const supabase = await createClient();
  const { data: asset, error: fetchError } = await supabase
    .from("client_assets")
    .select("id, bucket, storage_path")
    .eq("id", asset_id)
    .eq("client_id", client_id)
    .maybeSingle();
  if (fetchError) {
    return { status: "error", message: fetchError.message };
  }
  if (!asset) {
    return { status: "error", message: "Asset not found" };
  }

  // Only uploads own their file. Inspiration assets point at ad-media files
  // shared with the candidates review page — the row goes, the file stays.
  if (asset.bucket === CLIENT_ASSETS_BUCKET) {
    const { error: storageError } = await supabase.storage
      .from(CLIENT_ASSETS_BUCKET)
      .remove([asset.storage_path]);
    if (storageError) {
      console.warn(
        `[assets] failed to remove ${asset.storage_path} from storage: ${storageError.message}`,
      );
    }
  }

  const { error } = await supabase
    .from("client_assets")
    .delete()
    .eq("id", asset_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/assets`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const SaveBrandKitInputSchema = z.object({
  client_id: z.string().uuid(),
  brand: BrandKitSchema,
});

export async function saveBrandKit(
  input: z.input<typeof SaveBrandKitInputSchema>,
): Promise<AssetActionState> {
  const parsed = SaveBrandKitInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: issue ? issue.message : "Invalid brand kit",
    };
  }
  const { client_id, brand } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({ brand_json: brand })
    .eq("id", client_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/assets`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}
