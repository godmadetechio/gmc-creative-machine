-- When the CURRENT annotation was written (AI draft or human edit).
-- Powers the Swipe File status strip's live "X of N done" run progress:
-- rows with annotated_at after the run's started_at were done by that run.
alter table reference_library add column annotated_at timestamptz;

-- Backfill: existing annotated rows get their creation time — close enough
-- for history; progress tracking only cares about rows annotated from now on.
update reference_library set annotated_at = created_at
  where annotation_source is not null;
