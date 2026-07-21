"use client";

import { useActionState } from "react";
import { Check, Plus } from "lucide-react";
import type { ReferenceLibraryEntry } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  saveReferencePickNote,
  toggleReferencePick,
  type PickActionState,
} from "./actions";

export function ReferencePickCard({
  clientId,
  reference,
  previewUrl,
  picked,
  noteOverride,
}: {
  clientId: string;
  reference: ReferenceLibraryEntry;
  previewUrl: string | null;
  picked: boolean;
  noteOverride: string | null;
}) {
  const [toggleState, toggleAction, toggling] = useActionState<
    PickActionState,
    FormData
  >(toggleReferencePick, null);
  const [noteState, noteAction, savingNote] = useActionState<
    PickActionState,
    FormData
  >(saveReferencePickNote, null);

  const hidden = (
    <>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="reference_id" value={reference.id} />
    </>
  );

  return (
    <Card
      className={cn(
        "overflow-hidden py-0 transition-shadow",
        picked && "ring-primary ring-2",
      )}
    >
      <div className="bg-muted relative aspect-[4/5]">
        {previewUrl ? (
          // Plain <img>: signed Storage URLs are query-signed and
          // short-lived, which doesn't play well with next/image caching.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={reference.title}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
            No preview
          </div>
        )}
        <form action={toggleAction} className="absolute top-2 right-2">
          {hidden}
          <input type="hidden" name="picked" value={picked ? "false" : "true"} />
          <Button
            type="submit"
            size="sm"
            variant={picked ? "default" : "secondary"}
            disabled={toggling}
          >
            {picked ? <Check /> : <Plus />}
            {picked ? "Picked" : "Pick"}
          </Button>
        </form>
      </div>

      <CardContent className="flex flex-col gap-2 px-3 pb-3">
        <p className="text-sm font-medium">{reference.title}</p>
        {reference.notes && (
          <p className="text-muted-foreground line-clamp-2 text-xs" title={reference.notes}>
            {reference.notes}
          </p>
        )}
        {reference.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {reference.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {picked && (
          <form action={noteAction} className="flex flex-col gap-1.5">
            {hidden}
            <Textarea
              name="note_override"
              defaultValue={noteOverride ?? ""}
              placeholder="Optional note override for this client (replaces the library brief)"
              className="min-h-16 text-xs"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={savingNote}
              className="self-end"
            >
              Save note
            </Button>
          </form>
        )}
        {[toggleState, noteState].map(
          (state, i) =>
            state?.status === "error" && (
              <p key={i} className="text-destructive text-sm">
                {state.message}
              </p>
            ),
        )}
      </CardContent>
    </Card>
  );
}
