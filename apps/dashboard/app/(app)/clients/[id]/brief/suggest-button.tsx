"use client";

import { useActionState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enqueueBriefSuggestions, type BriefActionState } from "./actions";

export function SuggestButton({
  clientId,
  runActive,
}: {
  clientId: string;
  runActive: boolean;
}) {
  const [state, formAction, pending] = useActionState<BriefActionState, FormData>(
    enqueueBriefSuggestions,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="client_id" value={clientId} />
      <Button type="submit" size="sm" disabled={pending || runActive}>
        <Lightbulb />
        {runActive
          ? "Analyzing feedback…"
          : pending
            ? "Queuing…"
            : "Suggest brief updates from feedback"}
      </Button>
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}
