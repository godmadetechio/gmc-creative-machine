-- GLOBAL REFERENCE LIBRARY — the agency-wide visual swipe file, the image
-- counterpart to format_library. Agency-curated cross-client style
-- references; per-client selection via client_reference_picks. Client
-- inspiration_ad assets stay in client_assets (competitor winners are
-- client-specific by nature).

create type reference_status as enum ('active', 'archived');

create table reference_library (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  storage_path text not null unique,
  source_url   text,
  -- The what-to-take / what-to-ignore / use-when brief the concept agent
  -- reads when choosing which reference fits which concept.
  notes        text,
  tags         text[] not null default '{}',
  vertical     seed_vertical,
  -- Set when this reference exemplifies a format_library format.
  format_name  text,
  status       reference_status not null default 'active',
  created_at   timestamptz not null default now()
);

create index reference_library_status_idx on reference_library (status);

-- Per-client selection: which global references this client's generation
-- runs pull in, with an optional client-specific note override.
create table client_reference_picks (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  reference_id  uuid not null references reference_library (id) on delete cascade,
  note_override text,
  created_at    timestamptz not null default now(),
  unique (client_id, reference_id)
);

create index client_reference_picks_client_id_idx
  on client_reference_picks (client_id);

alter table reference_library enable row level security;
alter table client_reference_picks enable row level security;
create policy "authenticated full access" on reference_library
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on client_reference_picks
  for all to authenticated using (true) with check (true);

-- Private bucket (like client-assets): reads via signed URLs.
insert into storage.buckets (id, name, public)
values ('reference-library', 'reference-library', false)
on conflict (id) do nothing;

create policy "authenticated read reference-library" on storage.objects
  for select to authenticated using (bucket_id = 'reference-library');
create policy "authenticated insert reference-library" on storage.objects
  for insert to authenticated with check (bucket_id = 'reference-library');
create policy "authenticated update reference-library" on storage.objects
  for update to authenticated
  using (bucket_id = 'reference-library') with check (bucket_id = 'reference-library');
create policy "authenticated delete reference-library" on storage.objects
  for delete to authenticated using (bucket_id = 'reference-library');
