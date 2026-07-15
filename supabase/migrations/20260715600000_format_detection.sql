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
