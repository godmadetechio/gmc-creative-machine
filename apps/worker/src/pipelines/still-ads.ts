import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AdCandidateSchema,
  BbmVersionSchema,
  ClientSchema,
  CompilerOutputSchema,
  ConceptAgentOutputSchema,
  CREATIVES_BUCKET,
  isSimilarRequestDetail,
  MAX_ASSET_REQUESTS_PER_RUN,
  StillAdsInputSchema,
  type AdCandidate,
  type AspectFile,
  type AspectRatio,
  type StillAdsInput,
  type StillConcept,
} from "@gmc/shared";
import { withValidationRetry } from "../agent";
import { getAssetManifest, type AssetManifest, type ManifestAsset } from "../asset-library";
import { mapWithConcurrency } from "../concurrency";
import { CostTracker } from "../cost";
import { getCreativeDirection } from "../creative-direction";
import { createDriveUploader, getDriveConfig } from "../drive";
import { getFormatLibrary } from "../format-library";
import {
  createFalNanoBananaProvider,
  getFalApiKey,
  type ImageProvider,
} from "../image-provider";
import { loadPrompt } from "../prompts";
import type { PipelineHandler } from "./index";

// Phase 3 — Still Ad Creation (build plan §6, training integration §2).
// FORMAT × ANGLE × AVATAR concepts, hook-first, compiled into Nano Banana
// Pro generations with identity/style/product references from the Client
// Asset Library.

// Fallback when clients.vertical is unset (pre-direction-migration rows).
const DEFAULT_VERTICAL = "coaching" as const;
// Generations in flight at once (fal queues fairly; 4 keeps us clear of
// rate limits while saturating a run).
const GENERATION_CONCURRENCY = 4;
// Concepts per image-compiler call — small enough to keep each call sharp,
// big enough to amortize the agent overhead.
const COMPILE_BATCH_SIZE = 5;
// Rejection-feedback lines injected into the concept prompt (newest first).
const MAX_FEEDBACK_LINES = 20;

export type StillAdsResult = {
  conceptCount: number;
  creativeCount: number;
  imageCount: number;
  generationCostUsd: number;
  costUsd: number;
  warnings: string[];
  output: Record<string, unknown>;
};

// Which asset kinds may back each reference mode.
const KINDS_BY_MODE: Record<string, string[]> = {
  identity: ["owner_photo"],
  style: ["inspiration_ad", "example_ad"],
  product: ["product_shot", "lifestyle_photo"],
  none: [],
};

function manifestAssetById(manifest: AssetManifest): Map<string, ManifestAsset> {
  const map = new Map<string, ManifestAsset>();
  for (const list of Object.values(manifest.assets)) {
    for (const asset of list ?? []) map.set(asset.id, asset);
  }
  return map;
}

// Winner payload for the concept agent: the skeleton is the product of
// Phase 2 scoring; ad_copy gives the agent the angle in situ.
function winnerPayload(candidate: AdCandidate) {
  const rationale = (candidate.match_rationale_json ?? {}) as Record<string, unknown>;
  return {
    id: candidate.id,
    advertiser: candidate.advertiser,
    match_score: candidate.match_score,
    transferable_skeleton: rationale.transferable_skeleton ?? null,
    hook_pattern: rationale.hook_pattern ?? null,
    format: rationale.format ?? null,
    ad_copy: (candidate.ad_copy ?? "").slice(0, 600),
  };
}

export async function runStillAds(
  clientId: string,
  input: StillAdsInput,
  deps: { supabase: SupabaseClient; runId: string },
): Promise<StillAdsResult> {
  const { supabase, runId } = deps;
  const cost = new CostTracker();
  const warnings: string[] = [];

  const falKey = getFalApiKey();
  if (!falKey) {
    throw new Error(
      "FAL_API_KEY is not set — still_ads generates through fal.ai Nano Banana Pro. Add it to .env.local and verify with pnpm fal:test.",
    );
  }
  const provider: ImageProvider = createFalNanoBananaProvider(falKey);

  // ── 1. Inputs: client, BBM (with avatars), winners, assets, formats ─────
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new Error(`Failed to load client: ${clientError.message}`);
  if (!clientRow) throw new Error(`Client ${clientId} not found`);
  const client = ClientSchema.parse(clientRow);

  const { data: bbmRows, error: bbmError } = await supabase
    .from("bbm_versions")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .limit(1);
  if (bbmError) throw new Error(`Failed to load BBM: ${bbmError.message}`);
  if (!bbmRows?.[0]) {
    throw new Error("No active Buyer Brain Matrix — run the Buyer Brain pipeline first.");
  }
  const bbmVersion = BbmVersionSchema.parse(bbmRows[0]);
  const bbm = bbmVersion.matrix_json;
  if (!bbm.avatars || bbm.avatars.length === 0) {
    throw new Error(
      `Active BBM v${bbmVersion.version} has no avatars — re-run Buyer Brain (the avatar patch) before generating still ads.`,
    );
  }
  const avatarNames = new Set(bbm.avatars.map((a) => a.name));

  const { data: winnerRows, error: winnersError } = await supabase
    .from("ad_candidates")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "selected")
    .order("match_score", { ascending: false, nullsFirst: false });
  if (winnersError) throw new Error(`Failed to load winners: ${winnersError.message}`);
  const winners = (winnerRows ?? []).map((row) => AdCandidateSchema.parse(row));
  if (winners.length === 0) {
    throw new Error(
      "No selected ad candidates — select at least one winner in the candidates queue first.",
    );
  }
  const winnerIds = new Set(winners.map((w) => w.id));

  const vertical = client.vertical ?? DEFAULT_VERTICAL;
  const manifest = await getAssetManifest(supabase, clientId);

  // CREATIVE DIRECTION: standing orders both agents obey. Directive-linked
  // references are standing orders too — merged into the style pool (and
  // the id space concept validation checks) whether or not the client
  // picked them.
  const direction = await getCreativeDirection(supabase, clientId, vertical);
  warnings.push(...direction.warnings);
  const manifestIds = new Set(
    Object.values(manifest.assets).flatMap((list) => (list ?? []).map((a) => a.id)),
  );
  for (const ref of direction.references) {
    if (manifestIds.has(ref.id)) continue;
    (manifest.assets.inspiration_ad ??= []).push(ref);
  }

  const assetById = manifestAssetById(manifest);
  const formats = await getFormatLibrary(supabase, { vertical });
  if (formats.length === 0) {
    warnings.push("Format library is empty — concepts will lean on winner skeletons only.");
  }
  const formatNames = new Set(formats.map((f) => f.name.toLowerCase()));

  // Rejection feedback from ALL prior creative rounds — standing rules.
  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("creatives")
    .select("avatar, framework, feedback, created_at")
    .eq("client_id", clientId)
    .eq("status", "rejected")
    .not("feedback", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_FEEDBACK_LINES);
  if (feedbackError) throw new Error(`Failed to load feedback: ${feedbackError.message}`);
  const rejectionFeedback =
    (feedbackRows ?? [])
      .map(
        (row) =>
          `- [${[row.framework, row.avatar].filter(Boolean).join(" / ") || "creative"}] ${row.feedback}`,
      )
      .join("\n") || "none yet — this is the first round";

  const validationWarner = (name: string) => (issues: string, attempt: number) =>
    warnings.push(
      `${name} output failed validation (attempt ${attempt}): ${
        issues.length > 300 ? `${issues.slice(0, 300)}…` : issues
      }`,
    );

  // ── 2. Concept agent (no tools) ──────────────────────────────────────────
  console.log(
    `[still_ads] generating ${input.concept_count} concepts (BBM v${bbmVersion.version}, ${winners.length} winners, ${formats.length} formats)…`,
  );
  const conceptResult = await withValidationRetry(ConceptAgentOutputSchema, {
    prompt: loadPrompt("concept-agent", {
      concept_count: input.concept_count,
      creative_direction: direction.text,
      client_name: client.name,
      niche: client.niche ?? "not specified",
      brief: client.brief ?? "not specified",
      operator_prompt: input.operator_prompt || "none",
      bbm_json: JSON.stringify(bbm, null, 2),
      winners_json: JSON.stringify(winners.map(winnerPayload), null, 2),
      formats_json: JSON.stringify(
        formats.map((f) => ({
          name: f.name,
          description: f.description,
          psychology: f.psychology,
          skeleton: f.skeleton,
          provenance: f.provenance,
        })),
        null,
        2,
      ),
      asset_manifest_json: JSON.stringify(
        Object.fromEntries(
          Object.entries(manifest.assets).map(([kind, assets]) => [
            kind,
            (assets ?? []).map((a) => ({ id: a.id, notes: a.notes, tags: a.tags })),
          ]),
        ),
        null,
        2,
      ),
      rejection_feedback: rejectionFeedback,
    }),
    tools: [], // pure synthesis over the provided inputs
    maxTurns: 8,
    label: "concept-agent",
    onValidationError: validationWarner("concept-agent"),
  });
  cost.add("concept-agent", conceptResult.costUsd, conceptResult.usage);

  // Code-level cross-checks Zod can't express: avatars, formats and asset
  // references must point at real inputs. Invalid concepts are dropped with
  // a warning — a 9/10 batch beats a dead run.
  const concepts: StillConcept[] = [];
  // Agent-emitted asset_requests cite concepts by their ORIGINAL index —
  // track where each surviving concept landed after cross-check drops.
  const filteredIndexByOriginal = new Map<number, number>();
  for (const [i, concept] of conceptResult.data.concepts.entries()) {
    const problems: string[] = [];
    if (!avatarNames.has(concept.avatar)) {
      problems.push(`avatar "${concept.avatar}" is not a BBM avatar`);
    }
    if (concept.source_candidate_id && !winnerIds.has(concept.source_candidate_id)) {
      problems.push(`source_candidate_id ${concept.source_candidate_id} is not a selected winner`);
    }
    if (!concept.source_candidate_id && !formatNames.has(concept.format_name.toLowerCase())) {
      problems.push(`format "${concept.format_name}" is neither a library format nor a winner skeleton`);
    }
    const allowedKinds = KINDS_BY_MODE[concept.reference_mode] ?? [];
    const badRefs = concept.referenced_asset_ids.filter((id) => {
      const asset = assetById.get(id);
      return !asset || !allowedKinds.includes(asset.kind);
    });
    if (concept.reference_mode !== "none" && concept.referenced_asset_ids.length === 0) {
      problems.push(`reference_mode '${concept.reference_mode}' with no referenced assets`);
    }
    if (badRefs.length > 0) {
      problems.push(`asset ids not in manifest (or wrong kind for mode): ${badRefs.join(", ")}`);
    }
    if (problems.length > 0) {
      warnings.push(`concept ${i + 1} ("${concept.headline}") dropped: ${problems.join("; ")}`);
      continue;
    }
    filteredIndexByOriginal.set(i, concepts.length);
    concepts.push(concept);
  }
  if (concepts.length === 0) {
    throw Object.assign(
      new Error(`All ${conceptResult.data.concepts.length} concepts failed cross-checks — see warnings.`),
      { costUsd: cost.total },
    );
  }
  if (concepts.length > input.concept_count) concepts.length = input.concept_count;
  console.log(`[still_ads] ${concepts.length} concepts passed cross-checks`);

  // ── 3. Prompt compiler (batched) ─────────────────────────────────────────
  type VariantKey = { concept_index: number; hook_index: number };
  const compiled = new Map<string, string>(); // "ci:hi" -> prompt
  const keyOf = (v: VariantKey) => `${v.concept_index}:${v.hook_index}`;

  for (let start = 0; start < concepts.length; start += COMPILE_BATCH_SIZE) {
    const batch = concepts.slice(start, start + COMPILE_BATCH_SIZE);
    const wanted: VariantKey[] = batch.flatMap((concept, bi) =>
      concept.hooks
        .slice(0, input.variants_per_concept)
        .map((_, hi) => ({ concept_index: start + bi, hook_index: hi })),
    );
    const label = `image-compiler[${start}-${start + batch.length - 1}]`;
    try {
      const result = await withValidationRetry(CompilerOutputSchema, {
        prompt: loadPrompt("image-compiler", {
          creative_direction: direction.text,
          client_name: client.name,
          niche: client.niche ?? "not specified",
          brand_json: client.brand_json
            ? JSON.stringify(client.brand_json, null, 2)
            : "none — use tasteful neutral direction, no brand constraints",
          concepts_json: JSON.stringify(
            batch.map((c, bi) => ({
              concept_index: start + bi,
              ...c,
              hooks: c.hooks.map((hook, hi) => ({ hook_index: hi, hook })),
            })),
            null,
            2,
          ),
          variants_to_compile: JSON.stringify(wanted),
        }),
        tools: [],
        maxTurns: 8,
        label,
        onValidationError: validationWarner(label),
      });
      cost.add(label, result.costUsd, result.usage);
      const wantedKeys = new Set(wanted.map(keyOf));
      for (const variant of result.data.variants) {
        const key = keyOf(variant);
        if (!wantedKeys.has(key)) {
          warnings.push(`${label}: emitted unrequested variant ${key} — ignored`);
          continue;
        }
        compiled.set(key, variant.prompt);
      }
      for (const v of wanted) {
        if (!compiled.has(keyOf(v))) {
          warnings.push(`${label}: variant ${keyOf(v)} missing from compiler output — skipped`);
        }
      }
    } catch (err) {
      cost.addFromError(label, err);
      warnings.push(
        `${label} failed — ${batch.length} concepts skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  if (compiled.size === 0) {
    throw Object.assign(new Error("Prompt compiler produced no variants — see warnings."), {
      costUsd: cost.total,
    });
  }

  // ── 4. Generation plan + cost cap ───────────────────────────────────────
  type PlannedImage = {
    conceptIndex: number;
    hookIndex: number;
    aspect: AspectRatio;
    prompt: string;
    referenceUrls: string[];
  };
  const plan: PlannedImage[] = [];
  for (const [key, prompt] of compiled) {
    const [ci, hi] = key.split(":").map(Number) as [number, number];
    const concept = concepts[ci]!;
    const referenceUrls = concept.referenced_asset_ids
      .map((id) => assetById.get(id)?.url)
      .filter((u): u is string => !!u);
    if (concept.reference_mode !== "none" && referenceUrls.length === 0) {
      warnings.push(
        `concept ${ci + 1}: no signable URLs for its ${concept.reference_mode} references — generating without references`,
      );
    }
    for (const aspect of input.aspects) {
      plan.push({ conceptIndex: ci, hookIndex: hi, aspect, prompt, referenceUrls });
    }
  }

  const plannedCost = plan.length * provider.costPerImageUsd();
  if (plannedCost > input.max_generation_usd) {
    throw Object.assign(
      new Error(
        `Run would generate ${plan.length} images ≈ $${plannedCost.toFixed(2)}, over the $${input.max_generation_usd.toFixed(2)} cap — lower concept_count/variants_per_concept/aspects or raise max_generation_usd.`,
      ),
      { costUsd: cost.total },
    );
  }

  // ── 5. Generate → Storage ────────────────────────────────────────────────
  console.log(
    `[still_ads] generating ${plan.length} images (≈$${plannedCost.toFixed(2)}, ${GENERATION_CONCURRENCY} in flight)…`,
  );
  let generationCost = 0;
  type GeneratedImage = PlannedImage & { storagePath: string; costUsd: number };
  const generated = await mapWithConcurrency(plan, GENERATION_CONCURRENCY, async (item) => {
    const label = `concept ${item.conceptIndex + 1} / hook ${item.hookIndex + 1} / ${item.aspect}`;
    const result = await provider.generate({
      prompt: item.prompt,
      aspectRatio: item.aspect,
      referenceImageUrls: item.referenceUrls.length > 0 ? item.referenceUrls : undefined,
      label,
    });
    generationCost += result.costUsd;

    const download = await fetch(result.imageUrl);
    if (!download.ok) {
      throw new Error(`${label}: image download failed (${download.status})`);
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    const storagePath = `clients/${clientId}/runs/${runId}/c${item.conceptIndex + 1}-h${item.hookIndex + 1}-${item.aspect.replace(":", "x")}.png`;
    const { error: uploadError } = await supabase.storage
      .from(CREATIVES_BUCKET)
      .upload(storagePath, bytes, { contentType: "image/png", upsert: true });
    if (uploadError) {
      throw new Error(`${label}: storage upload failed: ${uploadError.message}`);
    }
    console.log(`[still_ads] ✓ ${label} → ${storagePath} (${(bytes.length / 1024).toFixed(0)}kB)`);
    return { ...item, storagePath, costUsd: result.costUsd } satisfies GeneratedImage;
  });

  const images: GeneratedImage[] = [];
  for (const [i, outcome] of generated.entries()) {
    if (outcome.status === "fulfilled") {
      images.push(outcome.value);
    } else {
      const item = plan[i]!;
      warnings.push(
        `generation failed for concept ${item.conceptIndex + 1} / hook ${item.hookIndex + 1} / ${item.aspect}: ${
          outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
        }`,
      );
    }
  }
  if (images.length === 0) {
    throw Object.assign(
      new Error(`All ${plan.length} generations failed — see warnings.`),
      { costUsd: cost.total + generationCost },
    );
  }

  // ── 6. Drive delivery (warn-and-skip) ───────────────────────────────────
  const driveConfig = getDriveConfig();
  const driveFiles = new Map<string, { id: string; webViewLink: string | null }>();
  if (!driveConfig) {
    warnings.push("Drive delivery skipped: GOOGLE_DRIVE_* env vars not configured.");
  } else if (!client.drive_folder_id) {
    warnings.push("Drive delivery skipped: client has no drive_folder_id set.");
  } else {
    try {
      const uploader = await createDriveUploader(driveConfig);
      for (const image of images) {
        try {
          const name = image.storagePath.split("/").pop()!;
          const { data: blob, error: downloadError } = await supabase.storage
            .from(CREATIVES_BUCKET)
            .download(image.storagePath);
          if (downloadError || !blob) throw new Error(downloadError?.message ?? "download failed");
          const uploaded = await uploader.upload(
            name,
            "image/png",
            Buffer.from(await blob.arrayBuffer()),
            client.drive_folder_id,
          );
          driveFiles.set(image.storagePath, uploaded);
        } catch (err) {
          warnings.push(
            `Drive upload failed for ${image.storagePath}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } catch (err) {
      warnings.push(`Drive delivery skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 7. creatives rows — one per variant (concept × hook) ────────────────
  const byVariant = new Map<string, GeneratedImage[]>();
  for (const image of images) {
    const key = `${image.conceptIndex}:${image.hookIndex}`;
    const list = byVariant.get(key);
    if (list) list.push(image);
    else byVariant.set(key, [image]);
  }

  const variantEntries = [...byVariant.entries()];
  const rows = variantEntries.map(([key, files]) => {
    const [ci, hi] = key.split(":").map(Number) as [number, number];
    const concept = concepts[ci]!;
    // Primary file = the first requested aspect that succeeded.
    const primary =
      files.find((f) => f.aspect === input.aspects[0]) ?? files[0]!;
    const drive = driveFiles.get(primary.storagePath);
    const aspectFiles: AspectFile[] = files.map((f) => ({
      aspect: f.aspect,
      storage_path: f.storagePath,
    }));
    return {
      client_id: clientId,
      run_id: runId,
      ad_candidate_id: concept.source_candidate_id,
      type: "static" as const,
      avatar: concept.avatar,
      hook: concept.hooks[hi] ?? null,
      framework: concept.format_name,
      prompt_used: primary.prompt,
      model: provider.model,
      storage_path: primary.storagePath,
      aspect_files: aspectFiles,
      concept_json: concept,
      directives_used: direction.versionsUsed,
      file_url: drive?.webViewLink ?? null,
      drive_file_id: drive?.id ?? null,
      status: "draft" as const,
      cost_usd: Number(files.reduce((sum, f) => sum + f.costUsd, 0).toFixed(4)),
    };
  });

  const { data: insertedRows, error: insertError } = await supabase
    .from("creatives")
    .insert(rows)
    .select("id");
  if (insertError) {
    throw Object.assign(
      new Error(`Generated ${images.length} images but failed to write creatives: ${insertError.message}`),
      { costUsd: cost.total + generationCost },
    );
  }

  // ── 8. Asset requests (strictly non-blocking — recorded after every
  // creative already generated with its fallback) ─────────────────────────
  const creativeIdByConcept = new Map<number, string>();
  (insertedRows ?? []).forEach((row, i) => {
    const conceptIndex = Number(variantEntries[i]![0].split(":")[0]);
    if (!creativeIdByConcept.has(conceptIndex)) {
      creativeIdByConcept.set(conceptIndex, row.id as string);
    }
  });

  let assetRequestsInserted = 0;
  const agentRequests = conceptResult.data.asset_requests ?? [];
  if (agentRequests.length > 0) {
    const { data: openRows, error: openError } = await supabase
      .from("asset_requests")
      .select("requested_kind, detail")
      .eq("client_id", clientId)
      .eq("status", "open");
    if (openError) {
      warnings.push(`asset requests skipped — failed to load open requests: ${openError.message}`);
    } else {
      const existing = (openRows ?? []) as { requested_kind: string; detail: string }[];
      const toInsert: {
        client_id: string;
        run_id: string;
        creative_id: string | null;
        requested_kind: string;
        detail: string;
        reason: string;
        priority: string;
      }[] = [];
      for (const request of agentRequests.slice(0, MAX_ASSET_REQUESTS_PER_RUN)) {
        const isDupe = [...existing, ...toInsert].some(
          (e) =>
            e.requested_kind === request.kind &&
            isSimilarRequestDetail(e.detail, request.detail),
        );
        if (isDupe) {
          warnings.push(
            `asset request deduped (similar open request exists): ${request.detail.slice(0, 80)}`,
          );
          continue;
        }
        const filteredIndex =
          request.concept_index !== null
            ? filteredIndexByOriginal.get(request.concept_index)
            : undefined;
        toInsert.push({
          client_id: clientId,
          run_id: runId,
          creative_id:
            filteredIndex !== undefined
              ? (creativeIdByConcept.get(filteredIndex) ?? null)
              : null,
          requested_kind: request.kind,
          detail: request.detail,
          reason: request.reason,
          priority: request.priority,
        });
      }
      if (toInsert.length > 0) {
        const { error: requestError } = await supabase
          .from("asset_requests")
          .insert(toInsert);
        if (requestError) {
          warnings.push(`failed to write asset requests: ${requestError.message}`);
        } else {
          assetRequestsInserted = toInsert.length;
          console.log(`[still_ads] ${toInsert.length} asset request(s) recorded`);
        }
      }
    }
  }

  const totalCost = Number((cost.total + generationCost).toFixed(4));
  console.log(
    `[still_ads] done — ${rows.length} creatives (${images.length} images), agents $${cost.total.toFixed(2)} + generation $${generationCost.toFixed(2)}`,
  );

  return {
    conceptCount: concepts.length,
    creativeCount: insertedRows?.length ?? rows.length,
    imageCount: images.length,
    generationCostUsd: Number(generationCost.toFixed(4)),
    costUsd: totalCost,
    warnings,
    output: {
      creative_count: rows.length,
      image_count: images.length,
      concept_count: concepts.length,
      bbm_version: bbmVersion.version,
      winners_used: winners.length,
      directives_used: direction.versionsUsed,
      asset_requests: assetRequestsInserted,
      aspects: input.aspects,
      generation_cost_usd: Number(generationCost.toFixed(4)),
      agent_cost_usd: Number(cost.total.toFixed(4)),
      warnings,
      usage: cost.usage,
    },
  };
}

export const stillAdsHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = StillAdsInputSchema.parse(run.input_json ?? {});
  if (!run.client_id) throw new Error("still_ads runs require a client_id");
  const result = await runStillAds(run.client_id, input, {
    supabase,
    runId: run.id,
  });

  const { error } = await supabase
    .from("runs")
    .update({
      status: "needs_review",
      output_json: result.output,
      cost_usd: result.costUsd,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) {
    throw new Error(
      `${result.creativeCount} creatives written, but failed to update run: ${error.message}`,
    );
  }
};
