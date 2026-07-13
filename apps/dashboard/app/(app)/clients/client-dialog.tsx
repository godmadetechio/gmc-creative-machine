"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { Client } from "@gmc/shared";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteClient, saveClient, type ClientFormState } from "./actions";

export function ClientDialog({
  client,
  trigger,
}: {
  client?: Client;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(
    saveClient,
    null,
  );

  useEffect(() => {
    if (state?.status === "success") {
      setOpen(false);
    }
  }, [state]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmingDelete(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>
            {client
              ? "Update the client's onboarding details."
              : "Onboard a client — name, niche, and brief drive every pipeline."}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {client && <input type="hidden" name="id" value={client.id} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={client?.name ?? ""}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="niche">Niche</Label>
            <Input
              id="niche"
              name="niche"
              placeholder="e.g. women 35+ fat loss coaching"
              defaultValue={client?.niche ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="brief">Brief</Label>
            <Textarea
              id="brief"
              name="brief"
              rows={5}
              placeholder="Offer, audience, positioning, anything the research agents should know…"
              defaultValue={client?.brief ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              name="website"
              type="url"
              placeholder="https://…"
              defaultValue={client?.website ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="drive_folder_id">Drive folder ID</Label>
            <Input
              id="drive_folder_id"
              name="drive_folder_id"
              placeholder="Google Drive folder for this client's assets"
              defaultValue={client?.drive_folder_id ?? ""}
            />
          </div>
          {state?.status === "error" && (
            <p className="text-destructive text-sm">{state.message}</p>
          )}
          <DialogFooter className="items-center gap-2 sm:justify-between">
            {client ? (
              confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={() =>
                      startDelete(async () => {
                        await deleteClient(client.id);
                        setOpen(false);
                      })
                    }
                  >
                    {deleting ? "Deleting…" : "Confirm delete"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete client
                </Button>
              )
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : client ? "Save changes" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
