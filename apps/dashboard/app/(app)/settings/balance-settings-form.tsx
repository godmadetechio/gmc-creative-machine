"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBalanceSettings, type BalanceSettingsState } from "./actions";

// One row per provider: alert threshold, plus the manual "balance as of
// now" field for providers without a balance API (fal).

export function BalanceSettingsForm({
  provider,
  label,
  initialThresholdUsd,
  includeManualBalance,
  initialManualBalanceUsd,
  manualBalanceAtLabel,
}: {
  provider: string;
  label: string;
  initialThresholdUsd: number | null;
  includeManualBalance: boolean;
  initialManualBalanceUsd: number | null;
  manualBalanceAtLabel: string | null;
}) {
  const [state, formAction, pending] = useActionState<BalanceSettingsState, FormData>(
    saveBalanceSettings,
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 py-3">
      <input type="hidden" name="provider" value={provider} />
      <div className="w-28">
        <p className="text-sm font-medium">{label}</p>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Alert below (USD)</span>
        <Input
          name="threshold_usd"
          type="number"
          step="0.01"
          min="0"
          defaultValue={initialThresholdUsd ?? ""}
          placeholder="none"
          className="h-9 w-32"
        />
      </label>
      {includeManualBalance && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Balance as of now (USD)
            {manualBalanceAtLabel && ` — last set ${manualBalanceAtLabel}`}
          </span>
          <Input
            name="manual_balance_usd"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initialManualBalanceUsd ?? ""}
            placeholder="not set"
            className="h-9 w-40"
          />
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {state?.status === "success" && !pending ? <Check /> : null}
        {pending ? "Saving…" : "Save"}
      </Button>
      {state?.status === "error" && (
        <p className="text-destructive text-xs">{state.message}</p>
      )}
    </form>
  );
}
