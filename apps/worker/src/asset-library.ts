import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AssetKind,
  BrandKitSchema,
  ClientAssetSchema,
  type BrandKit,
  type ClientAsset,
} from "@gmc/shared";

// Client Asset Library access for the Phase 3/4 generation agents: the
// manifest tells the concept agent what reference material exists (owner
// photos → identity mode, inspiration ads → style/layout mode, product
// shots → product mode) and hands the prompt compiler fetchable URLs.

/** Long enough to outlive a full still/video generation run. */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

export type ManifestAsset = ClientAsset & {
  /** Signed URL, or null if signing failed (asset still listed so the agent knows it exists). */
  url: string | null;
};

export type AssetManifest = {
  client_id: string;
  brand: BrandKit | null;
  /** Only kinds with at least one asset are present. */
  assets: Partial<Record<AssetKind, ManifestAsset[]>>;
};

export async function getAssetManifest(
  supabase: SupabaseClient,
  clientId: string,
  opts: { signedUrlTtlSeconds?: number } = {},
): Promise<AssetManifest> {
  const ttl = opts.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;

  const [clientResult, assetsResult] = await Promise.all([
    supabase.from("clients").select("brand_json").eq("id", clientId).single(),
    supabase
      .from("client_assets")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
  ]);
  if (clientResult.error) {
    throw new Error(`Failed to load client ${clientId}: ${clientResult.error.message}`);
  }
  if (assetsResult.error) {
    throw new Error(`Failed to load assets for ${clientId}: ${assetsResult.error.message}`);
  }

  const brandParsed = BrandKitSchema.nullable().safeParse(
    clientResult.data?.brand_json ?? null,
  );
  const brand = brandParsed.success ? brandParsed.data : null;

  const assets = (assetsResult.data ?? []).map((row) =>
    ClientAssetSchema.parse(row),
  );

  // Sign per bucket in one batch each (uploads live in client-assets,
  // auto-registered inspiration ads in ad-media).
  const urlByBucketPath = new Map<string, string>();
  const buckets = [...new Set(assets.map((a) => a.bucket))];
  for (const bucket of buckets) {
    const paths = assets
      .filter((a) => a.bucket === bucket)
      .map((a) => a.storage_path);
    const { data: signed, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, ttl);
    if (error) {
      console.warn(
        `[asset-library] failed to sign ${paths.length} URLs in ${bucket}: ${error.message}`,
      );
      continue;
    }
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) {
        urlByBucketPath.set(`${bucket}/${item.path}`, item.signedUrl);
      }
    }
  }

  const grouped: AssetManifest["assets"] = {};
  for (const asset of assets) {
    const entry: ManifestAsset = {
      ...asset,
      url: urlByBucketPath.get(`${asset.bucket}/${asset.storage_path}`) ?? null,
    };
    (grouped[asset.kind] ??= []).push(entry);
  }

  return { client_id: clientId, brand, assets: grouped };
}
