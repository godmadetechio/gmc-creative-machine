import Link from "next/link";
import { FileIcon, GalleryHorizontalEnd } from "lucide-react";
import { z } from "zod";
import {
  AD_MEDIA_BUCKET,
  AssetKind,
  AssetRequestSchema,
  CLIENT_ASSETS_BUCKET,
  ClientAssetSchema,
  ClientReferencePickSchema,
  REFERENCE_LIBRARY_BUCKET,
  ReferenceLibraryEntrySchema,
  type Client,
  type ClientAsset,
} from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaginationBar } from "@/components/pagination-bar";
import { adMediaThumbUrl, signMany, type SignedImage } from "@/lib/storage";
import { parsePageParams } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { AssetRequestCard } from "../asset-request-card";
import { CopyRequestsButton } from "../copy-requests-button";
import { ASSET_KIND_LABELS } from "../assets/asset-kinds";
import { AssetUploader } from "../assets/asset-uploader";
import { BrandKitCard } from "../assets/brand-kit-card";
import { DeleteAssetButton } from "../assets/delete-asset-button";
import { PromoteAssetButton } from "../assets/promote-asset-button";
import { ReferencePickCard } from "../references/reference-pick-card";

type SearchParams = Record<string, string | string[] | undefined>;

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
  preview,
}: {
  asset: ClientAsset;
  preview: SignedImage | null;
}) {
  const label = asset.notes ?? fileName(asset.storage_path);
  return (
    <Card className="overflow-hidden py-0">
      <div className="bg-muted relative aspect-square">
        {preview && isImagePath(asset.storage_path) ? (
          // Plain <img>: signed Supabase Storage URLs are query-signed and
          // short-lived, which doesn't play well with next/image caching.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.thumbUrl}
            alt={label}
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : preview && isVideoPath(asset.storage_path) ? (
          <video
            src={preview.url}
            className="size-full object-cover"
            muted
            controls
            preload="metadata"
          />
        ) : (
          <a
            href={preview?.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-xs"
          >
            <FileIcon className="size-6" />
            <span className="break-all">{fileName(asset.storage_path)}</span>
          </a>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          {(asset.kind === "inspiration_ad" || asset.kind === "example_ad") && (
            <PromoteAssetButton assetId={asset.id} clientId={asset.client_id} />
          )}
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

export async function AssetsTab({
  client,
  searchParams,
}: {
  client: Client;
  searchParams: SearchParams;
}) {
  const { page, from, to } = parsePageParams(searchParams);
  const supabase = await createClient();

  const [
    assetsResult,
    referencesResult,
    picksResult,
    assetRequestsResult,
    regenRunsResult,
  ] = await Promise.all([
    supabase
      .from("client_assets")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("reference_library")
      .select("*", { count: "exact" })
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase.from("client_reference_picks").select("*").eq("client_id", client.id),
    supabase
      .from("asset_requests")
      .select("*, creative:creatives(hook)")
      .eq("client_id", client.id)
      .in("status", ["open", "fulfilled"])
      .order("created_at", { ascending: false }),
    supabase
      .from("runs")
      .select("input_json")
      .eq("client_id", client.id)
      .eq("type", "creative_regen")
      .in("status", ["queued", "running"]),
  ]);

  const assets = (assetsResult.data ?? []).map((row) => ClientAssetSchema.parse(row));
  const references = (referencesResult.data ?? []).map((row) =>
    ReferenceLibraryEntrySchema.parse(row),
  );
  const referenceCount = referencesResult.count ?? references.length;
  const picks = (picksResult.data ?? []).map((row) =>
    ClientReferencePickSchema.parse(row),
  );
  const pickByReference = new Map(picks.map((p) => [p.reference_id, p]));

  // Previews: signed (with thumbs) for the private client-assets bucket,
  // public render endpoint for inspiration files living in ad-media.
  const privatePaths = assets
    .filter((a) => a.bucket === CLIENT_ASSETS_BUCKET)
    .map((a) => a.storage_path);
  const [signedAssets, signedReferences] = await Promise.all([
    signMany(CLIENT_ASSETS_BUCKET, privatePaths),
    signMany(REFERENCE_LIBRARY_BUCKET, references.map((r) => r.storage_path)),
  ]);
  const previewFor = (asset: ClientAsset): SignedImage | null => {
    if (asset.bucket === AD_MEDIA_BUCKET) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      return {
        url: `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${AD_MEDIA_BUCKET}/${asset.storage_path}`,
        thumbUrl: adMediaThumbUrl(supabaseUrl, asset.storage_path),
      };
    }
    return signedAssets.get(asset.storage_path) ?? null;
  };

  // Asset requests: open ones (incl. possibly-fulfilled) + recently
  // fulfilled ones whose linked creative can be regenerated.
  const assetRequestRows = (assetRequestsResult.data ?? []).map((row) => {
    const { creative, ...rest } = row as Record<string, unknown> & {
      creative: { hook: string | null } | null;
    };
    return {
      request: AssetRequestSchema.parse(rest),
      creativeHook: creative?.hook ?? null,
    };
  });
  const openRequests = assetRequestRows.filter((r) => r.request.status === "open");
  const regenerableRequests = assetRequestRows
    .filter(
      (r) =>
        r.request.status === "fulfilled" &&
        r.request.creative_id !== null &&
        r.request.fulfilled_asset_id !== null,
    )
    .slice(0, 4);
  const regenActiveCreativeIds = new Set(
    (regenRunsResult.data ?? [])
      .map((run) => {
        const parsed = z
          .object({ creative_id: z.string().uuid() })
          .safeParse(run.input_json);
        return parsed.success ? parsed.data.creative_id : null;
      })
      .filter((v): v is string => v !== null),
  );

  const groups = AssetKind.options
    .map((kind) => ({ kind, assets: assets.filter((a) => a.kind === kind) }))
    .filter((group) => group.assets.length > 0);

  const sortedReferences = [...references].sort(
    (a, b) => Number(pickByReference.has(b.id)) - Number(pickByReference.has(a.id)),
  );

  const makeRefHref = (nextPage: number) => {
    const params = new URLSearchParams({ tab: "assets" });
    if (nextPage > 1) params.set("page", String(nextPage));
    return `/clients/${client.id}?${params}`;
  };

  return (
    <div className="mt-6 flex flex-col gap-8">
      {(openRequests.length > 0 || regenerableRequests.length > 0) && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Asset Requests
                {openRequests.length > 0 && ` (${openRequests.length} open)`}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Assets the generation agents wished they had — every creative
                was still fully generated with a fallback.
              </p>
            </div>
            <CopyRequestsButton
              clientName={client.name}
              requests={openRequests.map((r) => r.request)}
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...openRequests, ...regenerableRequests].map(({ request, creativeHook }) => (
              <AssetRequestCard
                key={request.id}
                request={request}
                creativeHook={creativeHook}
                regenActive={
                  request.creative_id !== null &&
                  regenActiveCreativeIds.has(request.creative_id)
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-lg font-semibold">Asset Library</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Owner photos become identity references, inspiration ads become
              layout/style references, product shots get composited into scenes.
            </p>
          </div>
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
                <h3 className="text-lg font-semibold">
                  {ASSET_KIND_LABELS[group.kind]}
                  <span className="text-muted-foreground ml-2 text-sm font-normal">
                    {group.assets.length}
                  </span>
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {group.assets.map((asset) => (
                    <AssetCard key={asset.id} asset={asset} preview={previewFor(asset)} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <div>
          <BrandKitCard clientId={client.id} initial={client.brand_json} />
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">References</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Pick which swipe-file references {client.name}&apos;s generation
              runs use as style references ({picks.length} picked). Add new
              ones in the global Swipe File.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/swipe-file">
              <GalleryHorizontalEnd />
              Open Swipe File
            </Link>
          </Button>
        </div>

        {references.length === 0 ? (
          <Card className="mt-4">
            <CardContent className="text-muted-foreground py-12 text-center text-sm">
              The swipe file is empty — upload agency references there first.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {sortedReferences.map((reference) => {
                const pick = pickByReference.get(reference.id);
                return (
                  <ReferencePickCard
                    key={reference.id}
                    clientId={client.id}
                    reference={reference}
                    previewUrl={
                      signedReferences.get(reference.storage_path)?.thumbUrl ?? null
                    }
                    picked={!!pick}
                    noteOverride={pick?.note_override ?? null}
                  />
                );
              })}
            </div>
            <div className="mt-3">
              <PaginationBar
                page={page}
                totalCount={referenceCount}
                makeHref={makeRefHref}
                label="references"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
