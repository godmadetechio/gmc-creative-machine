"use client";

import { useActionState } from "react";
import { Loader2, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  enqueueReferenceAnnotation,
  type ReferenceActionState,
} from "./actions";

export function AnnotateButton({
  unannotatedCount,
  runActive,
}: {
  unannotatedCount: number;
  runActive: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    ReferenceActionState,
    FormData
  >(enqueueReferenceAnnotation, null);

  if (unannotatedCount === 0 && !runActive) return null;

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" disabled={pending || runActive || unannotatedCount === 0}>
        {runActive || pending ? <Loader2 className="animate-spin" /> : <ScanEye />}
        {runActive
          ? "Annotating…"
          : pending
            ? "Queuing…"
            : `Annotate new (${unannotatedCount})`}
      </Button>
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}
