"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conceptSummaryForCreative } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type CreativeReviewState =
  | { status: "error"; message: string }
  | { status: "success"; message?: string }
  | null;

const ApproveInputSchema = z.object({
  creative_id: z.string().uuid(),
  client_id: z.string().uuid(),
  why_approved: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
});

export async function approveCreative(
  _prevState: CreativeReviewState,
  formData: FormData,
): Promise<CreativeReviewState> {
  const parsed = ApproveInputSchema.safeParse({
    creative_id: formData.get("creative_id"),
    client_id: formData.get("client_id"),
    why_approved: formData.get("why_approved") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { creative_id, client_id, why_approved } = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("creatives")
    .update({ status: "approved", feedback: null })
    .eq("id", creative_id)
    .select("id, client_id, avatar, hook, framework, concept_json")
    .single();
  if (error) {
    return { status: "error", message: error.message };
  }

  // Approval appends to the per-client Winning Creative Doc — future concept
  // runs (and the Phase 5.5 iteration engine) read this as "what worked".
  const { error: winningError } = await supabase.from("winning_creatives").upsert(
    {
      client_id,
      creative_id,
      concept_summary: conceptSummaryForCreative(updated),
      why_approved,
    },
    { onConflict: "creative_id" },
  );
  if (winningError) {
    return {
      status: "error",
      message: `Approved, but failed to log the win: ${winningError.message}`,
    };
  }

  revalidatePath(`/clients/${client_id}/creatives`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const RejectInputSchema = z.object({
  creative_id: z.string().uuid(),
  client_id: z.string().uuid(),
  feedback: z
    .string()
    .trim()
    .min(5, "Rejection feedback is required — it becomes a standing rule for the next run."),
});

export async function rejectCreative(
  _prevState: CreativeReviewState,
  formData: FormData,
): Promise<CreativeReviewState> {
  const parsed = RejectInputSchema.safeParse({
    creative_id: formData.get("creative_id"),
    client_id: formData.get("client_id"),
    feedback: formData.get("feedback"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { creative_id, client_id, feedback } = parsed.data;

  const supabase = await createClient();
  // Feedback persists on the row — the next still_ads run injects every
  // rejection reason into the concept agent's prompt.
  const { error } = await supabase
    .from("creatives")
    .update({ status: "rejected", feedback })
    .eq("id", creative_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  // A rejected creative can't stay in the Winning Doc (approve → reject flip).
  await supabase.from("winning_creatives").delete().eq("creative_id", creative_id);

  revalidatePath(`/clients/${client_id}/creatives`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}

const RetryInputSchema = z.object({
  creative_id: z.string().uuid(),
  client_id: z.string().uuid(),
});

// "Retry with feedback" — enqueue a cheap single-image creative_regen run
// (background job, per the house rule) that re-runs just this creative's
// generation with the rejection feedback appended to its compiled prompt.
// Salvages near-misses without a full still_ads round.
export async function retryRejectedCreative(
  _prevState: CreativeReviewState,
  formData: FormData,
): Promise<CreativeReviewState> {
  const parsed = RetryInputSchema.safeParse({
    creative_id: formData.get("creative_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { creative_id, client_id } = parsed.data;

  const supabase = await createClient();
  const { data: creative, error: fetchError } = await supabase
    .from("creatives")
    .select("status, feedback, prompt_used")
    .eq("id", creative_id)
    .eq("client_id", client_id)
    .maybeSingle();
  if (fetchError) return { status: "error", message: fetchError.message };
  if (!creative) return { status: "error", message: "Creative not found" };
  if (creative.status !== "rejected" || !creative.feedback) {
    return {
      status: "error",
      message: "Only rejected creatives with feedback can be retried.",
    };
  }
  if (!creative.prompt_used) {
    return { status: "error", message: "Creative has no stored prompt to retry." };
  }

  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("client_id", client_id)
    .eq("type", "creative_regen")
    .in("status", ["queued", "running"])
    .eq("input_json->>creative_id", creative_id)
    .limit(1);
  if (activeError) return { status: "error", message: activeError.message };
  if (active && active.length > 0) {
    return { status: "error", message: "A retry is already queued for this creative." };
  }

  const { error } = await supabase.from("runs").insert({
    client_id,
    type: "creative_regen",
    status: "queued",
    input_json: { creative_id, feedback: creative.feedback },
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(`/clients/${client_id}/creatives`);
  revalidatePath("/runs");
  return {
    status: "success",
    message: "Retry queued — the revised draft will appear with the next run.",
  };
}

const UndoInputSchema = z.object({
  creative_id: z.string().uuid(),
  client_id: z.string().uuid(),
});

export async function undoCreativeReview(
  _prevState: CreativeReviewState,
  formData: FormData,
): Promise<CreativeReviewState> {
  const parsed = UndoInputSchema.safeParse({
    creative_id: formData.get("creative_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { creative_id, client_id } = parsed.data;

  const supabase = await createClient();
  // Back to draft: clear the feedback too, or an undone rejection would keep
  // injecting its reason into future concept prompts.
  const { error } = await supabase
    .from("creatives")
    .update({ status: "draft", feedback: null })
    .eq("id", creative_id);
  if (error) {
    return { status: "error", message: error.message };
  }
  await supabase.from("winning_creatives").delete().eq("creative_id", creative_id);

  revalidatePath(`/clients/${client_id}/creatives`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}
