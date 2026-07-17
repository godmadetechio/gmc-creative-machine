import "../env";
import { z } from "zod";
import {
  AD_MEDIA_BUCKET,
  MirroredMediaSchema,
  inspirationAssetsForCandidate,
  type MirroredMedia,
} from "@gmc/shared";
import { createServiceClient } from "../supabase";

// pnpm assets:backfill
// One-off Phase 2.5 backfill: every already-selected ad_candidate gets its
// media mirrored to Storage (fbcdn URLs expire — some may already be dead)
// and registered in client_assets as inspiration_ad. Newly selected
// candidates get this automatically in the dashboard review action; run this
// once after deploying the client_assets migration. Idempotent — mirrored
// files and registered assets are skipped on re-run.

const CandidateSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  advertiser: z.string().nullable(),
  match_score: z.number().int().nullable(),
  match_rationale_json: z.unknown().nullable(),
  media_urls: z.array(z.string()).nullable(),
  media_storage_paths: z.array(MirroredMediaSchema).nullable().default(null),
});
type Candidate = z.infer<typeof CandidateSchema>;

const FETCH_TIMEOUT_MS = 30_000;
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

// Same mirroring contract as apps/dashboard/lib/media-mirror.ts (which runs
// per-selection inside the review action): idempotent, index-derived paths,
// warn-don't-fail per file.
async function mirrorCandidateMedia(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: Candidate,
): Promise<MirroredMedia[]> {
  const mediaUrls = candidate.media_urls ?? [];
  const existing = candidate.media_storage_paths ?? [];
  const alreadyMirrored = new Set(existing.map((m) => m.source_url));
  const targets = mediaUrls.filter((url) => !alreadyMirrored.has(url));
  if (targets.length === 0) return existing;

  const mirrored: MirroredMedia[] = [...existing];
  for (const url of targets) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
        `[assets:backfill] candidate ${candidate.id}: failed to mirror ${url}: ${
          err instanceof Error ? err.message : err
        } — link likely expired`,
      );
    }
  }

  if (mirrored.length > existing.length) {
    const { error } = await supabase
      .from("ad_candidates")
      .update({ media_storage_paths: mirrored })
      .eq("id", candidate.id);
    if (error) {
      console.warn(
        `[assets:backfill] candidate ${candidate.id}: files uploaded but failed to record paths: ${error.message}`,
      );
    }
  }
  return mirrored;
}

async function main() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("ad_candidates")
    .select(
      "id, client_id, advertiser, match_score, match_rationale_json, media_urls, media_storage_paths",
    )
    .eq("status", "selected")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load selected candidates: ${error.message}`);

  const candidates = (data ?? []).map((row) => CandidateSchema.parse(row));
  console.log(`[assets:backfill] ${candidates.length} selected candidate(s) on file`);

  let registered = 0;
  let withoutMedia = 0;
  for (const candidate of candidates) {
    const mirrored = await mirrorCandidateMedia(supabase, candidate);
    const assetRows = inspirationAssetsForCandidate({
      ...candidate,
      media_storage_paths: mirrored,
    });
    if (assetRows.length === 0) {
      withoutMedia += 1;
      console.warn(
        `[assets:backfill] candidate ${candidate.id} (${candidate.advertiser ?? "unknown"}): no media survived — nothing to register`,
      );
      continue;
    }
    const { error: upsertError } = await supabase
      .from("client_assets")
      .upsert(assetRows, { onConflict: "bucket,storage_path" });
    if (upsertError) {
      console.warn(
        `[assets:backfill] candidate ${candidate.id}: failed to register assets: ${upsertError.message}`,
      );
      continue;
    }
    registered += assetRows.length;
    console.log(
      `[assets:backfill] candidate ${candidate.id} (${candidate.advertiser ?? "unknown"}): ${assetRows.length} inspiration asset(s) registered`,
    );
  }

  console.log(
    `[assets:backfill] done — ${registered} asset(s) registered across ${candidates.length} candidate(s)` +
      (withoutMedia > 0 ? `, ${withoutMedia} candidate(s) had no recoverable media` : ""),
  );
}

main().catch((err) => {
  console.error(
    `[assets:backfill] FAILED: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
});
