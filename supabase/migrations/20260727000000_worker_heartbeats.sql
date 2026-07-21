-- Worker liveness: the worker upserts its row every 30s (service role,
-- bypasses RLS); the dashboard reads max(last_seen_at) and shows an
-- offline banner when it goes stale (>2 min). Keyed by worker id
-- (hostname#pid) rather than a singleton so a second worker needs no
-- schema change.
create table worker_heartbeats (
  id           text primary key,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table worker_heartbeats enable row level security;

-- Dashboard (authenticated anon-key sessions) only ever reads.
create policy "authenticated read" on worker_heartbeats
  for select to authenticated using (true);
