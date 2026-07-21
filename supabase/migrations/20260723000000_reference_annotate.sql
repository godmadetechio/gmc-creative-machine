-- Swipe-file AUTO-ANNOTATION: a vision agent drafts title/notes/tags/
-- vertical/format for bulk-uploaded references; humans review. Annotation
-- is a DRAFT of judgment — human-edited notes are never overwritten.

-- AI-annotated rows await human review before they flow into client picks
-- and generation runs (getAssetManifest only merges 'active' references).
-- add value if not exists is transaction-safe on PG12+; the new value is
-- not used elsewhere in this migration (55P04 rule).
alter type reference_status add value if not exists 'needs_review';

-- Who authored the current annotation: 'ai' (vision agent draft), 'human'
-- (operator-written or operator-edited), null = unannotated (eligible for
-- the next annotation run). Re-annotation only ever targets null rows.
create type annotation_source as enum ('ai', 'human');

alter table reference_library
  add column annotation_source annotation_source;

-- Existing noted references were written by the operator. (Safe in this
-- transaction: annotation_source is a brand-new type, not an added value.)
update reference_library set annotation_source = 'human' where notes is not null;

-- Global run type for the annotation pipeline (like format_scan).
alter type run_type add value if not exists 'reference_annotate';

-- type::text (not a run_type literal) because using a just-added enum
-- value in the same transaction raises 55P04.
alter table runs drop constraint runs_client_required;
alter table runs add constraint runs_client_required
  check (client_id is not null or type::text in ('format_scan', 'reference_annotate'));
