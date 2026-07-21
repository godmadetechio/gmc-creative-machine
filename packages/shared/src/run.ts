import { z } from "zod";
import { RunStatus, RunType } from "./enums";

export const RunSchema = z.object({
  id: z.string().uuid(),
  // Null for global (cross-client) runs, e.g. format_scan.
  client_id: z.string().uuid().nullable(),
  type: RunType,
  status: RunStatus,
  // Live pipeline stage slug, written additively mid-run by the worker.
  // optional() keeps parsing deploy-order-proof (rows read before the
  // migration applies simply lack the column).
  stage: z.string().nullable().optional(),
  input_json: z.unknown().nullable(),
  output_json: z.unknown().nullable(),
  cost_usd: z.number().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
});
export type Run = z.infer<typeof RunSchema>;
