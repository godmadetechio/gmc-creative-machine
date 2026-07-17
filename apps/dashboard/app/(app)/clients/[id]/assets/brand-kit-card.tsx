"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import type { BrandKit } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveBrandKit } from "./actions";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function ListEditor({
  label,
  values,
  onChange,
  placeholder,
  addLabel,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {values.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={value}
            placeholder={placeholder}
            onChange={(e) =>
              onChange(values.map((v, j) => (j === i ? e.target.value : v)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <X />
            <span className="sr-only">Remove</span>
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...values, ""])}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

export function BrandKitCard({
  clientId,
  initial,
}: {
  clientId: string;
  initial: BrandKit | null;
}) {
  const [colors, setColors] = useState<string[]>(initial?.colors ?? []);
  const [fonts, setFonts] = useState<string[]>(initial?.fonts ?? []);
  const [toneNotes, setToneNotes] = useState(initial?.tone_notes ?? "");
  const [rules, setRules] = useState<string[]>(initial?.rules ?? []);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { status: "success" } | { status: "error"; message: string } | null
  >(null);

  function save() {
    setResult(null);
    startTransition(async () => {
      const saved = await saveBrandKit({
        client_id: clientId,
        brand: {
          colors: colors.map((c) => c.trim()).filter((c) => c !== ""),
          fonts: fonts.map((f) => f.trim()).filter((f) => f !== ""),
          tone_notes: toneNotes.trim(),
          rules: rules.map((r) => r.trim()).filter((r) => r !== ""),
        },
      });
      setResult(
        saved ?? { status: "error", message: "Something went wrong" },
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand Kit</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label>Colors</Label>
          {colors.map((color, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`Pick color ${i + 1}`}
                // <input type=color> only understands #rrggbb — fall back to
                // black for partial/3-digit values while typing.
                value={HEX_RE.test(color) && color.length === 7 ? color : "#000000"}
                onChange={(e) =>
                  setColors(colors.map((c, j) => (j === i ? e.target.value : c)))
                }
                className="border-input size-9 shrink-0 cursor-pointer rounded-md border p-1"
              />
              <Input
                value={color}
                placeholder="#1A2B3C"
                className="font-mono"
                onChange={(e) =>
                  setColors(colors.map((c, j) => (j === i ? e.target.value : c)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setColors(colors.filter((_, j) => j !== i))}
              >
                <X />
                <span className="sr-only">Remove color</span>
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setColors([...colors, "#000000"])}
          >
            <Plus />
            Add color
          </Button>
        </div>

        <ListEditor
          label="Fonts"
          values={fonts}
          onChange={setFonts}
          placeholder="e.g. Inter, Playfair Display"
          addLabel="Add font"
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tone-notes">Tone of voice</Label>
          <Textarea
            id="tone-notes"
            value={toneNotes}
            onChange={(e) => setToneNotes(e.target.value)}
            placeholder="Direct, no fluff, speaks like a coach who's been there…"
            rows={3}
          />
        </div>

        <ListEditor
          label="Do / don't rules"
          values={rules}
          onChange={setRules}
          placeholder='e.g. "never show scales", "no red"'
          addLabel="Add rule"
        />

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save Brand Kit
          </Button>
          {result?.status === "success" && (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
              <Check className="size-4" />
              Saved
            </span>
          )}
          {result?.status === "error" && (
            <span className="text-destructive text-sm">{result.message}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
