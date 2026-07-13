-- Phase 0: core data model per GODMADE_SYSTEM_BUILD_PLAN.md section 3.

-- ── Enums ────────────────────────────────────────────────────────────────

create type run_type as enum ('buyer_brain', 'creative_selection', 'still_ads', 'video_ads');
create type run_status as enum ('queued', 'running', 'needs_review', 'approved', 'failed');
create type candidate_status as enum ('candidate', 'selected', 'rejected');
create type creative_type as enum ('static', 'carousel', 'ugc', 'hero_arc');
create type creative_model as enum ('nano_banana', 'higgsfield', 'arcads');
create type creative_status as enum ('draft', 'approved', 'rejected');

-- ── clients ──────────────────────────────────────────────────────────────

create table clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  niche           text,
  brief           text,
  website         text,
  drive_folder_id text,
  created_at      timestamptz not null default now()
);

-- ── runs — every pipeline execution ─────────────────────────────────────

create table runs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  type        run_type not null,
  status      run_status not null default 'queued',
  input_json  jsonb,
  output_json jsonb,
  cost_usd    numeric(10, 4),
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);

create index runs_client_id_idx on runs (client_id);
create index runs_status_idx on runs (status);

-- ── bbm_versions — Buyer Brain Matrix, append-only + is_active flag ──────

create table bbm_versions (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients (id) on delete cascade,
  version      integer not null,
  matrix_json  jsonb not null,
  sources_json jsonb,
  created_at   timestamptz not null default now(),
  is_active    boolean not null default false,
  unique (client_id, version)
);

create index bbm_versions_client_id_idx on bbm_versions (client_id);
-- at most one active BBM per client
create unique index bbm_versions_one_active_per_client_idx
  on bbm_versions (client_id) where is_active;

-- ── ad_candidates — output of Step 1.B ──────────────────────────────────

create table ad_candidates (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients (id) on delete cascade,
  bbm_version_id       uuid references bbm_versions (id) on delete set null,
  source               text not null default 'fb_ad_library',
  advertiser           text,
  ad_url               text,
  media_urls           jsonb,
  ad_copy              text,
  run_time_days        integer,
  match_score          integer check (match_score between 0 and 100),
  match_rationale_json jsonb,
  status               candidate_status not null default 'candidate',
  reviewed_by          text,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now()
);

create index ad_candidates_client_id_idx on ad_candidates (client_id);
create index ad_candidates_bbm_version_id_idx on ad_candidates (bbm_version_id);

-- ── creatives — output of Steps 2 & 3 ───────────────────────────────────

create table creatives (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients (id) on delete cascade,
  ad_candidate_id uuid references ad_candidates (id) on delete set null,
  type            creative_type not null,
  prompt_used     text,
  model           creative_model,
  file_url        text,
  drive_file_id   text,
  status          creative_status not null default 'draft',
  feedback        text,
  created_at      timestamptz not null default now()
);

create index creatives_client_id_idx on creatives (client_id);
create index creatives_ad_candidate_id_idx on creatives (ad_candidate_id);

-- ── RLS — single-operator app: any authenticated user has full access. ──
-- The worker uses the service-role key, which bypasses RLS.

alter table clients enable row level security;
alter table runs enable row level security;
alter table bbm_versions enable row level security;
alter table ad_candidates enable row level security;
alter table creatives enable row level security;

create policy "authenticated full access" on clients
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on runs
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on bbm_versions
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on ad_candidates
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on creatives
  for all to authenticated using (true) with check (true);
