"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conceptSummaryForCreative } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type CreativeReviewState =
  | { status: "error"; message: string }
  | { status: "success" }
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
