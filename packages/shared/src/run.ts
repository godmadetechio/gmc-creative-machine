import { z } from "zod";
import { RunStatus, RunType } from "./enums";

export const RunSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  type: RunType,
  status: RunStatus,
  input_json: z.unknown().nullable(),
  output_json: z.unknown().nullable(),
  cost_usd: z.number().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
});
export type Run = z.infer<typeof RunSchema>;
