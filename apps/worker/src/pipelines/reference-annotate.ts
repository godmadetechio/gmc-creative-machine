import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FormatLibraryEntrySchema,
  REFERENCE_LIBRARY_BUCKET,
  ReferenceAnnotateInputSchema,
  ReferenceAnnotationSchema,
  ReferenceLibraryEntrySchema,
  SeedVertical,
  type FormatExampleAd,
  type FormatLibraryEntry,
  type ReferenceAnnotateInput,
  type ReferenceAnnotation,
  type ReferenceLibraryEntry,
} from "@gmc/shared";
import { WORKER_MODEL, type AgentUsage } from "../agent";
import { mapWithConcurrency } from "../concurrency";
import { loadPrompt } from "../prompts";
import type { PipelineHandler } from "./index";

// REFERENCE ANNOTATION — a GLOBAL run (runs.client_id null) that drafts
// title/notes/tags/vertical/format for unannotated swipe-file images.
// Annotation is a DRAFT of judgment: rows land as status 'needs_review' /
// annotation_source 'ai', and only human approval promotes them into the
// pool clients pick from. Rows with annotation_source set are never
// touched, so human edits can never be overwritten by re-annotation.
//
// This pipeline talks to the Messages API directly (not the Agent SDK's
// runStructuredQuery) because the image must be passed to the model as a
// content block; structured output is enforced server-side via
// output_config + Zod (client.messages.parse).

const ANNOTATE_CONCURRENCY = 4;
const SIGNED_URL_TTL_SECONDS = 2 * 60 * 60;
const MAX_TOKENS = 4096;
// Example ads kept per format_library entry — same cap as format-scan.
const MAX_EXAMPLES_PER_FORMAT = 8;

// Controlled tag vocabulary seed (training §2 / task spec) — the agent may
// extend it; existing library tags are appended so spellings converge.
// Hand-written JSON schema for output_config (the SDK's zodOutputFormat
// helper needs zod v4; this repo pins zod 3 for zod-to-json-schema). The
// server enforces the shape; ReferenceAnnotationSchema re-checks the
// refinements (lengths, kebab-case) client-side per our Zod+retry rule.
const ANNOTATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short descriptive title" },
    notes: {
      type: "string",
      description: "TAKE / IGNORE / USE WHEN brief, 2-4 sentences",
    },
    tags: { type: "array", items: { type: "string" }, description: "kebab-case traits" },
    vertical: {
      anyOf: [{ type: "string", enum: [...SeedVertical.options] }, { type: "null" }],
    },
    format_name: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Exact format_library name on an exact conceptual match, else null",
    },
  },
  required: ["title", "notes", "tags", "vertical", "format_name"],
  additionalProperties: false,
} as const;

const TAG_VOCABULARY_SEED = [
  "native-look",
  "big-headline",
  "before-after",
  "ugc-style",
  "annotated-photo",
  "meme-format",
  "data-viz",
  "testimonial",
  "text-heavy",
  "minimal",
  "screenshot-style",
  "founder-face",
  "product-hero",
  "comparison-table",
  "handwritten",
];

// Per-MTok pricing for cost tracking (runs.cost_usd convention). Cache
// reads bill at 0.1x input, cache writes at 1.25x (5-min TTL).
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function priceFor(model: string): { input: number; output: number } {
  const exact = PRICE_PER_MTOK[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICE_PER_MTOK).find((k) => model.startsWith(k));
  return prefix ? PRICE_PER_MTOK[prefix]! : PRICE_PER_MTOK["claude-sonnet-5"]!;
}

function usageCostUsd(model: string, usage: Anthropic.Usage): number {
  const price = priceFor(model);
  const input = (usage.input_tokens / 1e6) * price.input;
  const cacheRead = ((usage.cache_read_input_tokens ?? 0) / 1e6) * price.input * 0.1;
  const cacheWrite =
    ((usage.cache_creation_input_tokens ?? 0) / 1e6) * price.input * 1.25;
  const output = (usage.output_tokens / 1e6) * price.output;
  return input + cacheRead + cacheWrite + output;
}

export type ReferenceAnnotateResult = {
  annotated: number;
  skipped: number;
  visualConfirmations: string[];
  costUsd: number;
  warnings: string[];
  output: Record<string, unknown>;
};

type AnnotatedRef = {
  reference: ReferenceLibraryEntry;
  annotation: ReferenceAnnotation;
  /** Resolved against the real library (case-insensitive); null if no match. */
  format: FormatLibraryEntry | null;
  costUsd: number;
};

export async function runReferenceAnnotate(
  input: ReferenceAnnotateInput,
  deps: { supabase: SupabaseClient; runId: string },
): Promise<ReferenceAnnotateResult> {
  const { supabase } = deps;
  const warnings: string[] = [];
  const client = new Anthropic(); // ANTHROPIC_API_KEY from env (same as the agent SDK)

  // ── 1. Unannotated references (never rows a human or prior run touched) ──
  const { data: refRows, error: refError } = await supabase
    .from("reference_library")
    .select("*")
    .is("annotation_source", null)
    .neq("status", "archived")
    .order("created_at", { ascending: true });
  if (refError) throw new Error(`Failed to load references: ${refError.message}`);
  const allUnannotated = (refRows ?? []).map((row) =>
    ReferenceLibraryEntrySchema.parse(row),
  );
  if (allUnannotated.length === 0) {
    return {
      annotated: 0,
      skipped: 0,
      visualConfirmations: [],
      costUsd: 0,
      warnings: ["No unannotated references — nothing to do."],
      output: { annotated: 0, warnings: ["No unannotated references"] },
    };
  }
  const references = allUnannotated.slice(0, input.limit);
  if (allUnannotated.length > references.length) {
    warnings.push(
      `${allUnannotated.length - references.length} unannotated references beyond the ${input.limit}-image limit — run again for the rest.`,
    );
  }

  // ── 2. Format library + tag vocabulary ──────────────────────────────────
  const { data: formatRows, error: formatError } = await supabase
    .from("format_library")
    .select("*")
    .in("status", ["active", "fading"]);
  if (formatError) throw new Error(`Failed to load format_library: ${formatError.message}`);
  const formats = (formatRows ?? []).map((row) => FormatLibraryEntrySchema.parse(row));
  const formatByName = new Map(formats.map((f) => [f.name.trim().toLowerCase(), f]));

  const { data: tagRows } = await supabase
    .from("reference_library")
    .select("tags")
    .not("annotation_source", "is", null);
  const vocabulary = [
    ...new Set([
      ...TAG_VOCABULARY_SEED,
      ...((tagRows ?? []) as { tags: string[] }[]).flatMap((r) => r.tags ?? []),
    ]),
  ].sort();

  // The shared prefix (instructions + format library + vocabulary) is
  // cache_control'd so images 2..N read it at ~0.1x instead of re-paying it.
  const systemPrompt = loadPrompt("reference-annotator", {
    formats_json: JSON.stringify(
      formats.map((f) => ({
        name: f.name,
        description: f.description,
        skeleton: f.skeleton,
        detection: f.detection,
      })),
      null,
      2,
    ),
    tag_vocabulary: vocabulary.join(", "),
    verticals: SeedVertical.options.join(" | "),
  });

  // ── 3. Sign image URLs ───────────────────────────────────────────────────
  const { data: signed, error: signError } = await supabase.storage
    .from(REFERENCE_LIBRARY_BUCKET)
    .createSignedUrls(
      references.map((r) => r.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );
  if (signError) throw new Error(`Failed to sign reference URLs: ${signError.message}`);
  const urlByPath = new Map(
    (signed ?? [])
      .filter((s) => s.path && s.signedUrl)
      .map((s) => [s.path!, s.signedUrl]),
  );

  // ── 4. Vision annotation ─────────────────────────────────────────────────
  let totalCost = 0;
  const totalUsage: AgentUsage = { input_tokens: 0, output_tokens: 0 };

  async function annotateOne(
    reference: ReferenceLibraryEntry,
  ): Promise<AnnotatedRef | null> {
    const url = urlByPath.get(reference.storage_path);
    if (!url) {
      warnings.push(`could not sign URL for "${reference.title}" — skipped`);
      return null;
    }

    const request = (extra?: string) =>
      client.messages.create({
        model: WORKER_MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text" as const,
            text: systemPrompt,
            cache_control: { type: "ephemeral" as const },
          },
        ],
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "image" as const, source: { type: "url" as const, url } },
              {
                type: "text" as const,
                text: `Annotate this reference image.${extra ? `\n\n${extra}` : ""}`,
              },
            ],
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: ANNOTATION_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });

    // One attempt = call + Zod re-check; convention: retry once with the
    // Zod issues appended to the prompt.
    let cost = 0;
    const attempt = async (extra?: string) => {
      const response = await request(extra);
      cost += usageCostUsd(WORKER_MODEL, response.usage);
      trackUsage(response.usage);
      if (response.stop_reason === "refusal") return { refusal: true as const };
      const text = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text",
      )?.text;
      if (!text) return { issues: "response contained no text block" };
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return { issues: "response was not valid JSON" };
      }
      const parsed = ReferenceAnnotationSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          issues: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        };
      }
      return { annotation: parsed.data };
    };

    let outcome = await attempt();
    if ("refusal" in outcome) {
      warnings.push(`annotator refused "${reference.title}" — skipped`);
      return null;
    }
    if ("issues" in outcome) {
      warnings.push(
        `annotation for "${reference.title}" failed validation (attempt 1): ${outcome.issues}`,
      );
      outcome = await attempt(
        `Your previous attempt failed validation: ${outcome.issues}. Fix these and return exactly the requested fields (kebab-case tags, format_name exactly from the library or null).`,
      );
    }
    if ("refusal" in outcome) {
      warnings.push(`annotator refused "${reference.title}" — skipped`);
      return null;
    }
    if ("issues" in outcome) {
      warnings.push(
        `annotation for "${reference.title}" failed validation twice — skipped`,
      );
      return null;
    }

    const annotation = outcome.annotation;
    let format: FormatLibraryEntry | null = null;
    if (annotation.format_name) {
      format = formatByName.get(annotation.format_name.trim().toLowerCase()) ?? null;
      if (!format) {
        warnings.push(
          `annotator linked "${reference.title}" to unknown format "${annotation.format_name}" — link dropped`,
        );
        annotation.format_name = null;
      } else {
        annotation.format_name = format.name; // canonical casing
      }
    }
    return { reference, annotation, format, costUsd: cost };
  }

  function trackUsage(usage: Anthropic.Usage) {
    totalUsage.input_tokens += usage.input_tokens;
    totalUsage.output_tokens += usage.output_tokens;
    totalUsage.cache_read_input_tokens =
      (totalUsage.cache_read_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    totalUsage.cache_creation_input_tokens =
      (totalUsage.cache_creation_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
  }

  console.log(
    `[reference_annotate] annotating ${references.length} references (${formats.length} formats in library, model ${WORKER_MODEL})…`,
  );
  // First image alone so its response writes the shared-prefix cache;
  // the concurrent rest then read it instead of each paying a cold write.
  const results: (AnnotatedRef | null)[] = [];
  const firstOutcome = await mapWithConcurrency(references.slice(0, 1), 1, annotateOne);
  const restOutcomes = await mapWithConcurrency(
    references.slice(1),
    ANNOTATE_CONCURRENCY,
    annotateOne,
  );
  for (const [i, outcome] of [...firstOutcome, ...restOutcomes].entries()) {
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      results.push(null);
      warnings.push(
        `annotation crashed for "${references[i]!.title}": ${
          outcome.reason instanceof Error ? outcome.reason.message : outcome.reason
        }`,
      );
    }
  }
  const annotated = results.filter((r): r is AnnotatedRef => r !== null);
  for (const item of annotated) totalCost += item.costUsd;

  // ── 5. Write annotations (draft-of-judgment: ai + needs_review) ─────────
  let written = 0;
  for (const { reference, annotation } of annotated) {
    const { error: updateError } = await supabase
      .from("reference_library")
      .update({
        title: annotation.title,
        notes: annotation.notes,
        tags: annotation.tags,
        vertical: annotation.vertical,
        format_name: annotation.format_name,
        annotation_source: "ai",
        annotated_at: new Date().toISOString(),
        status: "needs_review",
      })
      .eq("id", reference.id)
      // Guard against a concurrent human edit between load and write —
      // human judgment always wins over the draft.
      .is("annotation_source", null);
    if (updateError) {
      warnings.push(`failed to save annotation for "${reference.title}": ${updateError.message}`);
      continue;
    }
    written += 1;
    console.log(`[reference_annotate] ✓ ${annotation.title}`);
  }

  // ── 6. BONUS: visual confirmations for the format library ───────────────
  // The text-only format scan structurally cannot confirm 'visual' formats;
  // a vision match here is real evidence. Coalesced per format so multiple
  // references confirming the same format merge into one update.
  const confirmationsByFormat = new Map<
    string,
    { format: FormatLibraryEntry; examples: FormatExampleAd[] }
  >();
  for (const { reference, annotation, format } of annotated) {
    if (!format || (format.detection !== "visual" && format.detection !== "both")) {
      continue;
    }
    const entry =
      confirmationsByFormat.get(format.id) ?? { format, examples: [] };
    entry.examples.push({
      advertiser: null,
      // Real source URL when the curator recorded one; otherwise a stable
      // swipe-file pointer (also the dedupe key on repeat annotations).
      ad_url: reference.source_url ?? `swipe-file:${reference.id}`,
      copy_snippet: `[swipe file] ${annotation.title} — ${annotation.notes}`.slice(0, 200),
      vertical: annotation.vertical ?? "other",
      days_running: null,
    });
    confirmationsByFormat.set(format.id, entry);
  }

  const visualConfirmations: string[] = [];
  const now = new Date().toISOString();
  for (const { format, examples } of confirmationsByFormat.values()) {
    const seen = new Set<string>();
    const mergedExamples: FormatExampleAd[] = [];
    for (const example of [...examples, ...format.example_ads]) {
      if (seen.has(example.ad_url)) continue;
      seen.add(example.ad_url);
      mergedExamples.push(example);
      if (mergedExamples.length >= MAX_EXAMPLES_PER_FORMAT) break;
    }
    const verticalsSeen = [
      ...new Set([...format.verticals_seen, ...examples.map((e) => e.vertical)]),
    ];
    const { error: confirmError } = await supabase
      .from("format_library")
      .update({
        status: "active", // a fading format seen in the wild comes back
        scans_missed: 0,
        last_confirmed: now,
        verticals_seen: verticalsSeen,
        example_ads: mergedExamples,
      })
      .eq("id", format.id);
    if (confirmError) {
      warnings.push(`failed to visually confirm format "${format.name}": ${confirmError.message}`);
      continue;
    }
    visualConfirmations.push(format.name);
    console.log(`[reference_annotate] visual confirmation: ${format.name}`);
  }

  const costUsd = Number(totalCost.toFixed(4));
  console.log(
    `[reference_annotate] done — ${written}/${references.length} annotated, ${visualConfirmations.length} visual format confirmations, $${costUsd}`,
  );

  return {
    annotated: written,
    skipped: references.length - written,
    visualConfirmations,
    costUsd,
    warnings,
    output: {
      annotated: written,
      skipped: references.length - written,
      remaining_unannotated: allUnannotated.length - references.length,
      visual_confirmations: visualConfirmations,
      cost_per_image_usd:
        written > 0 ? Number((totalCost / written).toFixed(4)) : null,
      model: WORKER_MODEL,
      usage: totalUsage,
      warnings,
    },
  };
}

export const referenceAnnotateHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = ReferenceAnnotateInputSchema.parse(run.input_json ?? {});
  const result = await runReferenceAnnotate(input, { supabase, runId: run.id });

  const { error } = await supabase
    .from("runs")
    .update({
      // Annotations pend human review in the Swipe File.
      status: "needs_review",
      output_json: result.output,
      cost_usd: result.costUsd,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) {
    throw new Error(
      `${result.annotated} annotations written, but failed to update run: ${error.message}`,
    );
  }
};
