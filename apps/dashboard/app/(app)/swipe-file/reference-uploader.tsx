"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { REFERENCE_LIBRARY_BUCKET, SeedVertical } from "@gmc/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { registerReference } from "./actions";

// Supabase Storage's default per-file limit is 50MB.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function extensionFor(file: File): string {
  const fromName = file.name.match(/\.(\w{1,8})$/)?.[1]?.toLowerCase();
  return fromName ?? "bin";
}

function titleFromFilename(name: string): string {
  return name.replace(/\.\w{1,8}$/, "").replace(/[-_]+/g, " ").trim() || name;
}

export function ReferenceUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [vertical, setVertical] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const busy = progress !== null;

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    setErrors([]);
    const failed: string[] = [];
    const supabase = createClient();

    // Files go straight from the browser to Storage; rows are registered via
    // a server action afterwards. Title defaults to the filename — refine it
    // (and the notes brief) in the edit dialog.
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      setProgress(`Uploading ${i + 1}/${files.length} — ${file.name}`);
      if (file.size > MAX_FILE_BYTES) {
        failed.push(`${file.name}: larger than 50MB`);
        continue;
      }
      const storagePath = `library/${crypto.randomUUID()}.${extensionFor(file)}`;
      const { error: uploadError } = await supabase.storage
        .from(REFERENCE_LIBRARY_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (uploadError) {
        failed.push(`${file.name}: ${uploadError.message}`);
        continue;
      }
      const result = await registerReference({
        title: titleFromFilename(file.name),
        storage_path: storagePath,
        source_url: "",
        notes,
        tags,
        vertical,
      });
      if (result?.status === "error") {
        failed.push(`${file.name}: ${result.message}`);
      }
    }

    setProgress(null);
    setErrors(failed);
    if (failed.length < files.length) {
      setNotes("");
      setTags("");
      router.refresh();
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 px-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref-notes">Notes (what to take / when to use)</Label>
            <Input
              id="ref-notes"
              value={notes}
              disabled={busy}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g. "steal the layout, ignore the colors"'
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref-tags">Tags (comma-separated)</Label>
            <Input
              id="ref-tags"
              value={tags}
              disabled={busy}
              onChange={(e) => setTags(e.target.value)}
              placeholder="native-look, big-headline"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref-vertical">Vertical</Label>
            <select
              id="ref-vertical"
              value={vertical}
              disabled={busy}
              onChange={(e) => setVertical(e.target.value)}
              className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-[3px]"
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

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void uploadFiles(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "text-muted-foreground flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-sm transition-colors",
            dragActive
              ? "border-primary bg-primary/5 text-foreground"
              : "border-input hover:border-primary/50",
            busy && "cursor-default opacity-70",
          )}
        >
          {busy ? (
            <>
              <Loader2 className="size-6 animate-spin" />
              {progress}
            </>
          ) : (
            <>
              <UploadCloud className="size-6" />
              <span>
                Drag &amp; drop reference images here, or click to browse.
                Title comes from the filename — polish it in the edit dialog.
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="image/*"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadFiles(files);
          }}
        />

        {errors.length > 0 && (
          <ul className="text-destructive text-sm">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
