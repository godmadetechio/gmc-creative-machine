-- Phase 2 addition: competitor research as a first-class asset. Populated by
-- the competitor-scout agent (step 0 of creative selection), by hand from the
-- dashboard, or by future BBM research. Ignored competitors are never searched.

create type competitor_source as enum ('agent', 'manual', 'bbm_research');
create type competitor_status as enum ('active', 'ignored');

create table competitors (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients (id) on delete cascade,
  name              text not null,
  fb_page_url       text,
  ig_handle         text,
  website           text,
  positioning_notes text,
  source            competitor_source not null default 'agent',
  status            competitor_status not null default 'active',
  created_at        timestamptz not null default now()
);

create index competitors_client_id_idx on competitors (client_id);
create unique index competitors_client_name_idx
  on competitors (client_id, lower(name));

alter table competitors enable row level security;

create policy "authenticated full access" on competitors
  for all to authenticated using (true) with check (true);
