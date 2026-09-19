-- Audio verified before Milestone 4 did not pass through the new enqueue trigger.
-- Create the same idempotent job the trigger would have created.
insert into public.processing_jobs(session_id, clinician_id, kind, request_key)
select a.session_id, a.clinician_id, 'transcription', a.id
from public.audio_assets a
where a.state = 'verified'
  and private.current_consent(a.session_id) is not null
  and not exists (
    select 1 from public.approved_notes approved where approved.session_id = a.session_id
  )
  and not exists (
    select 1 from public.transcripts transcript
    where transcript.audio_asset_id = a.id and transcript.status = 'ready'
  )
on conflict (session_id, kind, request_key) do nothing;
