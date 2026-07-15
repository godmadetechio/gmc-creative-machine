"use client";

import { useActionState } from "react";
import { Check, ChevronDown, ExternalLink, Undo2, X } from "lucide-react";
import { z } from "zod";
import type { AdCandidate } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { reviewCandidate, type ReviewState } from "./actions";

// Shape of match_rationale_json (the scorer's AdScore) — parsed defensively
// so a malformed row degrades to "no rationale" instead of crashing the page.
const RationaleSchema = z
  .object({
    angle_match: z
      .object({ pain_or_desire: z.string(), directness: z.string() })
      .partial(),
    belief_work: z.object({ belief: z.string(), mechanism: z.string() }).partial(),
    hook_pattern: z.string(),
    format: z.string(),
    transferable_skeleton: z.string(),
    match_rationale: z.string(),
    duplicate_count: z.number(),
  })
  .partial();

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "border-transparent bg-emerald-600 text-white";
  if (score >= 40) return "border-transparent bg-amber-500 text-white";
  return "border-transparent bg-muted text-muted-foreground";
}

function isImageUrl(url: string): boolean {
  return !/\.mp4(\?|$)/i.test(url);
}

export function CandidateCard({
  candidate,
  mirroredPreviewUrl,
}: {
  candidate: AdCandidate;
  /** Supabase Storage copy of the preview image — outlives expiring fbcdn URLs. */
  mirroredPreviewUrl?: string;
}) {
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(
    reviewCandidate,
    null,
  );

  const rationale = RationaleSchema.safeParse(candidate.match_rationale_json);
  const r = rationale.success ? rationale.data : {};
  const preview =
    mirroredPreviewUrl ?? (candidate.media_urls ?? []).find(isImageUrl);
  const reviewed = candidate.status !== "candidate";

  return (
    <Card
      className={cn(
        "overflow-hidden py-0",
        (candidate.status === "rejected" || candidate.status === "superseded") &&
          "opacity-60",
      )}
    >
      <div className="bg-muted relative aspect-video">
        {preview ? (
          // Plain <img>: media lives on unpredictable *.fbcdn.net hosts, so
          // next/image domain allow-listing isn't practical here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`Ad by ${candidate.advertiser ?? "unknown advertiser"}`}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
            No media preview
          </div>
        )}
        {candidate.match_score != null && (
          <Badge
            className={cn(
              "absolute top-2 right-2 text-sm",
              scoreBadgeClass(candidate.match_score),
            )}
          >
            {candidate.match_score}
          </Badge>
        )}
      </div>

      <CardContent className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{candidate.advertiser ?? "Unknown advertiser"}</p>
            <p className="text-muted-foreground text-xs">
              {candidate.run_time_days != null
                ? `Running ${candidate.run_time_days} days`
                : "Run time unknown"}
              {r.format && r.format !== "unknown" && ` · ${r.format}`}
              {(r.duplicate_count ?? 1) > 1 && ` · ${r.duplicate_count} variants`}
              {r.hook_pattern && ` · ${r.hook_pattern}`}
            </p>
          </div>
          {candidate.ad_url && (
            <a
              href={candidate.ad_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
              title="View in Ad Library"
            >
              <ExternalLink className="size-4" />
              <span className="sr-only">View original ad</span>
            </a>
          )}
        </div>

        {candidate.ad_copy && (
          <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
            {candidate.ad_copy}
          </p>
        )}

        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-sm select-none">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            Why it scored {candidate.match_score ?? "—"}
          </summary>
          <div className="text-muted-foreground mt-2 space-y-2 text-sm">
            {r.match_rationale && <p>{r.match_rationale}</p>}
            {r.angle_match?.pain_or_desire && (
              <p>
                <span className="text-foreground font-medium">Angle: </span>
                {r.angle_match.pain_or_desire}
                {r.angle_match.directness && ` — ${r.angle_match.directness}`}
              </p>
            )}
            {r.belief_work?.belief && r.belief_work.belief !== "none" && (
              <p>
                <span className="text-foreground font-medium">Belief work: </span>
                {r.belief_work.belief}
                {r.belief_work.mechanism && ` (via ${r.belief_work.mechanism})`}
              </p>
            )}
            {r.transferable_skeleton && (
              <p>
                <span className="text-foreground font-medium">Skeleton: </span>
                {r.transferable_skeleton}
              </p>
            )}
            {!rationale.success && <p>No rationale recorded for this candidate.</p>}
          </div>
        </details>

        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="candidate_id" value={candidate.id} />
          <input type="hidden" name="client_id" value={candidate.client_id} />
          {reviewed ? (
            <div className="flex items-center justify-between gap-2">
              <Badge
                variant={
                  candidate.status === "selected"
                    ? "default"
                    : candidate.status === "superseded"
                      ? "outline"
                      : "secondary"
                }
              >
                {candidate.status === "selected"
                  ? "Selected"
                  : candidate.status === "superseded"
                    ? "Superseded"
                    : "Rejected"}
                {candidate.reviewed_by && ` · ${candidate.reviewed_by}`}
              </Badge>
              <Button
                type="submit"
                name="decision"
                value="candidate"
                variant="ghost"
                size="sm"
                disabled={pending}
              >
                <Undo2 />
                {candidate.status === "superseded" ? "Restore" : "Undo"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="submit"
                name="decision"
                value="selected"
                disabled={pending}
              >
                <Check />
                Select
              </Button>
              <Button
                type="submit"
                name="decision"
                value="rejected"
                variant="outline"
                disabled={pending}
              >
                <X />
                Reject
              </Button>
            </div>
          )}
          {state?.status === "error" && (
            <p className="text-destructive text-sm">{state.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
