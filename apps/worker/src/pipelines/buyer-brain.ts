import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BBMSchema,
  BuyerBrainInputSchema,
  ClientSchema,
  MinerOutputSchema,
  type BBM,
  type BuyerBrainInput,
  type Finding,
} from "@gmc/shared";
import { withValidationRetry, type AgentUsage } from "../agent";
import { loadPrompt } from "../prompts";
import type { PipelineHandler } from "./index";

const MINERS = ["forum-miner", "reddit-miner", "news-miner", "youtube-miner"] as const;
type MinerName = (typeof MINERS)[number];

// depth 'quick' exists so prompt iteration doesn't cost 30 minutes per test.
const DEPTH_CONFIG = {
  quick: { maxSearches: "3", minFindings: 5, maxTurns: 12 },
  full: { maxSearches: "12-15", minFindings: 20, maxTurns: 40 },
} as const;

export type BuyerBrainResult = {
  bbmVersionId: string;
  version: number;
  costUsd: number;
  findingCounts: Record<MinerName, number>;
  warnings: string[];
  usage: Partial<Record<string, AgentUsage>>;
};

// Accumulates cost across every agent attempt, including failed ones, so
// runs.cost_usd reflects what the run actually spent.
class CostTracker {
  total = 0;
  usage: Partial<Record<string, AgentUsage>> = {};

  add(label: string, costUsd: number, usage?: AgentUsage) {
    this.total += costUsd;
    if (usage) this.usage[label] = usage;
  }

  addFromError(label: string, err: unknown) {
    const cost = (err as { costUsd?: number })?.costUsd;
    if (typeof cost === "number") this.total += cost;
    const usage = (err as { usage?: AgentUsage })?.usage;
    if (usage) this.usage[label] = usage;
  }
}

export async function runBuyerBrain(
  clientId: string,
  input: BuyerBrainInput,
  deps: { supabase: SupabaseClient },
): Promise<BuyerBrainResult> {
  const { supabase } = deps;
  const depth = DEPTH_CONFIG[input.depth];
  const cost = new CostTracker();

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new Error(`Failed to load client: ${clientError.message}`);
  if (!clientRow) throw new Error(`Client ${clientId} not found`);
  const client = ClientSchema.parse(clientRow);

  const { data: prevRows, error: prevError } = await supabase
    .from("bbm_versions")
    .select("version, matrix_json")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1);
  if (prevError) throw new Error(`Failed to load previous BBM: ${prevError.message}`);
  const previous = prevRows?.[0] ?? null;
  const nextVersion = (previous?.version ?? 0) + 1;

  const minerVars = {
    client_name: client.name,
    niche: client.niche ?? "not specified",
    brief: client.brief ?? "not specified",
    operator_prompt: input.operator_prompt || "none",
    max_searches: depth.maxSearches,
    min_findings: depth.minFindings,
  };

  // ── 1. Four miners in parallel ─────────────────────────────────────────
  console.log(`[buyer_brain] mining (depth=${input.depth}, model per WORKER_MODEL)…`);
  const settled = await Promise.allSettled(
    MINERS.map((name) =>
      withValidationRetry(MinerOutputSchema, {
        prompt: loadPrompt(name, minerVars),
        tools: ["WebSearch", "WebFetch"],
        maxTurns: depth.maxTurns,
        label: name,
      }),
    ),
  );

  const warnings: string[] = [];
  const findingCounts = {} as Record<MinerName, number>;
  const findingsByMiner: Partial<Record<MinerName, Finding[]>> = {};

  for (const [i, name] of MINERS.entries()) {
    const outcome = settled[i];
    if (!outcome) continue;
    if (outcome.status === "fulfilled") {
      cost.add(name, outcome.value.costUsd, outcome.value.usage);
      findingsByMiner[name] = outcome.value.data.findings;
      findingCounts[name] = outcome.value.data.findings.length;
      console.log(`[buyer_brain] ${name}: ${findingCounts[name]} findings`);
      if (findingCounts[name] === 0) {
        warnings.push(
          `${name} returned 0 findings — check its prompt or source access`,
        );
        console.warn(`[buyer_brain] ${name} returned 0 findings`);
      }
    } else {
      cost.addFromError(name, outcome.reason);
      findingCounts[name] = 0;
      warnings.push(`${name} failed: ${outcome.reason?.message ?? outcome.reason}`);
      console.warn(`[buyer_brain] ${name} failed:`, outcome.reason?.message);
    }
  }

  const succeeded = Object.keys(findingsByMiner).length;
  const allFindings = Object.values(findingsByMiner).flat();
  if (succeeded < 2 || allFindings.length === 0) {
    throw Object.assign(
      new Error(
        `Only ${succeeded}/4 miners succeeded (${allFindings.length} findings) — aborting. ${warnings.join(" | ")}`,
      ),
      { costUsd: cost.total },
    );
  }

  // ── 2. Composer ────────────────────────────────────────────────────────
  console.log(`[buyer_brain] composing BBM v${nextVersion} from ${allFindings.length} findings…`);
  let bbm: BBM;
  try {
    const composed = await withValidationRetry(BBMSchema, {
      prompt: loadPrompt("composer", {
        client_name: client.name,
        niche: client.niche ?? "not specified",
        brief: client.brief ?? "not specified",
        operator_prompt: input.operator_prompt || "none",
        next_version: nextVersion,
        generated_at: new Date().toISOString(),
        findings_json: JSON.stringify(findingsByMiner, null, 2),
        previous_bbm_json: previous
          ? JSON.stringify(previous.matrix_json, null, 2)
          : "none — this is version 1",
      }),
      tools: [], // pure synthesis, no web access
      maxTurns: 8,
      label: "composer",
    });
    cost.add("composer", composed.costUsd, composed.usage);
    bbm = composed.data;
  } catch (err) {
    cost.addFromError("composer", err);
    throw Object.assign(
      err instanceof Error ? err : new Error(String(err)),
      { costUsd: cost.total },
    );
  }

  // Server-owned fields win over whatever the model wrote.
  bbm.client = client.name;
  bbm.niche = client.niche ?? bbm.niche;
  bbm.version = nextVersion;
  bbm.generated_at = new Date().toISOString();

  // ── 3. Versioned write (one active BBM per client) ─────────────────────
  const { error: deactivateError } = await supabase
    .from("bbm_versions")
    .update({ is_active: false })
    .eq("client_id", clientId)
    .eq("is_active", true);
  if (deactivateError) {
    throw Object.assign(
      new Error(`Failed to deactivate previous BBM: ${deactivateError.message}`),
      { costUsd: cost.total },
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("bbm_versions")
    .insert({
      client_id: clientId,
      version: nextVersion,
      matrix_json: bbm,
      sources_json: findingsByMiner,
      is_active: true,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw Object.assign(
      new Error(`Failed to write bbm_versions: ${insertError?.message}`),
      { costUsd: cost.total },
    );
  }

  return {
    bbmVersionId: inserted.id,
    version: nextVersion,
    costUsd: Number(cost.total.toFixed(4)),
    findingCounts,
    warnings,
    usage: cost.usage,
  };
}

export const buyerBrainHandler: PipelineHandler = async ({ supabase, run }) => {
  const input = BuyerBrainInputSchema.parse(run.input_json ?? {});
  const result = await runBuyerBrain(run.client_id, input, { supabase });

  const { error } = await supabase
    .from("runs")
    .update({
      status: "needs_review",
      output_json: {
        bbm_version_id: result.bbmVersionId,
        bbm_version: result.version,
        finding_counts: result.findingCounts,
        warnings: result.warnings,
        usage: result.usage,
      },
      cost_usd: result.costUsd,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) throw new Error(`BBM v${result.version} written, but failed to update run: ${error.message}`);

  console.log(
    `[buyer_brain] done — BBM v${result.version} (${result.bbmVersionId}), cost $${result.costUsd}`,
  );
};
