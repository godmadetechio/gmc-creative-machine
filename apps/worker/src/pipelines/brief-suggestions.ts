import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BriefSuggesterOutputSchema,
  ClientSchema,
  CreativeDirectiveSchema,
} from "@gmc/shared";
import { withValidationRetry } from "../agent";
import { CostTracker } from "../cost";
import { getCreativeDirection } from "../creative-direction";
import { loadPrompt } from "../prompts";
import type { PipelineHandler } from "./index";

// BRIEF SUGGESTIONS — reads all rejection feedback since the client
// brief's last version and proposes specific amendments to specific
// sections. Suggestions land as pending rows the operator accepts or
// dismisses in the dashboard — nothing auto-applies.

const MAX_SUGGESTIONS = 6;
const MAX_FEEDBACK_LINES = 60;
const DEFAULT_VERTICAL = "coaching" as const;

export type BriefSuggestionsResult = {
  suggestionCount: number;
  costUsd: number;
  warnings: string[];
  output: Record<string, unknown>;
};

// Quote verification: verbatim within whitespace-normalization — the agent
// copies quotes from prompt text where newlines may have shifted.
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function runBriefSuggestions(
  clientId: string,
  deps: { supabase: SupabaseClient; runId: string },
): Promise<BriefSuggestionsResult> {
  const { supabase, runId } = deps;
  const cost = new CostTracker();
  const warnings: string[] = [];

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new Error(`Failed to load client: ${clientError.message}`);
  if (!clientRow) throw new Error(`Client ${clientId} not found`);
  const client = ClientSchema.parse(clientRow);

  // Active client brief (may not exist yet — then ALL feedback is fair game
  // and amendments seed the first client brief).
  const { data: briefRows, error: briefError } = await supabase
    .from("creative_directives")
    .select("*")
    .eq("scope", "client")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .limit(1);
  if (briefError) throw new Error(`Failed to load client brief: ${briefError.message}`);
  const clientBrief = briefRows?.[0]
    ? CreativeDirectiveSchema.parse(briefRows[0])
    : null;

  let feedbackQuery = supabase
    .from("creatives")
    .select("avatar, framework, feedback, created_at")
    .eq("client_id", clientId)
    .eq("status", "rejected")
    .not("feedback", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_FEEDBACK_LINES);
  if (clientBrief) {
    feedbackQuery = feedbackQuery.gt("created_at", clientBrief.created_at);
  }
  const { data: feedbackRows, error: feedbackError } = await feedbackQuery;
  if (feedbackError) throw new Error(`Failed to load feedback: ${feedbackError.message}`);
  const feedback = (feedbackRows ?? []).filter((r) => r.feedback);

  if (feedback.length === 0) {
    return {
      suggestionCount: 0,
      costUsd: 0,
      warnings: [
        clientBrief
          ? `No rejection feedback since client brief v${clientBrief.version} — nothing to suggest.`
          : "No rejection feedback yet — nothing to suggest.",
      ],
      output: { suggestion_count: 0, feedback_lines: 0 },
    };
  }

  const direction = await getCreativeDirection(
    supabase,
    clientId,
    client.vertical ?? DEFAULT_VERTICAL,
  );
  warnings.push(...direction.warnings);

  const feedbackLines = feedback
    .map(
      (row) =>
        `- [${[row.framework, row.avatar].filter(Boolean).join(" / ") || "creative"}] ${row.feedback}`,
    )
    .join("\n");

  console.log(
    `[brief_suggestions] ${client.name}: analyzing ${feedback.length} rejection(s) since ${
      clientBrief ? `client brief v${clientBrief.version}` : "the beginning"
    }…`,
  );
  const result = await withValidationRetry(BriefSuggesterOutputSchema, {
    prompt: loadPrompt("brief-suggester", {
      client_name: client.name,
      niche: client.niche ?? "not specified",
      creative_direction: direction.text,
      client_sections_json: clientBrief
        ? JSON.stringify(clientBrief.sections, null, 2)
        : "none yet — the client has no brief; accepted amendments will create v1",
      feedback_lines: feedbackLines,
      max_suggestions: MAX_SUGGESTIONS,
    }),
    tools: [], // pure synthesis over the provided feedback
    maxTurns: 8,
    label: "brief-suggester",
    onValidationError: (issues, attempt) =>
      warnings.push(
        `brief-suggester output failed validation (attempt ${attempt}): ${
          issues.length > 300 ? `${issues.slice(0, 300)}…` : issues
        }`,
      ),
  });
  cost.add("brief-suggester", result.costUsd, result.usage);

  // Verify quotes against the real feedback rows — an invented quote
  // invalidates the suggestion (the whole point is evidence-backed briefs).
  const normalizedFeedback = feedback.map((r) => normalize(r.feedback as string));
  const verified = result.data.suggestions.filter((suggestion) => {
    const bad = suggestion.feedback_quotes.find(
      (quote) => !normalizedFeedback.some((f) => f.includes(normalize(quote))),
    );
    if (bad) {
      warnings.push(
        `suggestion for ${suggestion.section} dropped — quote not found in feedback: "${bad.slice(0, 80)}"`,
      );
      return false;
    }
    return true;
  });

  // A fresh run supersedes suggestions nobody acted on.
  const { error: clearError } = await supabase
    .from("brief_suggestions")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "pending");
  if (clearError) {
    warnings.push(`failed to clear stale pending suggestions: ${clearError.message}`);
  }

  let inserted = 0;
  if (verified.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from("brief_suggestions")
      .insert(
        verified.map((s) => ({
          client_id: clientId,
          run_id: runId,
          section: s.section,
          kind: s.kind,
          proposal: { text: s.proposal },
          rationale: s.rationale,
          feedback_quotes: s.feedback_quotes,
        })),
      )
      .select("id");
    if (insertError) {
      throw Object.assign(
        new Error(`Failed to write suggestions: ${insertError.message}`),
        { costUsd: cost.total },
      );
    }
    inserted = insertedRows?.length ?? 0;
  }

  console.log(
    `[brief_suggestions] done — ${inserted} suggestion(s) from ${feedback.length} rejection(s), $${cost.total.toFixed(2)}`,
  );
  return {
    suggestionCount: inserted,
    costUsd: Number(cost.total.toFixed(4)),
    warnings,
    output: {
      suggestion_count: inserted,
      proposed: result.data.suggestions.length,
      dropped_unverified: result.data.suggestions.length - verified.length,
      feedback_lines: feedback.length,
      since_brief_version: clientBrief?.version ?? null,
      warnings,
      usage: cost.usage,
    },
  };
}

export const briefSuggestionsHandler: PipelineHandler = async ({ supabase, run }) => {
  if (!run.client_id) throw new Error("brief_suggestions runs require a client_id");
  const result = await runBriefSuggestions(run.client_id, {
    supabase,
    runId: run.id,
  });

  const { error } = await supabase
    .from("runs")
    .update({
      // Suggestions pend accept/dismiss on the client brief page; a run
      // with nothing to suggest is simply done.
      status: result.suggestionCount > 0 ? "needs_review" : "approved",
      output_json: result.output,
      cost_usd: result.costUsd,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) {
    throw new Error(
      `${result.suggestionCount} suggestions written, but failed to update run: ${error.message}`,
    );
  }
};
