"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { mirrorCandidateMedia, type MirrorableCandidate } from "@/lib/media-mirror";
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
  const { data: updated, error } = await supabase
    .from("ad_candidates")
    .update({
      status: decision,
      reviewed_at: reviewed ? new Date().toISOString() : null,
      reviewed_by: reviewed ? (user?.email ?? null) : null,
    })
    .eq("id", candidate_id)
    .select("id, client_id, media_urls, media_storage_paths")
    .single();
  if (error) {
    return { status: "error", message: error.message };
  }

  // fbcdn media URLs expire — mirror a winner's files to Storage right away,
  // after the response so the review click stays snappy. Warn-don't-fail.
  if (decision === "selected" && updated) {
    const candidate = updated as MirrorableCandidate;
    after(async () => {
      try {
        await mirrorCandidateMedia(supabase, candidate);
      } catch (err) {
        console.warn(
          `[media-mirror] candidate ${candidate.id}: mirroring crashed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    });
  }

  revalidatePath(`/clients/${client_id}/candidates`);
  revalidatePath(`/clients/${client_id}`);
  return { status: "success" };
}
