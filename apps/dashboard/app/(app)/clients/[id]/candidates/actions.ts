"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ReviewState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const ReviewInputSchema = z.object({
  candidate_id: z.string().uuid(),
  client_id: z.string().uuid(),
  // 'candidate' undoes a review decision
  decision: z.enum(["selected", "rejected", "candidate"]),
});

export async function reviewCandidate(
  _prevState: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const parsed = ReviewInputSchema.safeParse({
    candidate_id: formData.get("candidate_id"),
    client_id: formData.get("client_id"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { candidate_id, client_id, decision } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const reviewed = decision !== "candidate";
  const { error } = await supabase
    .from("ad_candidates")
    .update({
      status: decision,
      reviewed_at: reviewed ? new Date().toISOString() : null,
      reviewed_by: reviewed ? (user?.email ?? null) : null,
    })
    .eq("id", candidate_id);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/candidates`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}
