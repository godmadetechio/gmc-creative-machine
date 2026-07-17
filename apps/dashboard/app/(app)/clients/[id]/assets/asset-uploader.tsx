"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { AssetKind, CLIENT_ASSETS_BUCKET } from "@gmc/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { registerAsset } from "./actions";
import { ASSET_KIND_LABELS } from "./asset-kinds";

// Supabase Storage's default per-file limit is 50MB.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function extensionFor(file: File): string {
  const fromName = file.name.match(/\.(\w{1,8})$/)?.[1]?.toLowerCase();
  return fromName ?? "bin";
}

export function AssetUploader({ clientId }: { clientId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AssetKind>("owner_photo");
  const [notes, setNotes] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const busy = progress !== null;

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    setErrors([]);
    const failed: string[] = [];
    const supabase = createClient();

    // Files go straight from the browser to Storage (no server-action body
    // limit); the row is registered via a server action afterwards.
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      setProgress(`Uploading ${i + 1}/${files.length} — ${file.name}`);
      if (file.size > MAX_FILE_BYTES) {
        failed.push(`${file.name}: larger than 50MB`);
        continue;
      }
      const storagePath = `${clientId}/${crypto.randomUUID()}.${extensionFor(file)}`;
      const { error: uploadError } = await supabase.storage
        .from(CLIENT_ASSETS_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (uploadError) {
        failed.push(`${file.name}: ${uploadError.message}`);
        continue;
      }
      const result = await registerAsset({
        client_id: clientId,
        kind,
        storage_path: storagePath,
        notes,
      });
      if (result?.status === "error") {
        failed.push(`${file.name}: ${result.message}`);
      }
    }

    setProgress(null);
    setErrors(failed);
    if (failed.length < files.length) {
      setNotes("");
      router.refresh();
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 px-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-kind">Kind</Label>
            <select
              id="asset-kind"
              value={kind}
              disabled={busy}
              onChange={(e) => setKind(e.target.value as AssetKind)}
              className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-[3px]"
            >
              {AssetKind.options.map((option) => (
                <option key={option} value={option}>
                  {ASSET_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-notes">Notes</Label>
            <Input
              id="asset-notes"
              value={notes}
              disabled={busy}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g. "Ben&apos;s preferred headshot"'
            />
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
                Drag &amp; drop files here, or click to browse — uploads as{" "}
                <span className="text-foreground font-medium">
                  {ASSET_KIND_LABELS[kind]}
                </span>
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
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
