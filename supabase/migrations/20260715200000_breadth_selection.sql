-- Breadth restructure of Creative Selection: top 20-30 advertisers, ~3
-- winners each, one run per review queue.

-- New candidate lifecycle state: when a creative_selection run completes,
-- prior rows still in 'candidate' are auto-archived as 'superseded' so two
-- runs never mix in one review queue. (Added, not used, in this migration —
-- safe inside the migration transaction on PG 12+.)
alter type candidate_status add value if not exists 'superseded';

-- Track whether a competitor's page actually had ads on the last pull, so
-- dead pages are skipped (re-checked after 30 days) instead of re-billed.
create type competitor_ad_status as enum ('unknown', 'active', 'not_running');

alter table competitors
  add column ad_status competitor_ad_status not null default 'unknown',
  add column last_checked timestamptz;

-- Which run produced each candidate — the queue shows one run at a time.
alter table ad_candidates
  add column run_id uuid references runs (id) on delete set null;

create index ad_candidates_run_id_idx on ad_candidates (run_id);
