"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BALANCE_PROVIDERS } from "@gmc/shared";
import { createClient } from "@/lib/supabase/server";

export type BalanceSettingsState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const ProviderSchema = z.enum(BALANCE_PROVIDERS);

// "" clears the value; absent field (form doesn't render it) leaves it alone.
function parseUsdField(
  value: FormDataEntryValue | null,
): number | null | undefined | "invalid" {
  if (value === null) return undefined;
  const text = String(value).trim();
  if (text === "") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return "invalid";
  return parsed;
}

export async function saveBalanceSettings(
  _prevState: BalanceSettingsState,
  formData: FormData,
): Promise<BalanceSettingsState> {
  const provider = ProviderSchema.safeParse(formData.get("provider"));
  if (!provider.success) {
    return { status: "error", message: "Invalid provider" };
  }
  const threshold = parseUsdField(formData.get("threshold_usd"));
  const manual = parseUsdField(formData.get("manual_balance_usd"));
  if (threshold === "invalid" || manual === "invalid") {
    return { status: "error", message: "Amounts must be non-negative numbers" };
  }

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    provider: provider.data,
    updated_at: now,
  };
  if (threshold !== undefined) row.low_balance_threshold_usd = threshold;
  if (manual !== undefined) {
    row.manual_balance_usd = manual;
    // "Balance as of now" — the estimate subtracts metered spend from here.
    row.manual_balance_at = manual !== null ? now : null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("provider_balances").upsert(row);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/usage");
  return { status: "success" };
}
