-- ASSET REQUESTS — agents may request client resources during creation,
-- strictly NON-BLOCKING: the creative is always fully generated with the
-- best available fallback; a request only records what would make it
-- better. Humans fulfill (upload) or dismiss in the dashboard.

create type asset_request_priority as enum ('nice_to_have', 'high_impact');
create type asset_request_status as enum ('open', 'fulfilled', 'dismissed');

create table asset_requests (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete cascade,
  run_id         uuid references runs (id) on delete set null,
  -- The creative that was generated with a fallback because this asset
  -- was missing (first variant of the requesting concept).
  creative_id    uuid references creatives (id) on delete set null,
  requested_kind asset_kind not null,
  -- Free-text specifics ("Ben holding a kettlebell, gym setting, phone-shot").
  detail         text not null,
  -- Why this improves the concept, 1-2 lines.
  reason         text not null,
  priority       asset_request_priority not null default 'nice_to_have',
  status         asset_request_status not null default 'open',
  fulfilled_asset_id uuid references client_assets (id) on delete set null,
  -- Auto-close assist: a manual upload of the requested kind flags the
  -- request for one-click confirm (status stays 'open' until confirmed).
  possibly_fulfilled_asset_id uuid references client_assets (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index asset_requests_client_status_idx on asset_requests (client_id, status);
create index asset_requests_creative_id_idx on asset_requests (creative_id);

-- Cheap single-image regeneration once a requested asset arrives.
alter type run_type add value if not exists 'creative_regen';

alter table asset_requests enable row level security;
create policy "authenticated full access" on asset_requests
  for all to authenticated using (true) with check (true);
