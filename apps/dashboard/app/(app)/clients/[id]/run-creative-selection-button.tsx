"use client";

import { useActionState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enqueueCreativeSelection, type EnqueueState } from "./actions";

const COUNTRIES = ["US", "GB", "DE", "FR", "NL", "AU", "CA"] as const;

export function RunCreativeSelectionButton({
  clientId,
  disabled,
  hasActiveBbm,
}: {
  clientId: string;
  disabled: boolean;
  hasActiveBbm: boolean;
}) {
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    enqueueCreativeSelection,
    null,
  );

  const blocked = disabled || !hasActiveBbm || pending;

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="flex items-center gap-2">
        <select
          name="country"
          defaultValue="US"
          disabled={blocked}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Ad Library country"
        >
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={blocked}>
          <Images />
          {disabled
            ? "Run in progress…"
            : pending
              ? "Queuing…"
              : "Run Creative Selection"}
        </Button>
      </div>
      {!hasActiveBbm && (
        <p className="text-muted-foreground text-sm">
          Needs an active Buyer Brain Matrix first.
        </p>
      )}
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}
