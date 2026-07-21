import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ClientAssetSchema,
  CreativeRegenInputSchema,
  CreativeSchema,
  CREATIVES_BUCKET,
  type AspectRatio,
} from "@gmc/shared";
import { createFalNanoBananaProvider, getFalApiKey } from "../image-provider";
import type { PipelineHandler } from "./index";

// CREATIVE REGEN — after an asset request is fulfilled, re-run ONE
// creative's generation with the real asset attached as reference. Cheap:
// the compiled prompt is reused verbatim (no agent calls), one image at
// the creative's primary aspect. The regenerated version is a NEW draft
// row; the fallback original stays reviewable.

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export const creativeRegenHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = CreativeRegenInputSchema.parse(run.input_json ?? {});
  if (!run.client_id) throw new Error("creative_regen runs require a client_id");

  const falKey = getFalApiKey();
  if (!falKey) {
    throw new Error("FAL_API_KEY is not set — cannot regenerate the creative.");
  }
  const provider = createFalNanoBananaProvider(falKey);

  const [{ data: creativeRow, error: creativeError }, { data: assetRow, error: assetError }] =
    await Promise.all([
      supabase.from("creatives").select("*").eq("id", input.creative_id).maybeSingle(),
      supabase.from("client_assets").select("*").eq("id", input.asset_id).maybeSingle(),
    ]);
  if (creativeError) throw new Error(`Failed to load creative: ${creativeError.message}`);
  if (!creativeRow) throw new Error(`Creative ${input.creative_id} not found`);
  if (assetError) throw new Error(`Failed to load asset: ${assetError.message}`);
  if (!assetRow) throw new Error(`Asset ${input.asset_id} not found`);

  const creative = CreativeSchema.parse(creativeRow);
  const asset = ClientAssetSchema.parse(assetRow);
  if (creative.client_id !== run.client_id || asset.client_id !== run.client_id) {
    throw new Error("Creative and asset must belong to the run's client.");
  }
  if (!creative.prompt_used) {
    throw new Error("Creative has no stored prompt — cannot regenerate.");
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    throw new Error(`Failed to sign asset URL: ${signError?.message ?? "no URL"}`);
  }

  const aspect: AspectRatio = creative.aspect_files?.[0]?.aspect ?? "4:5";
  const label = `regen ${creative.id.slice(0, 8)} / ${aspect}`;
  console.log(`[creative_regen] ${label} with real asset ${asset.kind}…`);

  const result = await provider.generate({
    prompt: creative.prompt_used,
    aspectRatio: aspect,
    referenceImageUrls: [signed.signedUrl],
    label,
  });

  const download = await fetch(result.imageUrl);
  if (!download.ok) {
    throw Object.assign(new Error(`image download failed (${download.status})`), {
      costUsd: result.costUsd,
    });
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  const storagePath = `clients/${run.client_id}/runs/${run.id}/regen-${creative.id.slice(0, 8)}-${aspect.replace(":", "x")}.png`;
  const { error: uploadError } = await supabase.storage
    .from(CREATIVES_BUCKET)
    .upload(storagePath, bytes, { contentType: "image/png", upsert: true });
  if (uploadError) {
    throw Object.assign(new Error(`storage upload failed: ${uploadError.message}`), {
      costUsd: result.costUsd,
    });
  }

  // New draft row; the fallback original stays untouched for comparison.
  const { data: inserted, error: insertError } = await supabase
    .from("creatives")
    .insert({
      client_id: creative.client_id,
      run_id: run.id,
      ad_candidate_id: creative.ad_candidate_id,
      type: creative.type,
      avatar: creative.avatar,
      hook: creative.hook,
      framework: creative.framework,
      prompt_used: creative.prompt_used,
      model: provider.model,
      storage_path: storagePath,
      aspect_files: [{ aspect, storage_path: storagePath }],
      concept_json: creative.concept_json,
      directives_used: (creativeRow as { directives_used?: unknown }).directives_used ?? null,
      status: "draft",
      cost_usd: Number(result.costUsd.toFixed(4)),
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw Object.assign(
      new Error(`image generated but failed to write creative: ${insertError?.message}`),
      { costUsd: result.costUsd },
    );
  }

  const { error: runError } = await supabase
    .from("runs")
    .update({
      status: "needs_review",
      output_json: {
        regenerated_creative_id: inserted.id,
        source_creative_id: creative.id,
        asset_id: asset.id,
        asset_kind: asset.kind,
        aspect,
      },
      cost_usd: Number(result.costUsd.toFixed(4)),
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (runError) {
    throw new Error(`regenerated creative written, but failed to update run: ${runError.message}`);
  }
  console.log(`[creative_regen] done — new draft ${inserted.id}, $${result.costUsd.toFixed(2)}`);
};
