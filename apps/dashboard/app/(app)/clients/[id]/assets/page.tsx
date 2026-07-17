import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileIcon } from "lucide-react";
import { z } from "zod";
import {
  AD_MEDIA_BUCKET,
  AssetKind,
  CLIENT_ASSETS_BUCKET,
  ClientAssetSchema,
  ClientSchema,
  type ClientAsset,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { storagePublicUrl } from "@/lib/media-mirror";
import { ASSET_KIND_LABELS } from "./asset-kinds";
import { AssetUploader } from "./asset-uploader";
import { BrandKitCard } from "./brand-kit-card";
import { DeleteAssetButton } from "./delete-asset-button";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

function isVideoPath(path: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(path);
}

function isImagePath(path: string): boolean {
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function AssetCard({
  asset,
  previewUrl,
}: {
  asset: ClientAsset;
  previewUrl: string | null;
}) {
  const label = asset.notes ?? fileName(asset.storage_path);
  return (
    <Card className="overflow-hidden py-0">
      <div className="bg-muted relative aspect-square">
        {previewUrl && isImagePath(asset.storage_path) ? (
          // Plain <img>: signed Supabase Storage URLs are query-signed and
          // short-lived, which doesn't play well with next/image caching.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={label}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : previewUrl && isVideoPath(asset.storage_path) ? (
          <video
            src={previewUrl}
            className="size-full object-cover"
            muted
            controls
            preload="metadata"
          />
        ) : (
          <a
            href={previewUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-xs"
          >
            <FileIcon className="size-6" />
            <span className="break-all">{fileName(asset.storage_path)}</span>
          </a>
        )}
        <div className="absolute top-2 right-2">
          <DeleteAssetButton
            assetId={asset.id}
            clientId={asset.client_id}
            assetLabel={label}
          />
        </div>
        {asset.source_candidate_id && (
          <Badge variant="secondary" className="absolute bottom-2 left-2">
            auto
          </Badge>
        )}
      </div>
      {asset.notes && (
        <CardContent className="px-3 pb-3">
          <p
            className="text-muted-foreground line-clamp-3 text-xs"
            title={asset.notes}
          >
            {asset.notes}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

export default async function ClientAssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [clientResult, assetsResult] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("client_assets")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const assets = (assetsResult.data ?? []).map((row) =>
    ClientAssetSchema.parse(row),
  );

  // One preview URL per asset: signed for the private client-assets bucket,
  // public for inspiration files living in ad-media.
  const urlByPath = new Map<string, string>();
  const privatePaths = assets
    .filter((a) => a.bucket === CLIENT_ASSETS_BUCKET)
    .map((a) => a.storage_path);
  if (privatePaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(CLIENT_ASSETS_BUCKET)
      .createSignedUrls(privatePaths, SIGNED_URL_TTL_SECONDS);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) {
        urlByPath.set(`${CLIENT_ASSETS_BUCKET}/${item.path}`, item.signedUrl);
      }
    }
  }
  for (const asset of assets) {
    if (asset.bucket === AD_MEDIA_BUCKET) {
      urlByPath.set(
        `${AD_MEDIA_BUCKET}/${asset.storage_path}`,
        storagePublicUrl(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          asset.storage_path,
        ),
      );
    }
  }

  const groups = AssetKind.options
    .map((kind) => ({
      kind,
      assets: assets.filter((a) => a.kind === kind),
    }))
    .filter((group) => group.assets.length > 0);

  return (
    <div>
      <Link
        href={`/clients/${client.id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        {client.name}
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">Asset Library</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Reference material the Phase 3/4 generation agents pull from — owner
        photos become identity references, inspiration ads become
        layout/style references, product shots get composited into scenes.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <AssetUploader clientId={client.id} />

          {groups.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                No assets yet. Upload owner photos, the logo, product shots,
                and a few ads the client likes — every creative the machine
                makes gets better for it.
              </CardContent>
            </Card>
          ) : (
            groups.map((group) => (
              <section key={group.kind}>
                <h2 className="text-lg font-semibold">
                  {ASSET_KIND_LABELS[group.kind]}
                  <span className="text-muted-foreground ml-2 text-sm font-normal">
                    {group.assets.length}
                  </span>
                </h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {group.assets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      previewUrl={
                        urlByPath.get(`${asset.bucket}/${asset.storage_path}`) ??
                        null
                      }
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <div>
          <BrandKitCard clientId={client.id} initial={client.brand_json} />
        </div>
      </div>
    </div>
  );
}
