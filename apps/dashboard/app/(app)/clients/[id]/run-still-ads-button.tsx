"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientReadiness } from "@/lib/readiness";
import { enqueueStillAds, type EnqueueState } from "./actions";

// ~3 variants per concept at 4:5, $0.15/image — the label shows the rough
// generation bill so run size is a conscious choice.
const CONCEPT_COUNTS = [4, 6, 10, 15] as const;

export function RunStillAdsButton({
  clientId,
  disabled,
  hasActiveBbm,
  hasSelectedWinner,
  readiness,
  planPending,
}: {
  clientId: string;
  disabled: boolean;
  hasActiveBbm: boolean;
  hasSelectedWinner: boolean;
  /** Creative-readiness check (style refs, brand colors, brief). */
  readiness: ClientReadiness;
  /** A concept plan is paused at plan_review — approve it before rerunning. */
  planPending?: boolean;
}) {
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    enqueueStillAds,
    null,
  );
  // Readiness is a soft block: arming the override enables the run anyway.
  const [override, setOverride] = useState(false);

  const missing = readiness.items.filter((item) => !item.ok);
  const hardBlocked = disabled || planPending || !hasActiveBbm || !hasSelectedWinner;
  const softBlocked = !readiness.ready && !override;
  const blocked = hardBlocked || softBlocked || pending;

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="client_id" value={clientId} />
      {override && <input type="hidden" name="override_readiness" value="1" />}
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
          {planPending
            ? "Plan awaiting review"
            : disabled
              ? "Run in progress…"
              : pending
                ? "Queuing…"
                : "Run Still Ads"}
        </Button>
      </div>
      {/* Review-first is the default; auto mode is a deliberate opt-out. */}
      <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
        <input type="checkbox" name="skip_review" value="1" disabled={hardBlocked} />
        Skip plan review (auto-generate)
      </label>
      {planPending ? (
        <p className="text-muted-foreground text-sm">
          A concept plan is waiting on the{" "}
          <Link href={`/clients/${clientId}?tab=creatives`} className="underline">
            Creatives tab
          </Link>
          .
        </p>
      ) : !hasActiveBbm ? (
        <p className="text-muted-foreground text-sm">
          Needs an active Buyer Brain Matrix first.
        </p>
      ) : !hasSelectedWinner ? (
        <p className="text-muted-foreground text-sm">
          Select at least one winning ad candidate first.
        </p>
      ) : missing.length > 0 && !disabled ? (
        <div className="max-w-sm rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-right text-xs">
          <p className="flex items-center justify-end gap-1 font-medium text-amber-500">
            <AlertTriangle className="size-3.5" />
            Not creative-ready — output will be generic:
          </p>
          <ul className="text-muted-foreground mt-1 space-y-0.5">
            {missing.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="hover:text-foreground underline">
                  {item.label}
                </Link>
                : {item.detail}
              </li>
            ))}
          </ul>
          <label className="mt-1.5 flex cursor-pointer items-center justify-end gap-1.5">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Run anyway
          </label>
        </div>
      ) : null}
      {state?.status === "error" && (
        <p className="text-destructive max-w-sm text-right text-sm">{state.message}</p>
      )}
    </form>
  );
}
