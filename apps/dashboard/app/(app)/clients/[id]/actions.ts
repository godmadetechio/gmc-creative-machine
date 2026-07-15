"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidFacebookPageUrl } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type EnqueueState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const EnqueueInputSchema = z.object({
  client_id: z.string().uuid(),
  depth: z.enum(["quick", "full"]),
});

export async function enqueueBuyerBrain(
  _prevState: EnqueueState,
  formData: FormData,
): Promise<EnqueueState> {
  const parsed = EnqueueInputSchema.safeParse({
    client_id: formData.get("client_id"),
    depth: formData.get("depth"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { client_id, depth } = parsed.data;

  const supabase = await createClient();

  // One Buyer Brain run at a time per client.
  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("client_id", client_id)
    .eq("type", "buyer_brain")
    .in("status", ["queued", "running"])
    .limit(1);
  if (activeError) {
    return { status: "error", message: activeError.message };
  }
  if (active && active.length > 0) {
    return {
      status: "error",
      message: "A Buyer Brain run is already queued or running for this client.",
    };
  }

  const { error } = await supabase.from("runs").insert({
    client_id,
    type: "buyer_brain",
    status: "queued",
    input_json: { depth },
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}`);
  revalidatePath("/runs");
  return { status: "success" };
}

const EnqueueSelectionInputSchema = z.object({
  client_id: z.string().uuid(),
  country: z.string().regex(/^[A-Z]{2}$/i),
});

export async function enqueueCreativeSelection(
  _prevState: EnqueueState,
  formData: FormData,
): Promise<EnqueueState> {
  const parsed = EnqueueSelectionInputSchema.safeParse({
    client_id: formData.get("client_id"),
    country: formData.get("country"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { client_id, country } = parsed.data;

  const supabase = await createClient();

  // Creative selection scores ads against the active BBM — hard requirement.
  const { data: activeBbm, error: bbmError } = await supabase
    .from("bbm_versions")
    .select("id")
    .eq("client_id", client_id)
    .eq("is_active", true)
    .limit(1);
  if (bbmError) {
    return { status: "error", message: bbmError.message };
  }
  if (!activeBbm || activeBbm.length === 0) {
    return {
      status: "error",
      message:
        "No active Buyer Brain Matrix for this client — run the Buyer Brain pipeline first.",
    };
  }

  // One Creative Selection run at a time per client.
  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("client_id", client_id)
    .eq("type", "creative_selection")
    .in("status", ["queued", "running"])
    .limit(1);
  if (activeError) {
    return { status: "error", message: activeError.message };
  }
  if (active && active.length > 0) {
    return {
      status: "error",
      message:
        "A Creative Selection run is already queued or running for this client.",
    };
  }

  const { error } = await supabase.from("runs").insert({
    client_id,
    type: "creative_selection",
    status: "queued",
    input_json: { country: country.toUpperCase() },
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}`);
  revalidatePath("/runs");
  return { status: "success" };
}

const AddCompetitorSchema = z.object({
  client_id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(120),
  fb_page_url: z
    .string()
    .trim()
    .transform((v) => v || null)
    .nullable(),
});

export async function addCompetitor(
  _prevState: EnqueueState,
  formData: FormData,
): Promise<EnqueueState> {
  const parsed = AddCompetitorSchema.safeParse({
    client_id: formData.get("client_id"),
    name: formData.get("name"),
    fb_page_url: formData.get("fb_page_url") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { client_id, name, fb_page_url } = parsed.data;

  if (fb_page_url && !isValidFacebookPageUrl(fb_page_url)) {
    return {
      status: "error",
      message:
        "Not a Facebook page URL — expected https://www.facebook.com/<page>",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("competitors").insert({
    client_id,
    name,
    fb_page_url,
    source: "manual",
    status: "active",
  });
  if (error) {
    // 23505 = unique_violation on (client_id, lower(name))
    return {
      status: "error",
      message:
        error.code === "23505"
          ? `"${name}" is already on the competitor list.`
          : error.message,
    };
  }

  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const CompetitorStatusSchema = z.object({
  competitor_id: z.string().uuid(),
  client_id: z.string().uuid(),
  status: z.enum(["active", "ignored"]),
});

export async function setCompetitorStatus(
  _prevState: EnqueueState,
  formData: FormData,
): Promise<EnqueueState> {
  const parsed = CompetitorStatusSchema.safeParse({
    competitor_id: formData.get("competitor_id"),
    client_id: formData.get("client_id"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { competitor_id, client_id, status } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("competitors")
    .update({ status })
    .eq("id", competitor_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}
