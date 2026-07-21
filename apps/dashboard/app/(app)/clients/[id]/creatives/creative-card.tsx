"use client";

import { useActionState, useState } from "react";
import { Check, ExternalLink, RefreshCw, Undo2, X } from "lucide-react";
import { StillConceptSchema, type Creative } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  approveCreative,
  rejectCreative,
  retryRejectedCreative,
  undoCreativeReview,
  type CreativeReviewState,
} from "./actions";

function statusBadge(status: Creative["status"]) {
  if (status === "approved") {
    return <Badge className="border-transparent bg-emerald-600 text-white">Approved</Badge>;
  }
  if (status === "rejected") return <Badge variant="secondary">Rejected</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

function ReviewControls({
  creative,
  compact,
}: {
  creative: Creative;
  compact?: boolean;
}) {
  const [approveState, approveAction, approving] = useActionState<
    CreativeReviewState,
    FormData
  >(approveCreative, null);
  const [rejectState, rejectAction, rejecting] = useActionState<
    CreativeReviewState,
    FormData
  >(rejectCreative, null);
  const [undoState, undoAction, undoing] = useActionState<
    CreativeReviewState,
    FormData
  >(undoCreativeReview, null);
  const [retryState, retryAction, retrying] = useActionState<
    CreativeReviewState,
    FormData
  >(retryRejectedCreative, null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const pending = approving || rejecting || undoing || retrying;
  const error =
    [approveState, rejectState, undoState, retryState].find(
      (s) => s?.status === "error",
    ) ?? null;
  const hidden = (
    <>
      <input type="hidden" name="creative_id" value={creative.id} />
      <input type="hidden" name="client_id" value={creative.client_id} />
    </>
  );

  if (creative.status !== "draft") {
    const canRetry = creative.status === "rejected" && !!creative.feedback;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          {statusBadge(creative.status)}
          <div className="flex items-center gap-1">
            {canRetry && (
              // Cheap single-image regen with the rejection feedback appended
              // to the compile prompt — salvages near-misses without a run.
              <form action={retryAction} className="contents">
                {hidden}
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={pending || retryState?.status === "success"}
                  title="Re-generate this creative with the rejection feedback applied"
                >
                  <RefreshCw />
                  Retry with feedback
                </Button>
              </form>
            )}
            <form action={undoAction} className="contents">
              {hidden}
              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                <Undo2 />
                Undo
              </Button>
            </form>
          </div>
        </div>
        {retryState?.status === "success" && (
          <p className="text-muted-foreground text-xs">
            {retryState.message ?? "Retry queued."}
          </p>
        )}
        {error && error.status === "error" && (
          <p className="text-destructive text-sm">{error.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rejectOpen ? (
        <form action={rejectAction} className="flex flex-col gap-2">
          {hidden}
          <Textarea
            name="feedback"
            required
            minLength={5}
            autoFocus
            placeholder="Why is this a no? Be specific — this becomes a standing rule for every future run."
            className="min-h-20 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              <X />
              Confirm reject
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejectOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <form action={approveAction} className="contents">
            {hidden}
            {!compact && (
              <Textarea
                name="why_approved"
                placeholder="Optional: why is this a winner? (logged to the Winning Creative Doc)"
                className="min-h-16 text-sm"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" disabled={pending}>
                <Check />
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectOpen(true)}
                disabled={pending}
              >
                <X />
                Reject
              </Button>
            </div>
          </form>
        </div>
      )}
      {error && error.status === "error" && (
        <p className="text-destructive text-sm">{error.message}</p>
      )}
    </div>
  );
}

export function CreativeCard({
  creative,
  previewUrl,
  fullUrl,
  aspectUrls,
}: {
  creative: Creative;
  /** Signed URL for the grid preview (thumbnail when transforms are on). */
  previewUrl: string | null;
  /** Full-resolution signed URL for the zoom dialog; falls back to previewUrl. */
  fullUrl?: string | null;
  /** aspect → signed URL for every rendered file of this variant. */
  aspectUrls: [string, string][];
}) {
  const concept = StillConceptSchema.safeParse(creative.concept_json);
  const dialogUrl = fullUrl ?? previewUrl;

  return (
    <Card className={cn("overflow-hidden py-0", creative.status === "rejected" && "opacity-60")}>
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="bg-muted relative block aspect-[4/5] w-full cursor-zoom-in"
            title="Preview"
          >
            {previewUrl ? (
              // Plain <img>: signed Storage URLs are query-signed and
              // short-lived, which doesn't play well with next/image caching.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={creative.hook ?? "Generated creative"}
                className="size-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
                No preview
              </div>
            )}
            <div className="absolute top-2 right-2">{statusBadge(creative.status)}</div>
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-left">
              {concept.success ? concept.data.headline : (creative.hook ?? "Creative")}
            </DialogTitle>
            <DialogDescription className="text-left">
              {[creative.framework, creative.avatar].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex flex-col gap-2">
              {dialogUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={dialogUrl}
                  alt={creative.hook ?? "Generated creative"}
                  className="w-full rounded-md"
                />
              )}
              {aspectUrls.length > 1 && (
                <div className="text-muted-foreground flex gap-3 text-xs">
                  {aspectUrls.map(([aspect, url]) => (
                    <a
                      key={aspect}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground inline-flex items-center gap-1"
                    >
                      {aspect} <ExternalLink className="size-3" />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 text-sm">
              {creative.hook && (
                <div>
                  <p className="text-muted-foreground text-xs font-medium uppercase">Hook</p>
                  <p>{creative.hook}</p>
                </div>
              )}
              {concept.success && (
                <>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase">Angle</p>
                    <p>{concept.data.angle_ref}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase">
                      Copy
                    </p>
                    <p>
                      {concept.data.headline} — {concept.data.subhead}{" "}
                      <span className="text-muted-foreground">[{concept.data.cta}]</span>
                    </p>
                  </div>
                  {concept.data.reference_mode !== "none" && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase">
                        References
                      </p>
                      <p className="capitalize">{concept.data.reference_mode} mode</p>
                    </div>
                  )}
                </>
              )}
              {creative.feedback && creative.status === "rejected" && (
                <div>
                  <p className="text-muted-foreground text-xs font-medium uppercase">
                    Rejection feedback
                  </p>
                  <p>{creative.feedback}</p>
                </div>
              )}
              <ReviewControls creative={creative} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CardContent className="flex flex-col gap-3 px-4 pb-4">
        <div>
          <p className="line-clamp-2 text-sm font-medium">
            {creative.hook ?? (concept.success ? concept.data.headline : "Untitled")}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {[creative.framework, creative.avatar].filter(Boolean).join(" · ") || "—"}
            {creative.cost_usd != null && ` · $${creative.cost_usd.toFixed(2)}`}
          </p>
        </div>
        <ReviewControls creative={creative} compact />
      </CardContent>
    </Card>
  );
}
