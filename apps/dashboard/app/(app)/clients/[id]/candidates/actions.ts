"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { inspirationAssetsForCandidate } from "@gmc/shared";
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
    .select(
      "id, client_id, advertiser, match_score, match_rationale_json, media_urls, media_storage_paths",
    )
    .single();
  if (error) {
    return { status: "error", message: error.message };
  }

  // fbcdn media URLs expire — mirror a winner's files to Storage right away,
  // after the response so the review click stays snappy, then register them
  // in the Client Asset Library as inspiration_ad references for Phase 3/4.
  // Warn-don't-fail throughout.
  if (decision === "selected" && updated) {
    const candidate = updated as MirrorableCandidate & {
      advertiser: string | null;
      match_score: number | null;
      match_rationale_json: unknown;
    };
    after(async () => {
      try {
        const mirrored = await mirrorCandidateMedia(supabase, candidate);
        const assetRows = inspirationAssetsForCandidate({
          ...candidate,
          media_storage_paths: mirrored,
        });
        if (assetRows.length === 0) return;
        const { error: assetError } = await supabase
          .from("client_assets")
          .upsert(assetRows, { onConflict: "bucket,storage_path" });
        if (assetError) {
          console.warn(
            `[assets] candidate ${candidate.id}: failed to register inspiration assets: ${assetError.message}`,
          );
        }
      } catch (err) {
        console.warn(
          `[media-mirror] candidate ${candidate.id}: mirroring crashed: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    });
  }

  // Un-selecting (undo or reject) retires the auto-registered inspiration
  // assets so Phase 3/4 stops referencing an ad the operator walked back.
  // The mirrored files stay in ad-media for the candidates review page.
  if (decision !== "selected") {
    const { error: assetError } = await supabase
      .from("client_assets")
      .delete()
      .eq("source_candidate_id", candidate_id);
    if (assetError) {
      console.warn(
        `[assets] candidate ${candidate_id}: failed to remove inspiration assets: ${assetError.message}`,
      );
    }
  }

  revalidatePath(`/clients/${client_id}/candidates`);
  revalidatePath(`/clients/${client_id}`);
  revalidatePath(`/clients/${client_id}/assets`);
  return { status: "success" };
}
