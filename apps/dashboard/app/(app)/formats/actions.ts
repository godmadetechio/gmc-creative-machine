"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { EnqueueState } from "../clients/[id]/actions";

// Takes no input — useActionState still passes (state, formData), but the
// scan has no parameters, so the action ignores them.
export async function enqueueFormatScan(): Promise<EnqueueState> {
  const supabase = await createClient();

  // One format scan at a time — the library is global, so the guard is too.
  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("type", "format_scan")
    .in("status", ["queued", "running"])
    .limit(1);
  if (activeError) {
    return { status: "error", message: activeError.message };
  }
  if (active && active.length > 0) {
    return {
      status: "error",
      message: "A format scan is already queued or running.",
    };
  }

  const { error } = await supabase.from("runs").insert({
    client_id: null, // global run
    type: "format_scan",
    status: "queued",
    input_json: {},
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/formats");
  revalidatePath("/runs");
  return { status: "success" };
}
