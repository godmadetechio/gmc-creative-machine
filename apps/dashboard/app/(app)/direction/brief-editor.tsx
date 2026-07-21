"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { BriefSections, DirectiveScope, SeedVertical } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveDirective, type DirectiveActionState } from "./actions";

export type PickerReference = { id: string; title: string; url: string | null };

const SCALAR_FIELDS: {
  key: "objective" | "tone_voice" | "visual_direction" | "compliance_notes" | "current_focus";
  label: string;
  placeholder: string;
}[] = [
  { key: "objective", label: "Objective", placeholder: "What creatives at this level must achieve…" },
  { key: "tone_voice", label: "Tone & voice", placeholder: "How the copy should sound…" },
  { key: "visual_direction", label: "Visual direction", placeholder: "The look: native vs polished, type, color, composition…" },
  { key: "compliance_notes", label: "Compliance notes", placeholder: "Platform/legal constraints agents must respect…" },
  { key: "current_focus", label: "Current focus", placeholder: "Campaign or quarter emphasis right now…" },
];

function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  ordered,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  ordered?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="bg-muted/50 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm"
            >
              {ordered && <span className="text-muted-foreground w-4 shrink-0 text-xs">{i + 1}.</span>}
              <span className="min-w-0 flex-1">{item}</span>
              {ordered && (
                <>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive"
                title="Remove"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" onClick={add}>
          <Plus />
          <span className="sr-only">Add</span>
        </Button>
      </div>
    </div>
  );
}

export function BriefEditor({
  title,
  scope,
  vertical,
  clientId,
  currentVersion,
  initial,
  references,
}: {
  title: string;
  scope: DirectiveScope;
  vertical?: SeedVertical;
  clientId?: string;
  currentVersion: number | null;
  initial: BriefSections;
  /** Active swipe-file entries for the reference picker. */
  references: PickerReference[];
}) {
  const [state, formAction, pending] = useActionState<DirectiveActionState, FormData>(
    saveDirective,
    null,
  );
  const [scalars, setScalars] = useState<Record<string, string>>(
    Object.fromEntries(SCALAR_FIELDS.map(({ key }) => [key, initial[key] ?? ""])),
  );
  const [priorities, setPriorities] = useState<string[]>(
    initial.messaging_priorities ?? [],
  );
  const [never, setNever] = useState<string[]>(initial.hard_rules?.never ?? []);
  const [always, setAlways] = useState<string[]>(initial.hard_rules?.always ?? []);
  const [referenceIds, setReferenceIds] = useState<string[]>(
    initial.reference_ids ?? [],
  );

  const sections: BriefSections = {
    ...Object.fromEntries(
      Object.entries(scalars)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    ),
    ...(priorities.length > 0 ? { messaging_priorities: priorities } : {}),
    ...(never.length + always.length > 0 ? { hard_rules: { never, always } } : {}),
    ...(referenceIds.length > 0 ? { reference_ids: referenceIds } : {}),
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          {title}
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {currentVersion ? `v${currentVersion} active` : "no brief yet"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="vertical" value={vertical ?? ""} />
          <input type="hidden" name="client_id" value={clientId ?? ""} />
          <input type="hidden" name="sections_json" value={JSON.stringify(sections)} />

          <div className="grid gap-4 lg:grid-cols-2">
            {SCALAR_FIELDS.map(({ key, label, placeholder }) => (
              <div
                key={key}
                className={cn("flex flex-col gap-1.5", key === "visual_direction" && "lg:col-span-2")}
              >
                <Label htmlFor={`${scope}-${key}`}>{label}</Label>
                <Textarea
                  id={`${scope}-${key}`}
                  value={scalars[key]}
                  onChange={(e) => setScalars({ ...scalars, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="min-h-20 text-sm"
                />
              </div>
            ))}
          </div>

          <ListEditor
            label="Messaging priorities (ordered — first matters most)"
            items={priorities}
            onChange={setPriorities}
            placeholder="Add a priority…"
            ordered
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <ListEditor
              label="Hard rules — NEVER"
              items={never}
              onChange={setNever}
              placeholder="Add a never-rule…"
            />
            <ListEditor
              label="Hard rules — ALWAYS"
              items={always}
              onChange={setAlways}
              placeholder="Add an always-rule…"
            />
          </div>

          {references.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>
                References{" "}
                <span className="text-muted-foreground font-normal">
                  ({referenceIds.length} linked from the swipe file)
                </span>
              </Label>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {references.map((reference) => {
                  const selected = referenceIds.includes(reference.id);
                  return (
                    <button
                      key={reference.id}
                      type="button"
                      title={reference.title}
                      onClick={() =>
                        setReferenceIds(
                          selected
                            ? referenceIds.filter((id) => id !== reference.id)
                            : [...referenceIds, reference.id],
                        )
                      }
                      className={cn(
                        "bg-muted relative aspect-square overflow-hidden rounded-md",
                        selected && "ring-primary ring-2",
                      )}
                    >
                      {reference.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={reference.url}
                          alt={reference.title}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-muted-foreground flex size-full items-center justify-center p-1 text-center text-[10px]">
                          {reference.title}
                        </span>
                      )}
                      {selected && (
                        <Badge className="absolute right-1 bottom-1 px-1 py-0 text-[10px]">
                          ✓
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {state?.status === "error" && (
              <p className="text-destructive text-sm">{state.message}</p>
            )}
            {state?.status === "success" && (
              <p className="text-muted-foreground text-sm">Saved as v{state.version}.</p>
            )}
            <Button type="submit" disabled={pending}>
              {pending
                ? "Saving…"
                : currentVersion
                  ? `Save as v${currentVersion + 1}`
                  : "Create v1"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
