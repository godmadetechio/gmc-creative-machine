"use client";

import { useActionState, useState } from "react";
import { Archive, ArchiveRestore, Check, ExternalLink, Pencil, Sparkles } from "lucide-react";
import { SeedVertical, type ReferenceLibraryEntry } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import {
  approveReference,
  setReferenceStatus,
  updateReference,
  type ReferenceActionState,
} from "./actions";

export function ReferenceCard({
  reference,
  previewUrl,
  formatNames,
}: {
  reference: ReferenceLibraryEntry;
  previewUrl: string | null;
  /** Active format_library names for the "exemplifies format" select. */
  formatNames: string[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editState, editAction, editing] = useActionState<
    ReferenceActionState,
    FormData
  >(async (prev, formData) => {
    const result = await updateReference(prev, formData);
    if (result?.status === "success") setEditOpen(false);
    return result;
  }, null);
  const [statusState, statusAction, statusPending] = useActionState<
    ReferenceActionState,
    FormData
  >(setReferenceStatus, null);
  const [approveState, approveAction, approving] = useActionState<
    ReferenceActionState,
    FormData
  >(approveReference, null);

  const archived = reference.status === "archived";
  const needsReview = reference.status === "needs_review";

  return (
    <Card className={cn("overflow-hidden py-0", archived && "opacity-60")}>
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
        {archived && (
          <Badge variant="secondary" className="absolute top-2 left-2">
            Archived
          </Badge>
        )}
        {needsReview && (
          <Badge className="absolute top-2 left-2 gap-1 border-transparent bg-amber-500/90 text-white">
            <Sparkles className="size-3" />
            AI notes — review
          </Badge>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" size="icon" className="size-7">
                <Pencil />
                <span className="sr-only">Edit {reference.title}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit reference</DialogTitle>
                <DialogDescription>
                  The notes are the brief the concept agent reads — what to
                  take, what to ignore, when to use it.
                </DialogDescription>
              </DialogHeader>
              <form action={editAction} className="flex flex-col gap-3">
                <input type="hidden" name="reference_id" value={reference.id} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`title-${reference.id}`}>Title</Label>
                  <Input
                    id={`title-${reference.id}`}
                    name="title"
                    defaultValue={reference.title}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`notes-${reference.id}`}>Notes</Label>
                  <Textarea
                    id={`notes-${reference.id}`}
                    name="notes"
                    defaultValue={reference.notes ?? ""}
                    placeholder='e.g. "steal the split layout + bold claim placement; ignore the palette; use for belief-breaking angles"'
                    className="min-h-24"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`tags-${reference.id}`}>Tags</Label>
                    <Input
                      id={`tags-${reference.id}`}
                      name="tags"
                      defaultValue={reference.tags.join(", ")}
                      placeholder="native-look, big-headline"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`vertical-${reference.id}`}>Vertical</Label>
                    <select
                      id={`vertical-${reference.id}`}
                      name="vertical"
                      defaultValue={reference.vertical ?? ""}
                      className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
                    >
                      <option value="">any vertical</option>
                      {SeedVertical.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`format-${reference.id}`}>
                      Exemplifies format
                    </Label>
                    <select
                      id={`format-${reference.id}`}
                      name="format_name"
                      defaultValue={reference.format_name ?? ""}
                      className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
                    >
                      <option value="">none</option>
                      {formatNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`source-${reference.id}`}>Source URL</Label>
                    <Input
                      id={`source-${reference.id}`}
                      name="source_url"
                      defaultValue={reference.source_url ?? ""}
                      placeholder="https://…"
                    />
                  </div>
                </div>
                {editState?.status === "error" && (
                  <p className="text-destructive text-sm">{editState.message}</p>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={editing}>
                    Save
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <form action={statusAction}>
            <input type="hidden" name="reference_id" value={reference.id} />
            <input
              type="hidden"
              name="status"
              value={archived ? "active" : "archived"}
            />
            <Button
              type="submit"
              variant="secondary"
              size="icon"
              className="size-7"
              disabled={statusPending}
              title={archived ? "Restore" : "Archive"}
            >
              {archived ? <ArchiveRestore /> : <Archive />}
              <span className="sr-only">
                {archived ? "Restore" : "Archive"} {reference.title}
              </span>
            </Button>
          </form>
        </div>
      </div>

      <CardContent className="flex flex-col gap-2 px-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{reference.title}</p>
          {reference.source_url && (
            <a
              href={reference.source_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
              title="Source"
            >
              <ExternalLink className="size-3.5" />
              <span className="sr-only">Source</span>
            </a>
          )}
        </div>
        {reference.notes && (
          <p className="text-muted-foreground line-clamp-3 text-xs" title={reference.notes}>
            {reference.notes}
          </p>
        )}
        {(reference.tags.length > 0 || reference.vertical || reference.format_name) && (
          <div className="flex flex-wrap gap-1">
            {reference.vertical && <Badge variant="secondary">{reference.vertical}</Badge>}
            {reference.format_name && (
              <Badge variant="secondary">{reference.format_name}</Badge>
            )}
            {reference.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {needsReview && (
          <form action={approveAction} className="flex flex-col gap-1">
            <input type="hidden" name="reference_id" value={reference.id} />
            <Button type="submit" size="sm" disabled={approving}>
              <Check />
              Approve AI notes
            </Button>
            <p className="text-muted-foreground text-xs">
              …or edit ✎ to refine — saving an edit approves it as your own.
            </p>
            {approveState?.status === "error" && (
              <p className="text-destructive text-sm">{approveState.message}</p>
            )}
          </form>
        )}
        {statusState?.status === "error" && (
          <p className="text-destructive text-sm">{statusState.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
