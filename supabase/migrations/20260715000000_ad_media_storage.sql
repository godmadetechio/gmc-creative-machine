-- Phase 2 follow-up: fbcdn media URLs are signed and expire, so selected
-- candidates get their media mirrored into Supabase Storage at review time.
-- media_storage_paths holds [{ source_url, storage_path }] per mirrored file.

alter table ad_candidates add column media_storage_paths jsonb;

-- Public bucket: mirrored ad media is competitor-public content anyway, and
-- public read keeps dashboard previews and Phase 3 style-reference fetches
-- free of signed-URL plumbing.
insert into storage.buckets (id, name, public)
values ('ad-media', 'ad-media', true)
on conflict (id) do nothing;

-- The dashboard uploads as the signed-in operator (anon key + session);
-- the worker's service-role key bypasses these policies.
create policy "authenticated read ad-media" on storage.objects
  for select to authenticated using (bucket_id = 'ad-media');
create policy "authenticated insert ad-media" on storage.objects
  for insert to authenticated with check (bucket_id = 'ad-media');
create policy "authenticated update ad-media" on storage.objects
  for update to authenticated
  using (bucket_id = 'ad-media') with check (bucket_id = 'ad-media');
