import { query } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const WORKER_MODEL = process.env.WORKER_MODEL ?? "claude-sonnet-5";

export type AgentUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type AgentQueryResult<T> = {
  data: T;
  costUsd: number;
  usage: AgentUsage;
};

export class AgentValidationError extends Error {
  constructor(public issues: string) {
    super(`Agent output failed schema validation:\n${issues}`);
  }
}

type RunQueryOptions = {
  prompt: string;
  /** Built-in tools the agent may use; [] for a pure-reasoning pass. */
  tools: string[];
  maxTurns: number;
  label: string;
};

// One agentic query() → Zod-validated JSON. The JSON schema is enforced by
// the SDK (outputFormat) and re-checked with Zod so downstream code gets
// real types + our refinements (url format, 1-5 ranges, min lengths).
export async function runStructuredQuery<S extends z.ZodTypeAny>(
  schema: S,
  { prompt, tools, maxTurns, label }: RunQueryOptions,
): Promise<AgentQueryResult<z.infer<S>>> {
  let result;
  for await (const message of query({
    prompt,
    options: {
      model: WORKER_MODEL,
      tools,
      allowedTools: tools,
      maxTurns,
      outputFormat: {
        type: "json_schema",
        schema: zodToJsonSchema(schema) as Record<string, unknown>,
      },
    },
  })) {
    if (message.type === "result") result = message;
  }

  if (!result) {
    throw new Error(`[${label}] query ended without a result message`);
  }
  const costUsd = result.total_cost_usd ?? 0;
  const usage = result.usage as AgentUsage;

  if (result.subtype !== "success") {
    throw Object.assign(
      new Error(
        `[${label}] agent run failed (${result.subtype}): ${
          "errors" in result ? result.errors.join("; ") : "unknown"
        }`,
      ),
      { costUsd, usage },
    );
  }

  const raw =
    result.structured_output !== undefined
      ? result.structured_output
      : JSON.parse(result.result);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw Object.assign(
      new AgentValidationError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      ),
      { costUsd, usage },
    );
  }

  return { data: parsed.data, costUsd, usage };
}

// Convention (CLAUDE.md): on validation failure, retry once with the Zod
// errors appended to the prompt. Cost of the failed attempt still counts.
export async function withValidationRetry<S extends z.ZodTypeAny>(
  schema: S,
  options: RunQueryOptions,
): Promise<AgentQueryResult<z.infer<S>>> {
  try {
    return await runStructuredQuery(schema, options);
  } catch (err) {
    if (!(err instanceof AgentValidationError)) throw err;
    const wastedCost = (err as unknown as { costUsd?: number }).costUsd ?? 0;
    console.warn(
      `[${options.label}] output failed validation, retrying once with errors in prompt`,
    );
    const retry = await runStructuredQuery(schema, {
      ...options,
      prompt: `${options.prompt}\n\nYour previous attempt produced JSON that failed schema validation with these errors — fix them:\n${err.issues}`,
    });
    return { ...retry, costUsd: retry.costUsd + wastedCost };
  }
}
