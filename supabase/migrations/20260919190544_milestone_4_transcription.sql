-- Milestone 4: durable OpenAI diarized transcription and explicit speaker confirmation.
alter table public.transcripts
  add column speakers_confirmed_at timestamptz,
  add column speakers_confirmed_by uuid references public.clinicians(id);

alter table public.transcripts
  add constraint transcripts_speaker_confirmation_pair check (
    (speakers_confirmed_at is null) = (speakers_confirmed_by is null)
  );

alter table public.transcript_segments
  add column provider_segment_id text;

alter table public.transcript_segments
  add constraint transcript_segments_provider_id_length check (
    provider_segment_id is null or length(btrim(provider_segment_id)) between 1 and 160
  );

create unique index transcript_segments_provider_id_idx
  on public.transcript_segments(transcript_id, provider_segment_id)
  where provider_segment_id is not null;

create unique index transcripts_one_audio_result_idx
  on public.transcripts(audio_asset_id)
  where source = 'audio';

create function private.enqueue_transcription_after_audio_verified()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'verified' and old.state is distinct from 'verified' then
    insert into public.processing_jobs(session_id, clinician_id, kind, request_key)
      values (new.session_id, new.clinician_id, 'transcription', new.id)
      on conflict (session_id, kind, request_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger enqueue_transcription_after_audio_verified
after update of state on public.audio_assets
for each row execute function private.enqueue_transcription_after_audio_verified();

-- Returns only the storage coordinates and media metadata required by the worker.
-- No transcript or provider payload is ever written to the job ledger.
create function private.claim_transcription_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  asset public.audio_assets;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'transcription'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return jsonb_build_object('state', 'succeeded'); end if;
  if job.status = 'running' and job.locked_until > now() then
    return jsonb_build_object('state', 'busy');
  end if;
  if job.attempts >= 3 then
    update public.processing_jobs set status = 'failed', locked_until = null,
      finished_at = coalesce(finished_at, now()), error_code = coalesce(error_code, 'ATTEMPTS_EXHAUSTED')
      where id = job.id;
    return jsonb_build_object('state', 'failed');
  end if;
  if job.status = 'failed' then return jsonb_build_object('state', 'failed'); end if;

  select * into asset from public.audio_assets
    where id = job.request_key and session_id = job.session_id and clinician_id = job.clinician_id
      and state = 'verified';
  if not found then raise exception 'Verified session audio required' using errcode = '23514'; end if;

  update public.processing_jobs set status = 'running', attempts = attempts + 1,
    locked_until = now() + interval '5 minutes', finished_at = null, error_code = null
    where id = job.id returning * into job;

  return jsonb_build_object(
    'state', 'claimed',
    'attempt', job.attempts,
    'bucket_id', asset.bucket_id,
    'object_path', asset.object_path,
    'mime_type', asset.mime_type,
    'duration_ms', asset.duration_ms
  );
end;
$$;

create function public.claim_transcription_job(p_job_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_transcription_job(p_job_id);
$$;

create function private.fail_transcription_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'Invalid error code' using errcode = '23514';
  end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'transcription'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return job; end if;
  if job.status <> 'running' then raise exception 'Job is not running' using errcode = '23514'; end if;

  if job.attempts < 3 then
    update public.processing_jobs set status = 'queued', available_at = now(), locked_until = null,
      error_code = p_error_code, finished_at = null where id = job.id returning * into job;
  else
    update public.processing_jobs set status = 'failed', locked_until = null,
      error_code = p_error_code, finished_at = now() where id = job.id returning * into job;
  end if;
  return job;
end;
$$;

create function public.fail_transcription_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.fail_transcription_job(p_job_id, p_error_code);
$$;

create function private.complete_transcription_job(p_job_id uuid, p_segments jsonb)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  asset public.audio_assets;
  result public.transcripts;
  segment_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'transcription'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then
    select * into result from public.transcripts where id = job.id;
    return result;
  end if;
  if job.status <> 'running' then raise exception 'Job is not running' using errcode = '23514'; end if;
  if jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'Transcript segments required' using errcode = '23514';
  end if;

  select * into asset from public.audio_assets
    where id = job.request_key and session_id = job.session_id and clinician_id = job.clinician_id
      and state = 'verified';
  if not found then raise exception 'Verified session audio required' using errcode = '23514'; end if;

  insert into public.transcripts(id, session_id, clinician_id, audio_asset_id, version,
    source, provider, model, language, duration_ms)
  values(job.id, job.session_id, job.clinician_id, asset.id,
    coalesce((select max(version) + 1 from public.transcripts where session_id = job.session_id), 1),
    'audio', 'openai', 'gpt-4o-transcribe-diarize', 'en', asset.duration_ms)
  returning * into result;

  insert into public.transcript_segments(id, transcript_id, session_id, clinician_id, ordinal,
    provider_segment_id, speaker_key, speaker_role, start_ms, end_ms, content)
  select gen_random_uuid(), result.id, result.session_id, result.clinician_id, (item.ordinality - 1)::integer,
    item.value ->> 'id', item.value ->> 'speaker', 'unknown',
    (item.value ->> 'start_ms')::integer, (item.value ->> 'end_ms')::integer,
    btrim(item.value ->> 'text')
  from jsonb_array_elements(p_segments) with ordinality as item(value, ordinality)
  where jsonb_typeof(item.value) = 'object'
    and length(btrim(item.value ->> 'id')) between 1 and 160
    and length(btrim(item.value ->> 'speaker')) between 1 and 80
    and length(btrim(item.value ->> 'text')) between 1 and 20000
    and (item.value ->> 'start_ms') ~ '^[0-9]+$'
    and (item.value ->> 'end_ms') ~ '^[0-9]+$'
    and (item.value ->> 'start_ms')::integer >= 0
    and (item.value ->> 'end_ms')::integer > (item.value ->> 'start_ms')::integer
    and (item.value ->> 'end_ms')::integer <= asset.duration_ms;

  get diagnostics segment_count = row_count;
  if segment_count <> jsonb_array_length(p_segments) then
    raise exception 'Malformed transcript segments' using errcode = '23514';
  end if;

  update public.transcripts set status = 'ready' where id = result.id returning * into result;
  update public.processing_jobs set status = 'succeeded', locked_until = null,
    error_code = null, finished_at = now() where id = job.id;
  return result;
end;
$$;

create function public.complete_transcription_job(p_job_id uuid, p_segments jsonb)
returns public.transcripts language sql security invoker set search_path = '' as $$
  select private.complete_transcription_job(p_job_id, p_segments);
$$;

create function private.retry_transcription_job(p_job_id uuid)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'transcription'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status <> 'failed' or job.attempts >= 3 then return job; end if;
  update public.processing_jobs set status = 'queued', available_at = now(), locked_until = null,
    error_code = null, finished_at = null where id = job.id returning * into job;
  return job;
end;
$$;

create function public.retry_transcription_job(p_job_id uuid)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.retry_transcription_job(p_job_id);
$$;

create function private.confirm_transcript_speakers(p_transcript_id uuid, p_assignments jsonb)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare
  result public.transcripts;
  expected_count integer;
  supplied_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into result from public.transcripts
    where id = p_transcript_id and clinician_id = auth.uid() and status = 'ready'
    for update;
  if not found then raise exception 'Transcript unavailable' using errcode = '42501'; end if;
  if exists(select 1 from public.note_revisions where transcript_id = result.id) then
    raise exception 'Evidence is frozen' using errcode = '23514';
  end if;
  if jsonb_typeof(p_assignments) <> 'object' then
    raise exception 'Speaker assignments required' using errcode = '23514';
  end if;
  if exists(select 1 from jsonb_each_text(p_assignments) assignment where assignment.value not in ('clinician', 'patient')) then
    raise exception 'Speaker role must be Psychologist or Patient' using errcode = '23514';
  end if;
  select count(distinct speaker_key) into expected_count from public.transcript_segments where transcript_id = result.id;
  select count(*) into supplied_count from jsonb_each_text(p_assignments);
  if supplied_count <> expected_count or exists(
    select 1 from public.transcript_segments s
    where s.transcript_id = result.id and not (p_assignments ? s.speaker_key)
  ) then raise exception 'Assign every transcript speaker' using errcode = '23514'; end if;

  update public.transcript_segments s set speaker_role = p_assignments ->> s.speaker_key
    where s.transcript_id = result.id;
  update public.transcripts set speakers_confirmed_at = now(), speakers_confirmed_by = auth.uid()
    where id = result.id returning * into result;
  return result;
end;
$$;

create function public.confirm_transcript_speakers(p_transcript_id uuid, p_assignments jsonb)
returns public.transcripts language sql security invoker set search_path = '' as $$
  select private.confirm_transcript_speakers(p_transcript_id, p_assignments);
$$;

-- Confirmation is a distinct clinical action, not merely the absence of unknown roles.
create or replace function private.save_note_revision(p_session_id uuid, p_transcript_id uuid, p_expected_version integer,
  p_content jsonb, p_generation_model text default null, p_prompt_version text default null)
returns public.note_revisions language plpgsql security definer set search_path = '' as $$
declare s public.sessions; latest integer; result public.note_revisions;
begin
  s := private.lock_owned_session(p_session_id);
  if exists(select 1 from public.approved_notes where session_id = s.id) then raise exception 'Session is approved' using errcode = '23514'; end if;
  select coalesce(max(version),0) into latest from public.note_revisions where session_id = s.id;
  if latest <> p_expected_version then raise exception 'Draft version conflict' using errcode = '40001'; end if;
  if not exists(select 1 from public.transcripts where id = p_transcript_id and session_id = s.id
    and clinician_id = s.clinician_id and status = 'ready' and speakers_confirmed_at is not null
    and speakers_confirmed_by = s.clinician_id) then
    raise exception 'Confirmed session transcript required' using errcode = '23514';
  end if;
  if exists(select 1 from public.transcript_segments where transcript_id = p_transcript_id
    and speaker_role not in ('clinician', 'patient')) then
    raise exception 'Speaker roles must be confirmed' using errcode = '23514';
  end if;
  perform private.validate_soap(p_content, p_transcript_id);
  insert into public.note_revisions(session_id, clinician_id, transcript_id, version, content, generation_model, prompt_version)
    values (s.id, s.clinician_id, p_transcript_id, latest + 1, p_content, p_generation_model, p_prompt_version)
    returning * into result;
  return result;
end;
$$;

revoke all on function private.enqueue_transcription_after_audio_verified(),
  private.claim_transcription_job(uuid), public.claim_transcription_job(uuid),
  private.fail_transcription_job(uuid,text), public.fail_transcription_job(uuid,text),
  private.complete_transcription_job(uuid,jsonb), public.complete_transcription_job(uuid,jsonb),
  private.retry_transcription_job(uuid), public.retry_transcription_job(uuid),
  private.confirm_transcript_speakers(uuid,jsonb), public.confirm_transcript_speakers(uuid,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function private.claim_transcription_job(uuid), private.fail_transcription_job(uuid,text),
  private.complete_transcription_job(uuid,jsonb), private.retry_transcription_job(uuid),
  private.confirm_transcript_speakers(uuid,jsonb) to authenticated;
grant execute on function public.claim_transcription_job(uuid), public.fail_transcription_job(uuid,text),
  public.complete_transcription_job(uuid,jsonb), public.retry_transcription_job(uuid),
  public.confirm_transcript_speakers(uuid,jsonb) to authenticated;
