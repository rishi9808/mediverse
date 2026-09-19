-- Apply validated LLM speaker identification immediately. The clinician reviews
-- the generated SOAP note, but no longer has to select transcript speaker roles.
create or replace function private.complete_speaker_identification_job(
  p_job_id uuid, p_assignments jsonb, p_model text
)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  result public.transcripts;
  expected_count integer;
  supplied_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_model is null or length(btrim(p_model)) not between 1 and 120 then
    raise exception 'Identification model required' using errcode = '23514';
  end if;

  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'speaker_identification'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;

  select * into result from public.transcripts where id = job.transcript_id for update;
  if job.status = 'succeeded' then return result; end if;
  if job.status <> 'running' then raise exception 'Job is not running' using errcode = '23514'; end if;
  if jsonb_typeof(p_assignments) <> 'object' or exists(
    select 1 from jsonb_each_text(p_assignments) assignment
    where assignment.value not in ('clinician', 'patient')
  ) then raise exception 'Valid LLM speaker assignments required' using errcode = '23514'; end if;

  select count(distinct speaker_key) into expected_count
    from public.transcript_segments where transcript_id = result.id;
  select count(*) into supplied_count from jsonb_each_text(p_assignments);
  if supplied_count <> expected_count or not exists(
      select 1 from jsonb_each_text(p_assignments) where value = 'clinician'
    ) or not exists(
      select 1 from jsonb_each_text(p_assignments) where value = 'patient'
    ) or exists(
      select 1 from public.transcript_segments segment
      where segment.transcript_id = result.id and not (p_assignments ? segment.speaker_key)
    ) then raise exception 'Assign every speaker and include both roles' using errcode = '23514'; end if;

  update public.transcript_segments segment
    set suggested_speaker_role = p_assignments ->> segment.speaker_key,
        speaker_role = p_assignments ->> segment.speaker_key
    where segment.transcript_id = result.id;

  update public.transcripts
    set speaker_identification_model = btrim(p_model),
        speaker_identified_at = now(),
        speakers_confirmed_at = now(),
        speakers_confirmed_by = auth.uid()
    where id = result.id
    returning * into result;

  update public.processing_jobs
    set status = 'succeeded', locked_until = null, error_code = null, finished_at = now()
    where id = job.id;
  return result;
end;
$$;

-- Preserve a programmatic correction path for synthetic fixtures and recovery,
-- while removing it from the clinician UI. Corrections are still frozen once a
-- note revision cites the transcript.
create or replace function private.confirm_transcript_speakers(p_transcript_id uuid, p_assignments jsonb)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare result public.transcripts; expected_count integer; supplied_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into result from public.transcripts
    where id = p_transcript_id and clinician_id = auth.uid() and status = 'ready'
    for update;
  if not found then raise exception 'Transcript unavailable' using errcode = '42501'; end if;
  if result.source = 'audio' and
    (result.speaker_identified_at is null or result.speaker_identification_model is null) then
    raise exception 'LLM speaker identification required' using errcode = '23514';
  end if;
  if exists(select 1 from public.note_revisions where transcript_id = result.id) then
    raise exception 'Evidence is frozen' using errcode = '23514';
  end if;
  if jsonb_typeof(p_assignments) <> 'object' or exists(
    select 1 from jsonb_each_text(p_assignments) assignment
    where assignment.value not in ('clinician', 'patient')
  ) then raise exception 'Speaker role must be Psychologist or Patient' using errcode = '23514'; end if;
  select count(distinct speaker_key) into expected_count
    from public.transcript_segments where transcript_id = result.id;
  select count(*) into supplied_count from jsonb_each_text(p_assignments);
  if supplied_count <> expected_count or not exists(
      select 1 from jsonb_each_text(p_assignments) where value = 'clinician'
    ) or not exists(
      select 1 from jsonb_each_text(p_assignments) where value = 'patient'
    ) or exists(
      select 1 from public.transcript_segments segment
      where segment.transcript_id = result.id and not (p_assignments ? segment.speaker_key)
    ) then raise exception 'Assign every speaker and include both roles' using errcode = '23514'; end if;
  update public.transcript_segments segment
    set speaker_role = p_assignments ->> segment.speaker_key
    where segment.transcript_id = result.id;
  if result.speakers_confirmed_at is null then
    update public.transcripts set speakers_confirmed_at = now(), speakers_confirmed_by = auth.uid()
      where id = result.id returning * into result;
  end if;
  return result;
end;
$$;

-- Finalize already-identified transcripts that were waiting on the removed UI
-- confirmation step. The existing trigger queues drafting exactly once.
update public.transcript_segments segment
set speaker_role = segment.suggested_speaker_role
from public.transcripts transcript
where transcript.id = segment.transcript_id
  and transcript.source = 'audio'
  and transcript.speaker_identified_at is not null
  and transcript.speakers_confirmed_at is null
  and segment.suggested_speaker_role in ('clinician', 'patient')
  and not exists(select 1 from public.note_revisions revision where revision.transcript_id = transcript.id)
  and not exists(
    select 1 from public.transcript_segments missing
    where missing.transcript_id = transcript.id and missing.suggested_speaker_role is null
  );

update public.transcripts transcript
set speakers_confirmed_at = transcript.speaker_identified_at,
    speakers_confirmed_by = transcript.clinician_id
where transcript.source = 'audio'
  and transcript.speaker_identified_at is not null
  and transcript.speakers_confirmed_at is null
  and not exists(select 1 from public.note_revisions revision where revision.transcript_id = transcript.id)
  and not exists(
    select 1 from public.transcript_segments segment
    where segment.transcript_id = transcript.id
      and segment.speaker_role not in ('clinician', 'patient')
  )
  and exists(
    select 1 from public.transcript_segments segment
    where segment.transcript_id = transcript.id and segment.speaker_role = 'clinician'
  )
  and exists(
    select 1 from public.transcript_segments segment
    where segment.transcript_id = transcript.id and segment.speaker_role = 'patient'
  );
