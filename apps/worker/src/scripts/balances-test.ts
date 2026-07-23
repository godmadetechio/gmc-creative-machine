import "../env";
import {
  AnthropicCostReportSchema,
  ApifyLimitsSchema,
  fetchAnthropicCost,
  fetchApifyBalance,
  getAnthropicAdminKey,
} from "../balances";
import { getApifyToken } from "../apify";

// Live-endpoint schema check for the balance adapters (house rule: verify
// the REAL endpoint before trusting an integration). One real call per
// configured provider, raw payload printed, then validated against the
// exact Zod schema the adapter relies on. Exits non-zero if a configured
// provider's payload shape has drifted.
//
//   pnpm balances:test
//
// fal.ai has no balance/billing endpoint to check — it is internal-metered
// by design (manual balance lives in dashboard Settings).

let failed = false;

async function checkApify() {
  const token = getApifyToken();
  if (!token) {
    console.log("[balances:test] apify: APIFY_TOKEN not set — skipped");
    return;
  }
  console.log("[balances:test] apify: GET /v2/users/me/limits …");
  const res = await fetch("https://api.apify.com/v2/users/me/limits", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const raw: unknown = await res.json();
  console.log(`[balances:test] apify raw (${res.status}):`);
  console.log(JSON.stringify(raw, null, 2));
  const check = ApifyLimitsSchema.safeParse(raw);
  if (!res.ok || !check.success) {
    failed = true;
    console.error("[balances:test] ❌ apify payload failed the adapter schema:");
    if (!check.success) {
      for (const issue of check.error.issues) {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
    }
    return;
  }
  const snapshot = await fetchApifyBalance(token);
  console.log(
    `[balances:test] ✅ apify: $${snapshot.usageMonthUsd} used this month, $${snapshot.balanceUsd} allowance remaining`,
  );
}

async function checkAnthropic() {
  const adminKey = getAnthropicAdminKey();
  if (!adminKey) {
    console.log(
      "[balances:test] anthropic: ANTHROPIC_ADMIN_KEY not set — skipped (worker falls back to internal metering)",
    );
    return;
  }
  console.log("[balances:test] anthropic: GET /v1/organizations/cost_report …");
  const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
  url.searchParams.set(
    "starting_at",
    new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString(),
  );
  url.searchParams.set("limit", "31");
  const res = await fetch(url, {
    headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01" },
  });
  const raw: unknown = await res.json();
  console.log(`[balances:test] anthropic raw (${res.status}):`);
  console.log(JSON.stringify(raw, null, 2));
  const check = AnthropicCostReportSchema.safeParse(raw);
  if (!res.ok || !check.success) {
    failed = true;
    console.error("[balances:test] ❌ anthropic payload failed the adapter schema:");
    if (!check.success) {
      for (const issue of check.error.issues) {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
    }
    return;
  }
  const snapshot = await fetchAnthropicCost(adminKey);
  console.log(
    `[balances:test] ✅ anthropic: $${snapshot.usageMonthUsd} org cost month-to-date`,
  );
}

async function main() {
  await checkApify();
  await checkAnthropic();
  if (failed) {
    console.error(
      "[balances:test] one or more adapters no longer match the live payload — fix apps/worker/src/balances.ts before relying on the Usage page balances.",
    );
    process.exit(1);
  }
  console.log("[balances:test] done");
}

main().catch((err) => {
  console.error("[balances:test] failed:", err);
  process.exit(1);
});
