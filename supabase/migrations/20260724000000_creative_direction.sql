-- CREATIVE DIRECTION — layered standing briefs from the Head of Creative
-- that every generation agent must obey. Three scopes with precedence
-- client > vertical > agency; hard_rules and reference_ids UNION across
-- scopes (a 'never' at any level always applies). New versions are new
-- rows (old one deactivated) — full history preserved.

create type directive_scope as enum ('agency', 'vertical', 'client');

-- Clients get a real vertical column (format-library provenance and
-- direction lookups both key on it; 'coaching' fallback lives in code).
alter table clients add column vertical seed_vertical;

create table creative_directives (
  id         uuid primary key default gen_random_uuid(),
  scope      directive_scope not null,
  vertical   seed_vertical,
  client_id  uuid references clients (id) on delete cascade,
  version    integer not null,
  is_active  boolean not null default false,
  author     text,
  -- BriefSectionsSchema in packages/shared: objective, tone_voice,
  -- visual_direction, messaging_priorities, hard_rules, reference_ids,
  -- compliance_notes, current_focus — all optional.
  sections   jsonb not null,
  created_at timestamptz not null default now(),
  check ((scope = 'vertical') = (vertical is not null)),
  check ((scope = 'client') = (client_id is not null))
);

-- One ACTIVE brief per scope-target.
create unique index creative_directives_one_active_agency
  on creative_directives (scope) where is_active and scope = 'agency';
create unique index creative_directives_one_active_vertical
  on creative_directives (vertical) where is_active and scope = 'vertical';
create unique index creative_directives_one_active_client
  on creative_directives (client_id) where is_active and scope = 'client';

-- Version numbers are per-target.
create unique index creative_directives_agency_version
  on creative_directives (version) where scope = 'agency';
create unique index creative_directives_vertical_version
  on creative_directives (vertical, version) where scope = 'vertical';
create unique index creative_directives_client_version
  on creative_directives (client_id, version) where scope = 'client';

create index creative_directives_client_id_idx on creative_directives (client_id);

-- Traceability: which brief versions were in force when a creative was
-- generated, e.g. {"agency": 3, "vertical": 1, "client": 2}.
alter table creatives add column directives_used jsonb;

-- ── Feedback-to-brief suggestions (pipeline output; humans accept) ───────

create type suggestion_status as enum ('pending', 'accepted', 'dismissed');

create table brief_suggestions (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients (id) on delete cascade,
  run_id          uuid references runs (id) on delete set null,
  -- BriefSections key the amendment targets ('hard_rules' for rule adds).
  section         text not null,
  -- 'add_never' | 'add_always' | 'amend_section'
  kind            text not null,
  proposal        jsonb not null,
  rationale       text,
  -- Verbatim rejection-feedback quotes justifying the amendment (verified
  -- against real feedback rows by the pipeline before insert).
  feedback_quotes jsonb not null,
  status          suggestion_status not null default 'pending',
  created_at      timestamptz not null default now()
);

create index brief_suggestions_client_status_idx
  on brief_suggestions (client_id, status);

alter type run_type add value if not exists 'brief_suggestions';

alter table creative_directives enable row level security;
alter table brief_suggestions enable row level security;
create policy "authenticated full access" on creative_directives
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on brief_suggestions
  for all to authenticated using (true) with check (true);

-- ── Seeds: agency v1 + coaching-vertical v1 (edited later in the UI) ─────

insert into creative_directives (scope, version, is_active, author, sections)
select 'agency', 1, true, 'seed', '{
  "objective": "Produce paid-social creatives that stop the scroll because they feel like content, and convert because they speak the market''s own language at a specific person.",
  "tone_voice": "Direct, human, specific. Write like someone who knows this audience personally — no marketing-speak, no hype filler, no exclamation-mark enthusiasm.",
  "visual_direction": "Native-over-polished: creatives should read as feed content first, ads second. Real people, real settings, imperfect lighting over studio gloss. Bold, legible type; one visual idea per creative.",
  "messaging_priorities": [
    "Name the audience explicitly in the copy — creative text does the targeting",
    "Lead with the market''s own words: language_bank phrases verbatim where natural",
    "One avatar, one angle per creative — depth beats breadth"
  ],
  "hard_rules": {
    "never": [
      "Generic stock imagery or obviously-stock people",
      "Corporate gradient-and-glass ad polish that screams advertisement",
      "Claims, numbers, or testimonials that don''t come from the client''s own material"
    ],
    "always": [
      "Name the audience explicitly in the copy",
      "Design for mobile-feed legibility — readable in under 3 seconds",
      "Respect the client''s brand do/don''t rules from their brand kit"
    ]
  },
  "reference_ids": []
}'::jsonb
where not exists (select 1 from creative_directives where scope = 'agency');

insert into creative_directives (scope, vertical, version, is_active, author, sections)
select 'vertical', 'coaching', 1, true, 'seed', '{
  "compliance_notes": "Meta health & wellness policy applies to every coaching creative: no unrealistic outcome claims and nothing that implies guaranteed results; no negative body-image framing — never make the viewer feel bad about their body or imply personal failure; no before/after imagery that implies a guaranteed or typical result; avoid second-person callouts of health conditions or personal attributes (''Are you overweight?'').",
  "hard_rules": {
    "never": [
      "Unrealistic or guaranteed outcome claims (timeframes, exact numbers promised to everyone)",
      "Negative body-image framing or shame-based hooks",
      "Before/after imagery that implies guaranteed results"
    ],
    "always": [
      "Frame transformation as method plus effort, never a promised outcome"
    ]
  },
  "reference_ids": []
}'::jsonb
where not exists (
  select 1 from creative_directives where scope = 'vertical' and vertical = 'coaching'
);
