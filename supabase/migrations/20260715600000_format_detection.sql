-- Format detection mode: visually-defined formats (sticky note, iPhone
-- notes, before/after, N-reasons) carry no identifying ad copy, so the
-- text-only extractor can never confirm them — they are exempt from the
-- scans_missed/fading pass until a vision pass can confirm them.

create type format_detection as enum ('text', 'visual', 'both');

alter table format_library
  add column detection format_detection not null default 'text';

-- Already-seeded libraries: mark the four visual seed formats. Fresh
-- installs get the same values from the worker seeder (which reads
-- static-frameworks.md).
update format_library
  set detection = 'visual'
  where lower(name) in ('sticky note', 'iphone notes', 'before / after', 'n reasons why');

-- Undo any false decay the text-only scans already inflicted on them.
update format_library
  set scans_missed = 0,
      status = 'active'
  where detection = 'visual' and status = 'fading';

-- Rebuild verticals_seen from the evidence: earlier scans accrued the
-- scan's vertical off extractor claims even when no example ad from that
-- vertical was cited (e.g. all five badges with only one advertiser's
-- examples). From now on the pipeline only accrues example-backed
-- verticals; this backfills existing rows to the same standard.
update format_library
  set verticals_seen = coalesce(
    (
      select jsonb_agg(distinct example ->> 'vertical')
      from jsonb_array_elements(example_ads) as example
      where example ->> 'vertical' is not null
    ),
    '[]'::jsonb
  );
