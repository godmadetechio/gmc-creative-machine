"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EnqueueState } from "../clients/[id]/actions";
import { enqueueFormatScan } from "./actions";

export function RefreshLibraryButton({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    enqueueFormatScan,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <Button type="submit" disabled={disabled || pending}>
        <RefreshCw />
        {disabled ? "Scan in progress…" : pending ? "Queuing…" : "Refresh library"}
      </Button>
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}
