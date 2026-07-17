"use client";

import { useActionState, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteAsset, type AssetActionState } from "./actions";

export function DeleteAssetButton({
  assetId,
  clientId,
  assetLabel,
}: {
  assetId: string;
  clientId: string;
  assetLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<AssetActionState, FormData>(
    async (prev, formData) => {
      const result = await deleteAsset(prev, formData);
      if (result?.status === "success") setOpen(false);
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="size-7"
          title="Delete asset"
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Delete {assetLabel}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete asset?</DialogTitle>
          <DialogDescription>
            {assetLabel} will be removed from the library
            {" — "}generation agents will no longer see it. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <input type="hidden" name="asset_id" value={assetId} />
          <input type="hidden" name="client_id" value={clientId} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
          {state?.status === "error" && (
            <p className="text-destructive mt-2 text-sm">{state.message}</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
