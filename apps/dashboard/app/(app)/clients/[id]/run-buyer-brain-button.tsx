"use client";

import { useActionState } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enqueueBuyerBrain, type EnqueueState } from "./actions";

export function RunBuyerBrainButton({
  clientId,
  disabled,
}: {
  clientId: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    enqueueBuyerBrain,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="flex items-center gap-2">
        <select
          name="depth"
          defaultValue="full"
          disabled={disabled || pending}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Research depth"
        >
          <option value="full">Full depth</option>
          <option value="quick">Quick (test)</option>
        </select>
        <Button type="submit" disabled={disabled || pending}>
          <Brain />
          {disabled ? "Run in progress…" : pending ? "Queuing…" : "Run Buyer Brain"}
        </Button>
      </div>
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}
