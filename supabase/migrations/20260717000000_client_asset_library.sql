-- Phase 2.5: Client Asset Library per GODMADE_SYSTEM_BUILD_PLAN.md section 6.
-- Curated per-client reference material (owner photos, logo, product shots,
-- inspiration ads, …) that the Phase 3/4 generation agents pull from, plus the
-- brand kit on clients.

create type asset_kind as enum (
  'owner_photo',
  'logo',
  'product_shot',
  'lifestyle_photo',
  'example_ad',
  'inspiration_ad',
  'testimonial_screenshot',
  'brand_doc'
);

create table client_assets (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients (id) on delete cascade,
  kind                asset_kind not null,
  -- Uploads live in 'client-assets'; auto-registered inspiration ads point at
  -- the files already mirrored into 'ad-media' instead of duplicating them.
  bucket              text not null default 'client-assets',
  storage_path        text not null,
  drive_file_id       text,
  notes               text,
  tags                text[],
  -- Set on inspiration_ad rows auto-registered from a selected ad_candidate;
  -- the (bucket, storage_path) unique key makes that registration idempotent.
  source_candidate_id uuid references ad_candidates (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (bucket, storage_path)
);

create index client_assets_client_kind_idx on client_assets (client_id, kind);
create index client_assets_source_candidate_id_idx
  on client_assets (source_candidate_id);

-- Brand kit: { colors: hex[], fonts: string[], tone_notes, rules: string[] } —
-- see BrandKitSchema in packages/shared.
alter table clients add column brand_json jsonb;

alter table client_assets enable row level security;
create policy "authenticated full access" on client_assets
  for all to authenticated using (true) with check (true);

-- Private bucket (client-owned material, unlike competitor-public ad-media):
-- reads go through signed URLs.
insert into storage.buckets (id, name, public)
values ('client-assets', 'client-assets', false)
on conflict (id) do nothing;

-- The dashboard uploads/deletes as the signed-in operator (anon key +
-- session); the worker's service-role key bypasses these policies.
create policy "authenticated read client-assets" on storage.objects
  for select to authenticated using (bucket_id = 'client-assets');
create policy "authenticated insert client-assets" on storage.objects
  for insert to authenticated with check (bucket_id = 'client-assets');
create policy "authenticated update client-assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'client-assets') with check (bucket_id = 'client-assets');
create policy "authenticated delete client-assets" on storage.objects
  for delete to authenticated using (bucket_id = 'client-assets');
