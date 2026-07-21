"use client";

import { useRef, useState, useActionState } from "react";
import { Check, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { CLIENT_ASSETS_BUCKET, type AssetRequest } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { ASSET_KIND_LABELS } from "./assets/asset-kinds";
import {
  clearPossiblyFulfilled,
  confirmPossiblyFulfilled,
  dismissAssetRequest,
  enqueueCreativeRegen,
  fulfillAssetRequest,
  type AssetRequestActionState,
} from "./asset-request-actions";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function extensionFor(file: File): string {
  return file.name.match(/\.(\w{1,8})$/)?.[1]?.toLowerCase() ?? "bin";
}

export function AssetRequestCard({
  request,
  creativeHook,
  regenActive,
}: {
  request: AssetRequest;
  /** Hook of the creative that used a fallback (when linked). */
  creativeHook: string | null;
  /** A creative_regen run for this request's creative is queued/running. */
  regenActive: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dismissState, dismissAction, dismissing] = useActionState<
    AssetRequestActionState,
    FormData
  >(dismissAssetRequest, null);
  const [confirmState, confirmAction, confirming] = useActionState<
    AssetRequestActionState,
    FormData
  >(confirmPossiblyFulfilled, null);
  const [clearState, clearAction, clearing] = useActionState<
    AssetRequestActionState,
    FormData
  >(clearPossiblyFulfilled, null);
  const [regenState, regenAction, regenPending] = useActionState<
    AssetRequestActionState,
    FormData
  >(enqueueCreativeRegen, null);

  const pending = uploading || dismissing || confirming || clearing || regenPending;
  const actionError =
    [dismissState, confirmState, clearState, regenState].find(
      (s) => s?.status === "error",
    ) ?? null;
  const hidden = (
    <>
      <input type="hidden" name="request_id" value={request.id} />
      <input type="hidden" name="client_id" value={request.client_id} />
    </>
  );

  async function uploadAndFulfill(file: File) {
    setUploadError(null);
    if (file.size > MAX_FILE_BYTES) {
      setUploadError("File is larger than 50MB");
      return;
    }
    setUploading(true);
    // Browser → Storage (no server-action body limit), then register.
    const supabase = createClient();
    const storagePath = `${request.client_id}/${crypto.randomUUID()}.${extensionFor(file)}`;
    const { error } = await supabase.storage
      .from(CLIENT_ASSETS_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
      });
    if (error) {
      setUploadError(error.message);
      setUploading(false);
      return;
    }
    const result = await fulfillAssetRequest({
      request_id: request.id,
      client_id: request.client_id,
      storage_path: storagePath,
    });
    if (result?.status === "error") setUploadError(result.message);
    setUploading(false);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2.5 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{ASSET_KIND_LABELS[request.requested_kind]}</Badge>
          {request.priority === "high_impact" ? (
            <Badge className="border-transparent bg-amber-500/90 text-white">
              high impact
            </Badge>
          ) : (
            <Badge variant="outline">nice to have</Badge>
          )}
          {request.status === "fulfilled" && (
            <Badge className="border-transparent bg-emerald-600 text-white">
              Fulfilled
            </Badge>
          )}
        </div>

        <p className="text-sm font-medium">{request.detail}</p>
        <p className="text-muted-foreground text-sm">{request.reason}</p>
        {creativeHook && (
          <p className="text-muted-foreground text-xs">
            Used a fallback in: “{creativeHook}”
          </p>
        )}

        {request.status === "open" && request.possibly_fulfilled_asset_id && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 p-2 text-sm">
            <span className="text-amber-600">
              A {ASSET_KIND_LABELS[request.requested_kind].toLowerCase()} upload
              just arrived — does it cover this?
            </span>
            <form action={confirmAction}>
              {hidden}
              <Button type="submit" size="sm" disabled={pending}>
                <Check />
                Yes, fulfilled
              </Button>
            </form>
            <form action={clearAction}>
              {hidden}
              <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                Not this one
              </Button>
            </form>
          </div>
        )}

        {request.status === "open" && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploading ? "Uploading…" : "Upload to fulfill"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadAndFulfill(file);
              }}
            />
            <form action={dismissAction}>
              {hidden}
              <Button type="submit" size="sm" variant="ghost" disabled={pending}>
                <X />
                Dismiss
              </Button>
            </form>
          </div>
        )}

        {request.status === "fulfilled" && request.creative_id && (
          <form action={regenAction}>
            {hidden}
            <Button type="submit" size="sm" variant="outline" disabled={pending || regenActive}>
              {regenActive ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {regenActive ? "Regenerating…" : "Regenerate with real asset"}
            </Button>
          </form>
        )}

        {(uploadError || (actionError && actionError.status === "error")) && (
          <p className="text-destructive text-sm">
            {uploadError ?? (actionError as { message: string }).message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
