"use client";

import { useActionState } from "react";
import { BookUp2, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { promoteAssetToLibrary, type AssetActionState } from "./actions";

// One-click copy of a client inspiration ad into the global swipe file.
export function PromoteAssetButton({
  assetId,
  clientId,
}: {
  assetId: string;
  clientId: string;
}) {
  const [state, formAction, pending] = useActionState<AssetActionState, FormData>(
    promoteAssetToLibrary,
    null,
  );
  const done = state?.status === "success";

  return (
    <form action={formAction}>
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="client_id" value={clientId} />
      <Button
        type="submit"
        variant="secondary"
        size="icon"
        className="size-7"
        disabled={pending || done}
        title={
          done
            ? "In the swipe file"
            : state?.status === "error"
              ? state.message
              : "Promote to swipe file"
        }
      >
        {pending ? (
          <Loader2 className="animate-spin" />
        ) : done ? (
          <Check />
        ) : (
          <BookUp2 />
        )}
        <span className="sr-only">Promote to swipe file</span>
      </Button>
    </form>
  );
}
