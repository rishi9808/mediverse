-- Record the actual STT provider/model selected by the application. Deepgram
-- Nova-3 is the preferred low-latency path; the existing OpenAI diarized model
-- remains a supported configuration fallback.

create function private.complete_transcription_job(
  p_job_id uuid,
  p_segments jsonb,
  p_provider text,
  p_model text
)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  asset public.audio_assets;
  result public.transcripts;
  segment_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if (p_provider, p_model) not in (
    ('deepgram', 'nova-3'),
    ('openai', 'gpt-4o-transcribe-diarize')
  ) then
    raise exception 'Unsupported transcription provider' using errcode = '23514';
  end if;
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
    'audio', p_provider, p_model, 'en', asset.duration_ms)
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

create function public.complete_transcription_job(
  p_job_id uuid,
  p_segments jsonb,
  p_provider text,
  p_model text
)
returns public.transcripts language sql security invoker set search_path = '' as $$
  select private.complete_transcription_job(p_job_id, p_segments, p_provider, p_model);
$$;

revoke all on function private.complete_transcription_job(uuid,jsonb,text,text),
  public.complete_transcription_job(uuid,jsonb,text,text)
  from public, anon, authenticated, service_role;

grant execute on function private.complete_transcription_job(uuid,jsonb,text,text),
  public.complete_transcription_job(uuid,jsonb,text,text)
  to authenticated;
