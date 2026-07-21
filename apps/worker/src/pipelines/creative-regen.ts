import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ClientAssetSchema,
  CreativeRegenInputSchema,
  CreativeSchema,
  CREATIVES_BUCKET,
  StillConceptSchema,
  type AspectRatio,
  type Creative,
} from "@gmc/shared";
import { createFalNanoBananaProvider, getFalApiKey } from "../image-provider";
import type { PipelineHandler } from "./index";

// CREATIVE REGEN — re-run ONE creative's generation. Cheap by design: no
// agent calls, one image at the creative's primary aspect, and the
// regenerated version is a NEW draft row (the original stays reviewable).
// Two modes:
//   asset — after an asset request is fulfilled, reuse the compiled prompt
//           verbatim with the real asset attached as reference.
//   retry — after a rejection, reuse the compiled prompt with the rejection
//           feedback appended as revision notes and the original references
//           re-attached. Salvages near-misses without a full still_ads run.

const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Retry mode re-signs the creative's original references so identity /
// product / style compositing still routes through the edit endpoint.
async function signOriginalReferences(
  supabase: SupabaseClient,
  creative: Creative,
): Promise<string[]> {
  const concept = StillConceptSchema.safeParse(creative.concept_json);
  if (!concept.success || concept.data.referenced_asset_ids.length === 0) return [];

  const { data: assetRows, error } = await supabase
    .from("client_assets")
    .select("*")
    .in("id", concept.data.referenced_asset_ids);
  if (error) throw new Error(`Failed to load referenced assets: ${error.message}`);

  const urls: string[] = [];
  for (const row of assetRows ?? []) {
    const asset = ClientAssetSchema.parse(row);
    const { data: signed, error: signError } = await supabase.storage
      .from(asset.bucket)
      .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      console.warn(
        `[creative_regen] could not sign reference ${asset.id}: ${signError?.message ?? "no URL"} — continuing without it`,
      );
      continue;
    }
    urls.push(signed.signedUrl);
  }
  return urls;
}

export const creativeRegenHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = CreativeRegenInputSchema.parse(run.input_json ?? {});
  if (!run.client_id) throw new Error("creative_regen runs require a client_id");

  const falKey = getFalApiKey();
  if (!falKey) {
    throw new Error("FAL_API_KEY is not set — cannot regenerate the creative.");
  }
  const provider = createFalNanoBananaProvider(falKey);

  const { data: creativeRow, error: creativeError } = await supabase
    .from("creatives")
    .select("*")
    .eq("id", input.creative_id)
    .maybeSingle();
  if (creativeError) throw new Error(`Failed to load creative: ${creativeError.message}`);
  if (!creativeRow) throw new Error(`Creative ${input.creative_id} not found`);
  const creative = CreativeSchema.parse(creativeRow);
  if (creative.client_id !== run.client_id) {
    throw new Error("Creative must belong to the run's client.");
  }
  if (!creative.prompt_used) {
    throw new Error("Creative has no stored prompt — cannot regenerate.");
  }

  const mode = input.feedback != null ? "retry" : "asset";
  let prompt = creative.prompt_used;
  let referenceUrls: string[];
  if (mode === "retry") {
    // Revision framing: the model keeps everything that already worked and
    // fixes only what the operator flagged.
    prompt = `${creative.prompt_used}\n\nREVISION NOTES — a previous render of this exact brief was rejected for the reason below. Keep the same layout, subject and text; change ONLY what the notes call out:\n${input.feedback}`;
    referenceUrls = await signOriginalReferences(supabase, creative);
  } else {
    const { data: assetRow, error: assetError } = await supabase
      .from("client_assets")
      .select("*")
      .eq("id", input.asset_id!)
      .maybeSingle();
    if (assetError) throw new Error(`Failed to load asset: ${assetError.message}`);
    if (!assetRow) throw new Error(`Asset ${input.asset_id} not found`);
    const asset = ClientAssetSchema.parse(assetRow);
    if (asset.client_id !== run.client_id) {
      throw new Error("Asset must belong to the run's client.");
    }
    const { data: signed, error: signError } = await supabase.storage
      .from(asset.bucket)
      .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`Failed to sign asset URL: ${signError?.message ?? "no URL"}`);
    }
    referenceUrls = [signed.signedUrl];
  }

  const aspect: AspectRatio = creative.aspect_files?.[0]?.aspect ?? "4:5";
  const label = `${mode} ${creative.id.slice(0, 8)} / ${aspect}`;
  console.log(`[creative_regen] ${label} (${referenceUrls.length} reference(s))…`);

  const result = await provider.generate({
    prompt,
    aspectRatio: aspect,
    referenceImageUrls: referenceUrls.length > 0 ? referenceUrls : undefined,
    label,
  });

  const download = await fetch(result.imageUrl);
  if (!download.ok) {
    throw Object.assign(new Error(`image download failed (${download.status})`), {
      costUsd: result.costUsd,
    });
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  const storagePath = `clients/${run.client_id}/runs/${run.id}/${mode}-${creative.id.slice(0, 8)}-${aspect.replace(":", "x")}.png`;
  const { error: uploadError } = await supabase.storage
    .from(CREATIVES_BUCKET)
    .upload(storagePath, bytes, { contentType: "image/png", upsert: true });
  if (uploadError) {
    throw Object.assign(new Error(`storage upload failed: ${uploadError.message}`), {
      costUsd: result.costUsd,
    });
  }

  // New draft row; the original stays untouched for comparison. Retry rows
  // store the revised prompt so a second retry stacks its notes on top.
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
      prompt_used: prompt,
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
        mode,
        regenerated_creative_id: inserted.id,
        source_creative_id: creative.id,
        ...(mode === "asset"
          ? { asset_id: input.asset_id }
          : { feedback: input.feedback }),
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
