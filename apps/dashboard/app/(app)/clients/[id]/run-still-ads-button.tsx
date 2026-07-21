"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enqueueStillAds, type EnqueueState } from "./actions";

// ~3 variants per concept at 4:5, $0.15/image — the label shows the rough
// generation bill so run size is a conscious choice.
const CONCEPT_COUNTS = [4, 6, 10, 15] as const;

export function RunStillAdsButton({
  clientId,
  disabled,
  hasActiveBbm,
  hasSelectedWinner,
}: {
  clientId: string;
  disabled: boolean;
  hasActiveBbm: boolean;
  hasSelectedWinner: boolean;
}) {
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    enqueueStillAds,
    null,
  );

  const blocked = disabled || !hasActiveBbm || !hasSelectedWinner || pending;

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="flex items-center gap-2">
        <select
          name="concept_count"
          defaultValue="10"
          disabled={blocked}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Concept count"
        >
          {CONCEPT_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count} concepts (~${(count * 3 * 0.15).toFixed(0)})
            </option>
          ))}
        </select>
        <Button type="submit" disabled={blocked}>
          <Sparkles />
          {disabled
            ? "Run in progress…"
            : pending
              ? "Queuing…"
              : "Run Still Ads"}
        </Button>
      </div>
      {!hasActiveBbm ? (
        <p className="text-muted-foreground text-sm">
          Needs an active Buyer Brain Matrix first.
        </p>
      ) : !hasSelectedWinner ? (
        <p className="text-muted-foreground text-sm">
          Select at least one winning ad candidate first.
        </p>
      ) : null}
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}
