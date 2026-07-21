"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { SECTION_LABELS, type BriefSections, type BriefSuggestion } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  acceptSuggestion,
  dismissSuggestion,
  type BriefActionState,
} from "./actions";

const KIND_LABELS = {
  add_never: "Add NEVER rule",
  add_always: "Add ALWAYS rule",
  amend_section: "Amend section",
} as const;

export function SuggestionCard({ suggestion }: { suggestion: BriefSuggestion }) {
  const [acceptState, acceptAction, accepting] = useActionState<
    BriefActionState,
    FormData
  >(acceptSuggestion, null);
  const [dismissState, dismissAction, dismissing] = useActionState<
    BriefActionState,
    FormData
  >(dismissSuggestion, null);

  const pending = accepting || dismissing;
  const error =
    [acceptState, dismissState].find((s) => s?.status === "error") ?? null;
  const sectionLabel =
    SECTION_LABELS[suggestion.section as keyof BriefSections] ?? suggestion.section;
  const hidden = (
    <>
      <input type="hidden" name="suggestion_id" value={suggestion.id} />
      <input type="hidden" name="client_id" value={suggestion.client_id} />
    </>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{KIND_LABELS[suggestion.kind]}</Badge>
          <Badge variant="outline">{sectionLabel}</Badge>
        </div>
        <p className="text-sm font-medium whitespace-pre-wrap">
          {suggestion.proposal.text}
        </p>
        {suggestion.rationale && (
          <p className="text-muted-foreground text-sm">{suggestion.rationale}</p>
        )}
        <div className="border-muted flex flex-col gap-1 border-l-2 pl-3">
          {suggestion.feedback_quotes.map((quote, i) => (
            <p key={i} className="text-muted-foreground text-xs italic">
              “{quote}”
            </p>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <form action={acceptAction}>
            {hidden}
            <Button type="submit" size="sm" disabled={pending}>
              <Check />
              Accept → new brief version
            </Button>
          </form>
          <form action={dismissAction}>
            {hidden}
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              <X />
              Dismiss
            </Button>
          </form>
        </div>
        {error && error.status === "error" && (
          <p className="text-destructive text-sm">{error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
