-- Phase 3: Still Ad Creation — see GODMADE_SYSTEM_BUILD_PLAN.md section 6
-- and AI_ADS_TRAINING_INTEGRATION.md section 2.

-- ── creatives: generation metadata ───────────────────────────────────────
-- Existing columns already cover type/avatar/prompt_used/model/file_url/
-- drive_file_id/status/feedback/ad_candidate_id. Phase 3 adds the hook-first
-- and format dimensions plus storage + cost bookkeeping.

alter table creatives
  -- Which run produced the creative — review queues show one batch at a time.
  add column run_id        uuid references runs (id) on delete set null,
  -- The hook this variant renders (hooks are first-class per training §2b —
  -- winners get remixed by the Phase 5.5 iteration engine).
  add column hook          text,
  -- Format/framework name from the format library (or a winner's skeleton).
  add column framework     text,
  -- Path inside the private 'creatives' bucket; file_url stays for the
  -- public/Drive link once Drive delivery is configured.
  add column storage_path  text,
  -- [{ aspect: '4:5', storage_path: '…' }] — one review row per variant even
  -- when extra aspects are rendered (Phase 5.5 renders more for winners).
  add column aspect_files  jsonb,
  -- Full validated concept (headline/subhead/visual/cta/angle_ref/hooks/
  -- reference mode) — the Winning Creative Doc and iteration briefs read it.
  add column concept_json  jsonb,
  -- Per-image generation spend; rolls up into runs.cost_usd.
  add column cost_usd      numeric(10, 4);

create index creatives_run_id_idx on creatives (run_id);
create index creatives_client_status_idx on creatives (client_id, status);

-- ── winning_creatives — the per-client Winning Creative Doc ─────────────
-- Approving a creative appends here; future concept runs (and the Phase 5.5
-- iteration engine) read it as "what worked for this client".

create table winning_creatives (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients (id) on delete cascade,
  creative_id     uuid not null references creatives (id) on delete cascade,
  concept_summary text not null,
  why_approved    text,
  created_at      timestamptz not null default now(),
  unique (creative_id)
);

create index winning_creatives_client_id_idx on winning_creatives (client_id);

alter table winning_creatives enable row level security;
create policy "authenticated full access" on winning_creatives
  for all to authenticated using (true) with check (true);

-- ── Storage: private 'creatives' bucket (signed-URL reads) ───────────────
-- Generated ads are client work product — private like client-assets, unlike
-- the competitor-public ad-media bucket.

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', false)
on conflict (id) do nothing;

-- The worker writes with the service-role key (bypasses these); the
-- dashboard reads via signed URLs created by the signed-in operator.
create policy "authenticated read creatives" on storage.objects
  for select to authenticated using (bucket_id = 'creatives');
create policy "authenticated insert creatives" on storage.objects
  for insert to authenticated with check (bucket_id = 'creatives');
create policy "authenticated update creatives" on storage.objects
  for update to authenticated
  using (bucket_id = 'creatives') with check (bucket_id = 'creatives');
create policy "authenticated delete creatives" on storage.objects
  for delete to authenticated using (bucket_id = 'creatives');
