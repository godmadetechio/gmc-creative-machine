-- USAGE & BALANCES: external provider balance snapshots (best-effort).
-- The worker refreshes rows hourly via the service role (bypasses RLS);
-- the dashboard reads them for the Usage page + low-balance banner and
-- writes the operator-maintained fields (manual balance for providers
-- without a balance API, alert thresholds from Settings) — hence the full
-- authenticated policy rather than worker_heartbeats' read-only one.
create table provider_balances (
  -- 'anthropic' | 'apify' | 'fal'
  provider                  text primary key,
  -- Provider-reported remaining credit, when the API exposes one.
  balance_usd               numeric,
  -- Provider-reported month-to-date spend, when the API exposes it.
  usage_month_usd           numeric,
  -- 'api' (live provider endpoint) | 'internal_metering' (runs.cost_usd sums)
  source                    text not null default 'api',
  -- Human-readable caveat, e.g. "admin key not set — internal metering".
  note                      text,
  -- Raw provider payload for debugging adapter drift.
  detail_json               jsonb,
  -- Last refresh error, cleared on success. Alerts NEVER block runs.
  error                     text,
  fetched_at                timestamptz,
  -- Operator-entered "balance as of <date>" for providers with no API (fal):
  -- shown with estimated remaining = manual balance - metered spend since.
  manual_balance_usd        numeric,
  manual_balance_at         timestamptz,
  -- Below this → dashboard banner + Usage-page flag. Null = no alert.
  low_balance_threshold_usd numeric,
  updated_at                timestamptz not null default now()
);

alter table provider_balances enable row level security;

create policy "authenticated full access" on provider_balances
  for all to authenticated using (true) with check (true);
