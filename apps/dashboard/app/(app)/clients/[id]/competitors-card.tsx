"use client";

import { useRef } from "react";
import { useActionState } from "react";
import { ExternalLink, Plus, RotateCcw, EyeOff } from "lucide-react";
import type { Competitor } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  addCompetitor,
  setCompetitorStatus,
  type EnqueueState,
} from "./actions";

const SOURCE_BADGE: Record<Competitor["source"], "default" | "secondary" | "outline"> = {
  manual: "default",
  agent: "secondary",
  bbm_research: "outline",
};

function StatusToggle({ competitor }: { competitor: Competitor }) {
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    setCompetitorStatus,
    null,
  );
  const ignored = competitor.status === "ignored";

  return (
    <form action={formAction} className="flex justify-end">
      <input type="hidden" name="competitor_id" value={competitor.id} />
      <input type="hidden" name="client_id" value={competitor.client_id} />
      <input type="hidden" name="status" value={ignored ? "active" : "ignored"} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        title={
          ignored
            ? "Restore — include in future searches"
            : "Ignore — never search this competitor"
        }
      >
        {ignored ? <RotateCcw /> : <EyeOff />}
        {ignored ? "Restore" : "Ignore"}
      </Button>
      {state?.status === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </form>
  );
}

export function CompetitorsCard({
  clientId,
  competitors,
}: {
  clientId: string;
  competitors: Competitor[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<EnqueueState, FormData>(
    async (prev, formData) => {
      const result = await addCompetitor(prev, formData);
      if (result?.status === "success") formRef.current?.reset();
      return result;
    },
    null,
  );

  return (
    <Card className="mt-3 py-2">
      <CardContent className="px-2">
        {competitors.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            No competitors on file yet — add one below, or let the scout find
            them on the next Creative Selection run.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Facebook page</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Searched?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competitors.map((competitor) => (
                <TableRow
                  key={competitor.id}
                  className={cn(competitor.status === "ignored" && "opacity-50")}
                >
                  <TableCell className="pl-4 font-medium">
                    {competitor.name}
                  </TableCell>
                  <TableCell>
                    {competitor.fb_page_url ? (
                      <a
                        href={competitor.fb_page_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        {competitor.fb_page_url.replace(
                          /^https:\/\/(www\.)?facebook\.com\//,
                          "fb.com/",
                        )}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={SOURCE_BADGE[competitor.source]}>
                      {competitor.source === "bbm_research"
                        ? "BBM research"
                        : competitor.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-72 truncate text-sm">
                    {competitor.positioning_notes ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusToggle competitor={competitor} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form
          ref={formRef}
          action={formAction}
          className="flex flex-wrap items-start gap-2 border-t px-2 pt-3 pb-1"
        >
          <input type="hidden" name="client_id" value={clientId} />
          <Input
            name="name"
            placeholder="Competitor name"
            required
            disabled={pending}
            className="h-9 w-48"
            aria-label="Competitor name"
          />
          <Input
            name="fb_page_url"
            placeholder="https://www.facebook.com/… (optional)"
            disabled={pending}
            className="h-9 w-80"
            aria-label="Facebook page URL"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            <Plus />
            {pending ? "Adding…" : "Add competitor"}
          </Button>
          {state?.status === "error" && (
            <p className="text-destructive w-full text-sm">{state.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
