-- Private, authenticated uploads only to previously registered object keys.
-- 50 MiB is a separate upload cap; 90-minute sessions need compressed audio.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('session-audio', 'session-audio', false, 52428800,
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/aac']);

create policy mediverse_audio_read on storage.objects for select to authenticated
using (
  bucket_id = 'session-audio' and exists (
    select 1 from public.audio_assets a
    where a.bucket_id = objects.bucket_id and a.object_path = objects.name
      and a.clinician_id = (select auth.uid()) and a.state <> 'deleted'
      and private.current_consent(a.session_id) is not null
  )
);

create policy mediverse_audio_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'session-audio' and exists (
    select 1 from public.audio_assets a
    where a.bucket_id = objects.bucket_id and a.object_path = objects.name
      and a.clinician_id = (select auth.uid()) and a.state = 'uploading'
      and a.consent_event_id = private.current_consent(a.session_id)
      and not exists(select 1 from public.approved_notes n where n.session_id = a.session_id)
  )
);

-- No UPDATE/upsert or DELETE policy for end users. Workers remove object bytes
-- through the Storage API, then mark audio_assets deleted. Never DELETE storage
-- metadata with SQL: doing so does not remove the underlying object.
