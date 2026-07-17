import type { SupabaseClient } from "@supabase/supabase-js";
import { AD_MEDIA_BUCKET, type MirroredMedia } from "@gmc/shared";

// fbcdn media URLs are signed and expire after a while. When a candidate is
// selected, its media is downloaded into Supabase Storage right then so the
// files still exist when Phase 3 wants them as style references. Every step
// warns instead of failing — a broken mirror must never break the review.

export { AD_MEDIA_BUCKET };

const FETCH_TIMEOUT_MS = 30_000;
// Supabase Storage's default per-file limit is 50MB; skip anything bigger.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function extensionFor(contentType: string | null, url: string): string {
  const fromType = contentType && EXTENSION_BY_TYPE[contentType.split(";")[0]!.trim()];
  if (fromType) return fromType;
  const fromPath = url.match(/\.(\w{2,4})(?:\?|$)/)?.[1]?.toLowerCase();
  return fromPath ?? "bin";
}

export type MirrorableCandidate = {
  id: string;
  client_id: string;
  media_urls: string[] | null;
  media_storage_paths: MirroredMedia[] | null;
};

export function storagePublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${AD_MEDIA_BUCKET}/${path}`;
}

// Idempotent: already-mirrored source URLs are skipped, and storage paths are
// derived from the media_urls index so a re-run overwrites rather than piles up.
// Returns the candidate's full mirrored-media list (old + new) so callers can
// register the files elsewhere (e.g. as inspiration_ad client assets).
export async function mirrorCandidateMedia(
  supabase: SupabaseClient,
  candidate: MirrorableCandidate,
): Promise<MirroredMedia[]> {
  const mediaUrls = candidate.media_urls ?? [];
  const existing = candidate.media_storage_paths ?? [];
  const alreadyMirrored = new Set(existing.map((m) => m.source_url));
  const targets = mediaUrls.filter((url) => !alreadyMirrored.has(url));
  if (targets.length === 0) return existing;

  const mirrored: MirroredMedia[] = [...existing];
  for (const url of targets) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`fetch returned ${res.status}`);
      const body = await res.arrayBuffer();
      if (body.byteLength > MAX_FILE_BYTES) {
        throw new Error(`file too large (${Math.round(body.byteLength / 1024 / 1024)}MB)`);
      }
      const contentType = res.headers.get("content-type");
      const path = `${candidate.client_id}/${candidate.id}/${mediaUrls.indexOf(url)}.${extensionFor(contentType, url)}`;

      const { error } = await supabase.storage
        .from(AD_MEDIA_BUCKET)
        .upload(path, body, {
          contentType: contentType?.split(";")[0]?.trim() || "application/octet-stream",
          upsert: true,
        });
      if (error) throw new Error(error.message);
      mirrored.push({ source_url: url, storage_path: path });
    } catch (err) {
      console.warn(
        `[media-mirror] candidate ${candidate.id}: failed to mirror ${url}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  if (mirrored.length === existing.length) {
    console.warn(
      `[media-mirror] candidate ${candidate.id}: 0/${targets.length} files mirrored — media may already be expired`,
    );
    return existing;
  }

  const { error } = await supabase
    .from("ad_candidates")
    .update({ media_storage_paths: mirrored })
    .eq("id", candidate.id);
  if (error) {
    console.warn(
      `[media-mirror] candidate ${candidate.id}: files uploaded but failed to record paths: ${error.message}`,
    );
    return mirrored;
  }
  console.log(
    `[media-mirror] candidate ${candidate.id}: mirrored ${mirrored.length - existing.length}/${targets.length} files`,
  );
  return mirrored;
}
