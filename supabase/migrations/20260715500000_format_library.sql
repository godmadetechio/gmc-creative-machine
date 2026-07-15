-- FORMAT LIBRARY (AI_ADS_TRAINING_INTEGRATION.md §2a): agency-level,
-- cross-client module. format_library and format_seed_advertisers are
-- GLOBAL tables (no client_id); format_scan runs are global runs, so
-- runs.client_id becomes nullable.

-- add value if not exists is transaction-safe on PG12+ (see the
-- breadth_selection migration). 'format_scan' is not used elsewhere in
-- this migration.
alter type run_type add value if not exists 'format_scan';

alter table runs alter column client_id drop not null;

create type format_status as enum ('active', 'fading', 'archived');
create type seed_vertical as enum ('dtc', 'saas', 'coaching', 'info', 'other');
create type seed_advertiser_status as enum ('active', 'inactive');

-- The library itself. Seeded by the worker from
-- apps/worker/prompts/static-frameworks.md on the first scan (kept out of
-- SQL so the frameworks file stays the single source of truth).
create table format_library (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text not null,
  psychology     text not null,
  skeleton       text not null,
  -- [{advertiser, ad_url, copy_snippet, vertical, days_running}]
  example_ads    jsonb not null default '[]'::jsonb,
  -- seed_vertical values this format has been confirmed in
  verticals_seen jsonb not null default '[]'::jsonb,
  status         format_status not null default 'active',
  -- consecutive full scans that did not confirm this format; 2+ => fading
  scans_missed   integer not null default 0,
  first_seen     timestamptz not null default now(),
  last_confirmed timestamptz,
  created_at     timestamptz not null default now()
);
create unique index format_library_name_idx on format_library (lower(name));

create table format_seed_advertisers (
  id          uuid primary key default gen_random_uuid(),
  vertical    seed_vertical not null,
  name        text not null,
  fb_page_url text not null,
  status      seed_advertiser_status not null default 'active',
  -- provenance: why this advertiser is on the list, and when researched
  notes       text,
  created_at  timestamptz not null default now()
);
create unique index format_seed_advertisers_name_idx
  on format_seed_advertisers (lower(name));
create index format_seed_advertisers_vertical_idx
  on format_seed_advertisers (vertical);

alter table format_library enable row level security;
create policy "authenticated full access" on format_library
  for all to authenticated using (true) with check (true);

alter table format_seed_advertisers enable row level security;
create policy "authenticated full access" on format_seed_advertisers
  for all to authenticated using (true) with check (true);

-- Seed advertisers: well-known heavy Meta advertisers, ~10 per vertical.
-- Every fb_page_url was verified as the brand's official page at research
-- time (competitor-scout discipline: a guessed URL poisons a paid
-- per-advertiser ad pull).
insert into format_seed_advertisers (vertical, name, fb_page_url, notes) values
  -- dtc
  ('dtc', 'AG1 (Athletic Greens)', 'https://www.facebook.com/drinkAG1', 'Canonical DTC supplement performance advertiser, swipe-file staple with hundreds of concurrent ads; researched 2026-07'),
  ('dtc', 'Ridge', 'https://www.facebook.com/ridge', 'EDC/wallet brand publicly known for eight-figure yearly Meta spend and hundreds of active ads; researched 2026-07'),
  ('dtc', 'HexClad', 'https://www.facebook.com/hexclad', 'Heavyweight DTC cookware performance advertiser (Gordon Ramsay partnership), large active Ad Library footprint; researched 2026-07'),
  ('dtc', 'True Classic', 'https://www.facebook.com/trueclassictees', 'Menswear brand built on Meta creative testing at scale, routinely hundreds of concurrent ads; researched 2026-07'),
  ('dtc', 'Jones Road Beauty', 'https://www.facebook.com/jonesroadbeauty', 'Bobbi Brown''s brand; widely cited case study for massive Meta spend and high-volume creative testing; researched 2026-07'),
  ('dtc', 'Vessi', 'https://www.facebook.com/vessifootwear', 'DTC waterproof-shoe brand that scaled primarily via Meta video ads; researched 2026-07'),
  ('dtc', 'Huel', 'https://www.facebook.com/Huel', 'Complete-nutrition DTC brand with very large always-on Meta ad volume across markets; researched 2026-07'),
  ('dtc', 'Dr. Squatch', 'https://www.facebook.com/drsquatch', 'Men''s grooming DTC famous for viral direct-response video ads and heavy sustained Meta spend; researched 2026-07'),
  ('dtc', 'MANSCAPED', 'https://www.facebook.com/manscaped', 'One of the best-known DTC performance advertisers with high-volume Meta creative; researched 2026-07'),
  ('dtc', 'Loop Earplugs', 'https://www.facebook.com/loopearplugs', 'Renowned for running thousands of Meta ad variations, frequent creative case-study subject; researched 2026-07'),
  -- saas
  ('saas', 'monday.com', 'https://www.facebook.com/mondaydotcom', 'Legendary B2B SaaS performance advertiser famous for massive paid-social creative testing; researched 2026-07'),
  ('saas', 'ClickUp', 'https://www.facebook.com/clickupprojectmanagement', 'Aggressive SaaS performance marketer, high-volume humor-driven Meta video ads; researched 2026-07'),
  ('saas', 'Shopify', 'https://www.facebook.com/shopify', 'Major always-on Meta advertiser for merchant acquisition; researched 2026-07'),
  ('saas', 'Grammarly', 'https://www.facebook.com/grammarly', 'One of the most-cited paid-social SaaS advertisers, built growth on high-volume direct-response video; researched 2026-07'),
  ('saas', 'Notion', 'https://www.facebook.com/NotionHQ', 'Productivity SaaS with sustained Meta acquisition campaigns, common in SaaS ad roundups; researched 2026-07'),
  ('saas', 'Canva', 'https://www.facebook.com/canva', 'Massive always-on Meta advertiser with localized high-volume campaigns worldwide; researched 2026-07'),
  ('saas', 'HubSpot', 'https://www.facebook.com/hubspot', 'Large B2B SaaS Meta advertiser with continuous lead-gen and brand campaigns; researched 2026-07'),
  ('saas', 'Semrush', 'https://www.facebook.com/Semrush', 'Marketing-SaaS heavy Meta advertiser targeting marketers with high-volume creative; researched 2026-07'),
  ('saas', 'Squarespace', 'https://www.facebook.com/squarespace', 'Long-running heavy paid-social advertiser with large concurrent Meta ad volume; researched 2026-07'),
  ('saas', 'Wix', 'https://www.facebook.com/wix', 'One of the biggest sustained Meta ad spenders in website-builder SaaS; researched 2026-07'),
  -- coaching
  ('coaching', 'Tony Robbins', 'https://www.facebook.com/TonyRobbins', 'Flagship coaching/events advertiser with large always-on Meta funnels (UPW, Time to Rise); researched 2026-07'),
  ('coaching', 'Grant Cardone', 'https://www.facebook.com/grantcardonefan', 'Verified main page (@grantcardonefan); notorious high-volume Meta advertiser for 10X events and sales training; researched 2026-07'),
  ('coaching', 'Dean Graziosi', 'https://www.facebook.com/deangraziosipage', 'Mastermind.com co-founder; heavy Meta ad volume for course launches; researched 2026-07'),
  ('coaching', 'Amy Porterfield', 'https://www.facebook.com/AmyPorterfield', 'Digital Course Academy launches are textbook heavy FB-ad funnels in online-marketing coaching; researched 2026-07'),
  ('coaching', 'Russell Brunson', 'https://www.facebook.com/RussellBrunsonLIVE', 'ClickFunnels co-founder; ecosystem built on perpetual high-volume Meta ads for books/challenges/funnels; researched 2026-07'),
  ('coaching', 'Alex Hormozi', 'https://www.facebook.com/ahormozi', 'Acquisition.com founder; heavy Meta advertiser for books, Skool games and workshops; researched 2026-07'),
  ('coaching', 'Marie Forleo', 'https://www.facebook.com/marieforleo', 'B-School annual launches historically among the biggest FB-ad-driven coaching campaigns; researched 2026-07'),
  ('coaching', 'Brendon Burchard', 'https://www.facebook.com/brendonburchardfan', 'Verified main page (@brendonburchardfan); GrowthDay runs large continuous Meta campaigns; researched 2026-07'),
  ('coaching', 'V Shred', 'https://www.facebook.com/thevinsanityshred', 'One of the highest-volume fitness-coaching advertisers on Meta, hundreds of concurrent video ads; researched 2026-07'),
  ('coaching', 'Tai Lopez', 'https://www.facebook.com/TaiLopezOfficial', 'One of the most famous heavy FB advertisers in coaching history, still running program ads; researched 2026-07'),
  -- info
  ('info', 'MasterClass', 'https://www.facebook.com/MasterClassOfficial', 'Benchmark heavy Meta advertiser with hundreds of concurrent celebrity-instructor ads; researched 2026-07'),
  ('info', 'Skillshare', 'https://www.facebook.com/skillshare', 'Long-running performance advertiser on Meta for trial subscriptions; researched 2026-07'),
  ('info', 'Coursera', 'https://www.facebook.com/Coursera', 'High-volume Meta ads for certificates and degree programs globally; researched 2026-07'),
  ('info', 'Udemy', 'https://www.facebook.com/udemy', 'Perennial heavy Meta advertiser promoting course sales and site-wide discounts; researched 2026-07'),
  ('info', 'Mindvalley', 'https://www.facebook.com/mindvalley', 'Famous for massive always-on Meta funnels driving masterclass webinars and quests; researched 2026-07'),
  ('info', 'Foundr', 'https://www.facebook.com/foundr', 'Heavy FB advertiser for entrepreneur courses and magazine funnels; researched 2026-07'),
  ('info', 'BiggerPockets', 'https://www.facebook.com/BiggerPockets', 'Real-estate-investing education platform with sustained Meta ads for membership, books, BPCon; researched 2026-07'),
  ('info', 'Codecademy', 'https://www.facebook.com/codecademy', 'Consistent Meta performance advertiser for Pro subscriptions and career paths; researched 2026-07'),
  ('info', 'Babbel', 'https://www.facebook.com/babbel.languages', 'One of the highest-volume language-learning advertisers on Meta; researched 2026-07'),
  ('info', 'Duolingo', 'https://www.facebook.com/duolingo', 'Continuous Meta app-install and Super Duolingo campaigns across many markets; researched 2026-07'),
  -- other
  ('other', 'Rocket Money', 'https://www.facebook.com/rocketmoney', 'Fintech app famous for aggressive high-volume Meta ads for subscription-cancellation/budgeting; researched 2026-07'),
  ('other', 'Lemonade', 'https://www.facebook.com/Lemonade', 'Insurtech built on performance marketing with heavy Meta spend; researched 2026-07'),
  ('other', 'SoFi', 'https://www.facebook.com/SoFi', 'Major fintech Meta advertiser across banking, loans and investing products; researched 2026-07'),
  ('other', 'Chime', 'https://www.facebook.com/chime', 'Neobank historically among the largest US fintech spenders on Meta app-install ads; researched 2026-07'),
  ('other', 'Fiverr', 'https://www.facebook.com/Fiverr', 'Freelance marketplace running sustained global Meta acquisition campaigns; researched 2026-07'),
  ('other', 'Upwork', 'https://www.facebook.com/upwork', 'Work marketplace with continuous Meta demand-gen ads for clients and talent; researched 2026-07'),
  ('other', 'Airbnb', 'https://www.facebook.com/airbnb', 'Heavy Meta advertiser for stays and host acquisition; researched 2026-07'),
  ('other', 'Uber Eats', 'https://www.facebook.com/UberEats', 'Food-delivery marketplace with large always-on Meta promo and app-install campaigns; researched 2026-07'),
  ('other', 'DraftKings', 'https://www.facebook.com/draftkings', 'Sports-betting giant with huge concurrent Meta ad volume, especially in season; researched 2026-07'),
  ('other', 'Temu', 'https://www.facebook.com/shoptemu', 'Meta''s single largest advertiser by spend in recent years, tens of thousands of Ad Library ads; researched 2026-07');
