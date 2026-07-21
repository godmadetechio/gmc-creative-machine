"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CLIENT_ASSETS_BUCKET } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

// Server actions for the Asset Requests section on the client page.
// Files are uploaded browser → Storage first (no server-action body limit);
// these actions only record rows and state transitions.

export type AssetRequestActionState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const FulfillInputSchema = z
  .object({
    request_id: z.string().uuid(),
    client_id: z.string().uuid(),
    storage_path: z.string().min(1),
  })
  .refine(
    (v) => v.storage_path.startsWith(`${v.client_id}/`),
    "storage_path must live under the client's folder",
  );

export async function fulfillAssetRequest(
  input: z.input<typeof FulfillInputSchema>,
): Promise<AssetRequestActionState> {
  const parsed = FulfillInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { request_id, client_id, storage_path } = parsed.data;

  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase
    .from("asset_requests")
    .select("id, requested_kind, detail")
    .eq("id", request_id)
    .eq("client_id", client_id)
    .eq("status", "open")
    .maybeSingle();
  if (requestError) return { status: "error", message: requestError.message };
  if (!request) return { status: "error", message: "Request not found or already handled" };

  // The upload becomes a first-class Asset Library entry of the requested
  // kind — usable by every future run, not just this request.
  const { data: asset, error: assetError } = await supabase
    .from("client_assets")
    .insert({
      client_id,
      kind: request.requested_kind,
      bucket: CLIENT_ASSETS_BUCKET,
      storage_path,
      notes: `Fulfills asset request: ${request.detail}`,
    })
    .select("id")
    .single();
  if (assetError || !asset) {
    return { status: "error", message: assetError?.message ?? "Failed to register asset" };
  }

  const { error: updateError } = await supabase
    .from("asset_requests")
    .update({
      status: "fulfilled",
      fulfilled_asset_id: asset.id,
      possibly_fulfilled_asset_id: null,
    })
    .eq("id", request_id);
  if (updateError) return { status: "error", message: updateError.message };

  // The new asset may satisfy sibling requests of the same kind too —
  // flag them for one-click confirm rather than silently closing them.
  await supabase
    .from("asset_requests")
    .update({ possibly_fulfilled_asset_id: asset.id })
    .eq("client_id", client_id)
    .eq("status", "open")
    .eq("requested_kind", request.requested_kind)
    .is("possibly_fulfilled_asset_id", null);

  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const RequestRefSchema = z.object({
  request_id: z.string().uuid(),
  client_id: z.string().uuid(),
});

export async function dismissAssetRequest(
  _prevState: AssetRequestActionState,
  formData: FormData,
): Promise<AssetRequestActionState> {
  const parsed = RequestRefSchema.safeParse({
    request_id: formData.get("request_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("asset_requests")
    .update({ status: "dismissed" })
    .eq("id", parsed.data.request_id)
    .eq("status", "open");
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/clients/${parsed.data.client_id}`);
  return { status: "success" };
}

// One-click confirm of a "possibly fulfilled" flag (a manual upload of the
// requested kind arrived through the Assets tab).
export async function confirmPossiblyFulfilled(
  _prevState: AssetRequestActionState,
  formData: FormData,
): Promise<AssetRequestActionState> {
  const parsed = RequestRefSchema.safeParse({
    request_id: formData.get("request_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid input" };

  const supabase = await createClient();
  const { data: request, error: fetchError } = await supabase
    .from("asset_requests")
    .select("possibly_fulfilled_asset_id")
    .eq("id", parsed.data.request_id)
    .eq("status", "open")
    .maybeSingle();
  if (fetchError) return { status: "error", message: fetchError.message };
  if (!request?.possibly_fulfilled_asset_id) {
    return { status: "error", message: "No pending asset to confirm" };
  }

  const { error } = await supabase
    .from("asset_requests")
    .update({
      status: "fulfilled",
      fulfilled_asset_id: request.possibly_fulfilled_asset_id,
      possibly_fulfilled_asset_id: null,
    })
    .eq("id", parsed.data.request_id);
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/clients/${parsed.data.client_id}`);
  return { status: "success" };
}

export async function clearPossiblyFulfilled(
  _prevState: AssetRequestActionState,
  formData: FormData,
): Promise<AssetRequestActionState> {
  const parsed = RequestRefSchema.safeParse({
    request_id: formData.get("request_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("asset_requests")
    .update({ possibly_fulfilled_asset_id: null })
    .eq("id", parsed.data.request_id);
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/clients/${parsed.data.client_id}`);
  return { status: "success" };
}

// "Regenerate with real asset" — enqueue a cheap single-image creative_regen
// run (background job, per the house rule).
export async function enqueueCreativeRegen(
  _prevState: AssetRequestActionState,
  formData: FormData,
): Promise<AssetRequestActionState> {
  const parsed = RequestRefSchema.safeParse({
    request_id: formData.get("request_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid input" };
  const { request_id, client_id } = parsed.data;

  const supabase = await createClient();
  const { data: request, error: fetchError } = await supabase
    .from("asset_requests")
    .select("creative_id, fulfilled_asset_id")
    .eq("id", request_id)
    .eq("client_id", client_id)
    .eq("status", "fulfilled")
    .maybeSingle();
  if (fetchError) return { status: "error", message: fetchError.message };
  if (!request?.creative_id || !request.fulfilled_asset_id) {
    return {
      status: "error",
      message: "Request has no linked creative and fulfilled asset to regenerate from.",
    };
  }

  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("client_id", client_id)
    .eq("type", "creative_regen")
    .in("status", ["queued", "running"])
    .eq("input_json->>creative_id", request.creative_id)
    .limit(1);
  if (activeError) return { status: "error", message: activeError.message };
  if (active && active.length > 0) {
    return { status: "error", message: "A regeneration is already queued for this creative." };
  }

  const { error } = await supabase.from("runs").insert({
    client_id,
    type: "creative_regen",
    status: "queued",
    input_json: {
      creative_id: request.creative_id,
      asset_id: request.fulfilled_asset_id,
    },
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/clients/${client_id}`);
  revalidatePath("/runs");
  return { status: "success" };
}
