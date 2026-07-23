"use client";

import { useActionState, useState } from "react";
import { Ban, Check, ClipboardList, Sparkles, Undo2 } from "lucide-react";
import type { StillConcept, VisualTreatment } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { discardPlan, submitPlanReview, type CreativeReviewState } from "./actions";

// Concept plan review — the human directs the run BEFORE generation spend.
// Cards are editable in place: approve / drop / edit copy / swap format.
// "Generate approved (N)" writes the curated list back and re-queues the run.

const TREATMENT_LABELS: Record<VisualTreatment, string> = {
  screenshot_ui: "Screenshot UI",
  typographic: "Typographic",
  photography: "Photography",
  illustration: "Illustration",
  handwritten: "Handwritten",
  meme: "Meme",
};

const COST_PER_IMAGE_USD = 0.15;

type EditableConcept = StillConcept & {
  _approved: boolean;
  /** Textarea model for hooks — one hook per line. */
  _hooksText: string;
};

export function PlanReview({
  runId,
  clientId,
  concepts,
  formatOptions,
  agentCostUsd,
  imagesPerConcept,
}: {
  runId: string;
  clientId: string;
  concepts: StillConcept[];
  /** Active format-library names for the swap-format select. */
  formatOptions: string[];
  /** Concept-stage spend so far (text only). */
  agentCostUsd: number | null;
  /** variants_per_concept × aspects for the ≈cost label. */
  imagesPerConcept: number;
}) {
  const [items, setItems] = useState<EditableConcept[]>(() =>
    concepts.map((c) => ({ ...c, _approved: true, _hooksText: c.hooks.join("\n") })),
  );
  const [submitState, submitAction, submitting] = useActionState<
    CreativeReviewState,
    FormData
  >(submitPlanReview, null);
  const [discardState, discardAction, discarding] = useActionState<
    CreativeReviewState,
    FormData
  >(discardPlan, null);
  const pending = submitting || discarding;

  const update = (index: number, patch: Partial<EditableConcept>) =>
    setItems((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const hooksOf = (item: EditableConcept) =>
    item._hooksText
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean);

  const approved = items.filter((i) => i._approved);
  const shortOfHooks = approved.filter((i) => hooksOf(i).length < 3);
  // Cheap enough to rebuild per render; strips the UI-only fields.
  const payload = JSON.stringify(
    approved.map((item) => {
      const concept: Record<string, unknown> = { ...item, hooks: hooksOf(item) };
      delete concept._approved;
      delete concept._hooksText;
      return concept;
    }),
  );
  const estimatedUsd = approved.length * imagesPerConcept * COST_PER_IMAGE_USD;
  const done = submitState?.status === "success" || discardState?.status === "success";
  const error =
    [submitState, discardState].find((s) => s?.status === "error") ?? null;

  const swapOptions = (current: string) =>
    formatOptions.includes(current) ? formatOptions : [current, ...formatOptions];

  return (
    <Card className="mt-4 border-violet-500/40">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ClipboardList className="size-4" />
          Concept plan review
          <span className="text-muted-foreground text-sm font-normal">
            {concepts.length} concepts · text only so far
            {agentCostUsd != null && ` ($${agentCostUsd.toFixed(2)} in agents)`}
            {" — nothing generated yet"}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Direct the run before pixels are paid for: drop what&apos;s weak, fix
          copy, swap formats. Only approved concepts generate.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item, i) => {
            const hookCount = hooksOf(item).length;
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3",
                  !item._approved && "bg-muted/40 opacity-55",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={item.format_name}
                    onChange={(e) => update(i, { format_name: e.target.value })}
                    disabled={!item._approved || pending}
                    className="border-input bg-background h-8 max-w-52 rounded-md border px-2 text-xs"
                    aria-label={`Concept ${i + 1} format`}
                  >
                    {swapOptions(item.format_name).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <Badge variant="secondary">{TREATMENT_LABELS[item.visual_treatment]}</Badge>
                  <Badge variant="outline">{item.avatar}</Badge>
                  <div className="ml-auto">
                    <Button
                      type="button"
                      size="sm"
                      variant={item._approved ? "ghost" : "outline"}
                      onClick={() => update(i, { _approved: !item._approved })}
                      disabled={pending}
                    >
                      {item._approved ? (
                        <>
                          <Ban /> Drop
                        </>
                      ) : (
                        <>
                          <Undo2 /> Restore
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">{item.angle_ref}</p>
                <Input
                  value={item.headline}
                  onChange={(e) => update(i, { headline: e.target.value })}
                  disabled={!item._approved || pending}
                  placeholder="Headline"
                  aria-label={`Concept ${i + 1} headline`}
                />
                <Input
                  value={item.subhead}
                  onChange={(e) => update(i, { subhead: e.target.value })}
                  disabled={!item._approved || pending}
                  placeholder="Subhead"
                  aria-label={`Concept ${i + 1} subhead`}
                />
                <Input
                  value={item.cta}
                  onChange={(e) => update(i, { cta: e.target.value })}
                  disabled={!item._approved || pending}
                  placeholder="CTA"
                  aria-label={`Concept ${i + 1} CTA`}
                />
                <Textarea
                  value={item._hooksText}
                  onChange={(e) => update(i, { _hooksText: e.target.value })}
                  disabled={!item._approved || pending}
                  className={cn(
                    "min-h-20 text-sm",
                    item._approved && hookCount < 3 && "border-destructive",
                  )}
                  placeholder="Hooks — one per line (3-5)"
                  aria-label={`Concept ${i + 1} hooks`}
                />
                {item._approved && hookCount < 3 && (
                  <p className="text-destructive text-xs">
                    Needs at least 3 hooks (one per line).
                  </p>
                )}
                <p className="text-muted-foreground line-clamp-3 text-xs">
                  {item.visual_description}
                  {item.reference_mode !== "none" && (
                    <span className="capitalize"> · {item.reference_mode} refs</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <form action={discardAction}>
            <input type="hidden" name="run_id" value={runId} />
            <input type="hidden" name="client_id" value={clientId} />
            <Button type="submit" variant="ghost" size="sm" disabled={pending || done}>
              <Ban />
              Discard plan
            </Button>
          </form>
          <form action={submitAction} className="flex items-center gap-3">
            <input type="hidden" name="run_id" value={runId} />
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="approved_json" value={payload} />
            <span className="text-muted-foreground text-sm">
              ≈ ${estimatedUsd.toFixed(2)} generation
            </span>
            <Button
              type="submit"
              disabled={
                pending || done || approved.length === 0 || shortOfHooks.length > 0
              }
            >
              {done ? <Check /> : <Sparkles />}
              {submitting
                ? "Queuing…"
                : done
                  ? "Queued"
                  : `Generate approved (${approved.length})`}
            </Button>
          </form>
        </div>
        {(submitState?.status === "success" || discardState?.status === "success") && (
          <p className="text-muted-foreground text-sm">
            {submitState?.status === "success"
              ? (submitState.message ?? "Queued.")
              : (discardState?.status === "success" && discardState.message) || ""}
          </p>
        )}
        {error && error.status === "error" && (
          <p className="text-destructive text-sm">{error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
