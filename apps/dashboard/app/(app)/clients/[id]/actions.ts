"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
