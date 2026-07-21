-- Realtime on runs: the dashboard's RunWatcher subscribes to
-- postgres_changes and soft-refreshes on any run transition, replacing
-- blind 5s polling (which stays as a fallback when the channel can't
-- connect). Guarded: idempotent on re-run and tolerant of a missing
-- publication (self-hosted setups without realtime).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'runs')
  then
    alter publication supabase_realtime add table public.runs;
  end if;
end $$;
