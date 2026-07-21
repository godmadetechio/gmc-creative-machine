import { cache } from "react";
import { AD_MEDIA_BUCKET } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

// Server-only signed-URL + thumbnail helpers. Grids render `thumbUrl`
// (width-transformed); lightboxes/dialogs render `url` (full-res).
//
// API constraint (verified against storage-js 2.110.2): the batched
// createSignedUrls does NOT accept transform options — only the singular
// createSignedUrl does. So full-res URLs come from one plural batch, and
// thumbnails fan out per-file, deduped per request via React cache().
//
// Storage image transformations are plan-gated (Supabase Pro+). Default ON;
// set NEXT_PUBLIC_SUPABASE_IMAGE_TRANSFORMS=0 to serve full-res everywhere
// (byte-identical to the pre-thumbnail behavior).

export const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const GRID_THUMB_WIDTH = 480;
const THUMB_QUALITY = 75;

// Transforms only apply to images; videos (and gifs, which transforms
// flatten to a frame) are always served untransformed.
const NON_TRANSFORMABLE_RE = /\.(mp4|webm|mov|gif)(\?|$)/i;

export function transformsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SUPABASE_IMAGE_TRANSFORMS !== "0";
}

// Per-request dedupe: the same (bucket, path, width) signs exactly once per
// render pass, no matter how many components ask.
const signOneCached = cache(
  async (bucket: string, path: string, width: number | null): Promise<string | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(
        path,
        SIGNED_URL_TTL_SECONDS,
        width !== null ? { transform: { width, quality: THUMB_QUALITY } } : undefined,
      );
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  },
);

export type SignedImage = {
  /** Full-resolution signed URL — lightbox / open-in-new-tab. */
  url: string;
  /** Width-transformed signed URL for grids; equals `url` when transforms are off. */
  thumbUrl: string;
};

export async function signMany(
  bucket: string,
  paths: string[],
  opts: { thumbWidth?: number } = {},
): Promise<Map<string, SignedImage>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, SignedImage>();
  if (unique.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error) return result; // callers already treat missing URLs as "no preview"
  const fullByPath = new Map<string, string>();
  for (const file of data ?? []) {
    if (file.path && file.signedUrl) fullByPath.set(file.path, file.signedUrl);
  }

  const width = opts.thumbWidth ?? GRID_THUMB_WIDTH;
  const thumbs = transformsEnabled()
    ? await Promise.all(
        unique.map((path) =>
          NON_TRANSFORMABLE_RE.test(path) ? null : signOneCached(bucket, path, width),
        ),
      )
    : unique.map(() => null);

  unique.forEach((path, i) => {
    const url = fullByPath.get(path);
    if (!url) return;
    result.set(path, { url, thumbUrl: thumbs[i] ?? url });
  });
  return result;
}

/** Thumbnail URL for the PUBLIC ad-media bucket (mirrored candidate media). */
export function adMediaThumbUrl(
  supabaseUrl: string,
  path: string,
  width: number = GRID_THUMB_WIDTH,
): string {
  const base = supabaseUrl.replace(/\/$/, "");
  if (!transformsEnabled() || NON_TRANSFORMABLE_RE.test(path)) {
    return `${base}/storage/v1/object/public/${AD_MEDIA_BUCKET}/${path}`;
  }
  return `${base}/storage/v1/render/image/public/${AD_MEDIA_BUCKET}/${path}?width=${width}&quality=${THUMB_QUALITY}`;
}
