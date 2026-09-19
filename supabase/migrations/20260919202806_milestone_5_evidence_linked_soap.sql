-- Milestone 5: LLM speaker-role suggestions and durable evidence-linked SOAP drafting.
alter table public.transcripts
  add column speaker_identification_model text,
  add column speaker_identified_at timestamptz;

alter table public.transcripts
  add constraint transcripts_speaker_identification_pair check (
    (speaker_identification_model is null) = (speaker_identified_at is null)
    and (speaker_identification_model is null or length(btrim(speaker_identification_model)) between 1 and 120)
  );

alter table public.transcript_segments
  add column suggested_speaker_role text
    check (suggested_speaker_role in ('clinician', 'patient'));

alter table public.processing_jobs drop constraint processing_jobs_kind_check;
alter table public.processing_jobs
  add constraint processing_jobs_kind_check check (
    kind in ('transcription', 'speaker_identification', 'drafting', 'audio_deletion')
  ),
  add column transcript_id uuid,
  add column base_note_version integer check (base_note_version >= 0),
  add constraint processing_jobs_transcript_fkey
    foreign key (transcript_id, session_id, clinician_id)
    references public.transcripts(id, session_id, clinician_id),
  add constraint processing_jobs_input_shape check (
    (kind in ('transcription', 'audio_deletion') and transcript_id is null and base_note_version is null)
    or (kind = 'speaker_identification' and transcript_id is not null and base_note_version is null)
    or (kind = 'drafting' and transcript_id is not null and base_note_version is not null)
  );

create index processing_jobs_transcript_idx
  on public.processing_jobs(transcript_id, session_id, clinician_id)
  where transcript_id is not null;
create unique index processing_jobs_one_active_draft_idx
  on public.processing_jobs(session_id)
  where kind = 'drafting' and status in ('queued', 'running');

create or replace function private.guard_processing_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id = new.session_id for update;
  if tg_op = 'UPDATE' and
    (new.id, new.session_id, new.clinician_id, new.kind, new.request_key, new.transcript_id,
      new.base_note_version, new.created_at)
    is distinct from
    (old.id, old.session_id, old.clinician_id, old.kind, old.request_key, old.transcript_id,
      old.base_note_version, old.created_at) then
    raise exception 'Job identity is immutable' using errcode = '23514';
  end if;
  if new.kind <> 'audio_deletion' and new.status in ('queued','running') then
    if private.current_consent(new.session_id) is null then
      raise exception 'Current consent required' using errcode = '23514';
    end if;
    if exists(select 1 from public.approved_notes where session_id = new.session_id) then
      raise exception 'Session is approved' using errcode = '23514';
    end if;
    if new.kind = 'transcription' and not exists(
      select 1 from public.audio_assets where session_id = new.session_id and state = 'verified'
    ) then
      raise exception 'Verified session audio required' using errcode = '23514';
    end if;
    if new.kind = 'speaker_identification' and not exists(
      select 1 from public.transcripts
      where id = new.transcript_id and session_id = new.session_id and status = 'ready'
        and source = 'audio' and speaker_identified_at is null
    ) then
      raise exception 'Unidentified audio transcript required' using errcode = '23514';
    end if;
    if new.kind = 'drafting' and not exists(
      select 1 from public.transcripts
      where id = new.transcript_id and session_id = new.session_id and status = 'ready'
        and speakers_confirmed_at is not null
    ) then
      raise exception 'Confirmed session transcript required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create function private.enqueue_speaker_identification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'audio' and new.status = 'ready' and old.status is distinct from 'ready' then
    insert into public.processing_jobs(session_id, clinician_id, kind, request_key, transcript_id)
      values (new.session_id, new.clinician_id, 'speaker_identification', new.id, new.id)
      on conflict (session_id, kind, request_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger enqueue_speaker_identification
after update of status on public.transcripts
for each row execute function private.enqueue_speaker_identification();

create function private.claim_speaker_identification_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs; transcript public.transcripts;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'speaker_identification'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return jsonb_build_object('state', 'succeeded'); end if;
  if job.status = 'running' and job.locked_until > now() then return jsonb_build_object('state', 'busy'); end if;
  if job.status = 'failed' or job.attempts >= 3 then return jsonb_build_object('state', 'failed'); end if;
  select * into transcript from public.transcripts
    where id = job.transcript_id and session_id = job.session_id and clinician_id = job.clinician_id
      and source = 'audio' and status = 'ready' and speaker_identified_at is null;
  if not found then raise exception 'Unidentified audio transcript required' using errcode = '23514'; end if;
  update public.processing_jobs set status = 'running', attempts = attempts + 1,
    locked_until = now() + interval '5 minutes', finished_at = null, error_code = null
    where id = job.id returning * into job;
  return jsonb_build_object('state', 'claimed', 'attempt', job.attempts, 'transcript_id', transcript.id);
end;
$$;

create function public.claim_speaker_identification_job(p_job_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_speaker_identification_job(p_job_id);
$$;

create function private.complete_speaker_identification_job(
  p_job_id uuid, p_assignments jsonb, p_model text
)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs; result public.transcripts; expected_count integer; supplied_count integer;
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
    set suggested_speaker_role = p_assignments ->> segment.speaker_key
    where segment.transcript_id = result.id;
  update public.transcripts set speaker_identification_model = btrim(p_model), speaker_identified_at = now()
    where id = result.id returning * into result;
  if result.speakers_confirmed_at is not null and not exists(
    select 1 from public.note_revisions where session_id = result.session_id
  ) then
    insert into public.processing_jobs(
      session_id, clinician_id, kind, request_key, transcript_id, base_note_version
    ) values (result.session_id, result.clinician_id, 'drafting', result.id, result.id, 0)
    on conflict (session_id, kind, request_key) do nothing;
  end if;
  update public.processing_jobs set status = 'succeeded', locked_until = null,
    error_code = null, finished_at = now() where id = job.id;
  return result;
end;
$$;

create function public.complete_speaker_identification_job(
  p_job_id uuid, p_assignments jsonb, p_model text
)
returns public.transcripts language sql security invoker set search_path = '' as $$
  select private.complete_speaker_identification_job(p_job_id, p_assignments, p_model);
$$;

create function private.fail_speaker_identification_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'Invalid error code' using errcode = '23514';
  end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'speaker_identification'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return job; end if;
  if job.status <> 'running' then raise exception 'Job is not running' using errcode = '23514'; end if;
  update public.processing_jobs set status = case when attempts < 3 then 'queued' else 'failed' end,
    available_at = now(), locked_until = null, error_code = p_error_code,
    finished_at = case when attempts < 3 then null else now() end
    where id = job.id returning * into job;
  return job;
end;
$$;

create function public.fail_speaker_identification_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.fail_speaker_identification_job(p_job_id, p_error_code);
$$;

create function private.retry_speaker_identification_job(p_job_id uuid)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'speaker_identification'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status <> 'failed' or job.attempts >= 3 then return job; end if;
  update public.processing_jobs set status = 'queued', available_at = now(), locked_until = null,
    error_code = null, finished_at = null where id = job.id returning * into job;
  return job;
end;
$$;

create function public.retry_speaker_identification_job(p_job_id uuid)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.retry_speaker_identification_job(p_job_id);
$$;

-- The model proposes roles, but the psychologist must explicitly confirm or
-- correct them before the draft queue is unlocked.
create or replace function private.confirm_transcript_speakers(p_transcript_id uuid, p_assignments jsonb)
returns public.transcripts language plpgsql security definer set search_path = '' as $$
declare result public.transcripts; expected_count integer; supplied_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into result from public.transcripts
    where id = p_transcript_id and clinician_id = auth.uid() and status = 'ready'
    for update;
  if not found then raise exception 'Transcript unavailable' using errcode = '42501'; end if;
  if result.speakers_confirmed_at is not null then return result; end if;
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
      where segment.transcript_id = result.id
        and ((result.source = 'audio' and segment.suggested_speaker_role is null)
          or not (p_assignments ? segment.speaker_key))
    ) then raise exception 'Assign every speaker and include both roles' using errcode = '23514'; end if;
  update public.transcript_segments segment
    set speaker_role = p_assignments ->> segment.speaker_key
    where segment.transcript_id = result.id;
  update public.transcripts set speakers_confirmed_at = now(), speakers_confirmed_by = auth.uid()
    where id = result.id returning * into result;
  return result;
end;
$$;

create function private.enqueue_drafting_after_speaker_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'audio' and new.speakers_confirmed_at is not null
    and old.speakers_confirmed_at is null then
    insert into public.processing_jobs(
      session_id, clinician_id, kind, request_key, transcript_id, base_note_version
    ) values (new.session_id, new.clinician_id, 'drafting', new.id, new.id, 0)
    on conflict (session_id, kind, request_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger enqueue_drafting_after_speaker_confirmation
after update of speakers_confirmed_at on public.transcripts
for each row execute function private.enqueue_drafting_after_speaker_confirmation();

create function private.claim_drafting_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs; latest integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'drafting'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return jsonb_build_object('state', 'succeeded'); end if;
  if job.status = 'running' and job.locked_until > now() then return jsonb_build_object('state', 'busy'); end if;
  if job.status = 'failed' or job.attempts >= 3 then return jsonb_build_object('state', 'failed'); end if;
  select coalesce(max(version), 0) into latest from public.note_revisions where session_id = job.session_id;
  if latest <> job.base_note_version then
    update public.processing_jobs set status = 'failed', locked_until = null,
      error_code = 'DRAFT_VERSION_CONFLICT', finished_at = now() where id = job.id;
    return jsonb_build_object('state', 'failed');
  end if;
  if not exists(select 1 from public.transcripts where id = job.transcript_id
    and session_id = job.session_id and clinician_id = job.clinician_id
    and status = 'ready' and speakers_confirmed_at is not null) then
    raise exception 'Confirmed transcript required' using errcode = '23514';
  end if;
  update public.processing_jobs set status = 'running', attempts = attempts + 1,
    locked_until = now() + interval '5 minutes', finished_at = null, error_code = null
    where id = job.id returning * into job;
  return jsonb_build_object('state', 'claimed', 'attempt', job.attempts,
    'transcript_id', job.transcript_id, 'base_note_version', job.base_note_version);
end;
$$;

create function public.claim_drafting_job(p_job_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_drafting_job(p_job_id);
$$;

create function private.complete_drafting_job(
  p_job_id uuid, p_content jsonb, p_model text, p_prompt_version text
)
returns public.note_revisions language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs; result public.note_revisions;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'drafting'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then
    select * into result from public.note_revisions
      where session_id = job.session_id and version = job.base_note_version + 1;
    return result;
  end if;
  if job.status <> 'running' then raise exception 'Job is not running' using errcode = '23514'; end if;
  result := private.save_note_revision(job.session_id, job.transcript_id, job.base_note_version,
    p_content, p_model, p_prompt_version);
  update public.processing_jobs set status = 'succeeded', locked_until = null,
    error_code = null, finished_at = now() where id = job.id;
  return result;
end;
$$;

create function public.complete_drafting_job(
  p_job_id uuid, p_content jsonb, p_model text, p_prompt_version text
)
returns public.note_revisions language sql security invoker set search_path = '' as $$
  select private.complete_drafting_job(p_job_id, p_content, p_model, p_prompt_version);
$$;

create function private.fail_drafting_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'Invalid error code' using errcode = '23514';
  end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'drafting'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return job; end if;
  if job.status <> 'running' then raise exception 'Job is not running' using errcode = '23514'; end if;
  update public.processing_jobs set status = case when attempts < 3 then 'queued' else 'failed' end,
    available_at = now(), locked_until = null, error_code = p_error_code,
    finished_at = case when attempts < 3 then null else now() end
    where id = job.id returning * into job;
  return job;
end;
$$;

create function public.fail_drafting_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.fail_drafting_job(p_job_id, p_error_code);
$$;

create function private.retry_drafting_job(p_job_id uuid)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare job public.processing_jobs; latest integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into job from public.processing_jobs
    where id = p_job_id and clinician_id = auth.uid() and kind = 'drafting'
    for update;
  if not found then raise exception 'Job unavailable' using errcode = '42501'; end if;
  select coalesce(max(version), 0) into latest from public.note_revisions where session_id = job.session_id;
  if job.status <> 'failed' or job.attempts >= 3 or latest <> job.base_note_version then return job; end if;
  update public.processing_jobs set status = 'queued', available_at = now(), locked_until = null,
    error_code = null, finished_at = null where id = job.id returning * into job;
  return job;
end;
$$;

create function public.retry_drafting_job(p_job_id uuid)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.retry_drafting_job(p_job_id);
$$;

create function private.enqueue_drafting_job(
  p_session_id uuid, p_transcript_id uuid, p_expected_version integer
)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare s public.sessions; latest integer; result public.processing_jobs;
begin
  s := private.lock_owned_session(p_session_id);
  if exists(select 1 from public.approved_notes where session_id = s.id) then
    raise exception 'Session is approved' using errcode = '23514';
  end if;
  select coalesce(max(version), 0) into latest from public.note_revisions where session_id = s.id;
  if latest <> p_expected_version then raise exception 'Draft version conflict' using errcode = '40001'; end if;
  if not exists(select 1 from public.transcripts where id = p_transcript_id
    and session_id = s.id and clinician_id = s.clinician_id and status = 'ready'
    and speakers_confirmed_at is not null) then
    raise exception 'Confirmed transcript required' using errcode = '23514';
  end if;
  if exists(select 1 from public.processing_jobs where session_id = s.id and kind = 'drafting'
    and status in ('queued', 'running')) then
    raise exception 'Draft generation already active' using errcode = '23505';
  end if;
  insert into public.processing_jobs(
    session_id, clinician_id, kind, request_key, transcript_id, base_note_version
  ) values (s.id, s.clinician_id, 'drafting', gen_random_uuid(), p_transcript_id, latest)
  returning * into result;
  return result;
end;
$$;

create function public.enqueue_drafting_job(
  p_session_id uuid, p_transcript_id uuid, p_expected_version integer
)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.enqueue_drafting_job(p_session_id, p_transcript_id, p_expected_version);
$$;

-- Transcripts completed before this migration still receive LLM speaker-role
-- identification, provided their evidence has not already been frozen by a draft.
insert into public.processing_jobs(session_id, clinician_id, kind, request_key, transcript_id)
select transcript.session_id, transcript.clinician_id, 'speaker_identification', transcript.id, transcript.id
from public.transcripts transcript
where transcript.source = 'audio' and transcript.status = 'ready'
  and transcript.speaker_identified_at is null
  and not exists(select 1 from public.note_revisions revision where revision.transcript_id = transcript.id)
  and not exists(select 1 from public.processing_jobs job
    where job.session_id = transcript.session_id and job.kind = 'speaker_identification'
      and job.request_key = transcript.id)
on conflict (session_id, kind, request_key) do nothing;

-- Existing confirmed audio transcripts with no draft enter the new drafting queue.
insert into public.processing_jobs(
  session_id, clinician_id, kind, request_key, transcript_id, base_note_version
)
select transcript.session_id, transcript.clinician_id, 'drafting', transcript.id,
  transcript.id, 0
from public.transcripts transcript
where transcript.source = 'audio' and transcript.status = 'ready'
  and transcript.speakers_confirmed_at is not null and transcript.speaker_identified_at is not null
  and not exists(select 1 from public.note_revisions revision where revision.session_id = transcript.session_id)
  and not exists(select 1 from public.processing_jobs job
    where job.session_id = transcript.session_id and job.kind = 'drafting')
on conflict (session_id, kind, request_key) do nothing;

revoke all on function private.enqueue_speaker_identification(),
  private.claim_speaker_identification_job(uuid), public.claim_speaker_identification_job(uuid),
  private.complete_speaker_identification_job(uuid,jsonb,text), public.complete_speaker_identification_job(uuid,jsonb,text),
  private.fail_speaker_identification_job(uuid,text), public.fail_speaker_identification_job(uuid,text),
  private.retry_speaker_identification_job(uuid), public.retry_speaker_identification_job(uuid),
  private.enqueue_drafting_after_speaker_confirmation(),
  private.claim_drafting_job(uuid), public.claim_drafting_job(uuid),
  private.complete_drafting_job(uuid,jsonb,text,text), public.complete_drafting_job(uuid,jsonb,text,text),
  private.fail_drafting_job(uuid,text), public.fail_drafting_job(uuid,text),
  private.retry_drafting_job(uuid), public.retry_drafting_job(uuid),
  private.enqueue_drafting_job(uuid,uuid,integer), public.enqueue_drafting_job(uuid,uuid,integer)
from public, anon, authenticated, service_role;

grant execute on function private.claim_speaker_identification_job(uuid),
  private.complete_speaker_identification_job(uuid,jsonb,text),
  private.fail_speaker_identification_job(uuid,text), private.retry_speaker_identification_job(uuid),
  private.claim_drafting_job(uuid), private.complete_drafting_job(uuid,jsonb,text,text),
  private.fail_drafting_job(uuid,text), private.retry_drafting_job(uuid),
  private.enqueue_drafting_job(uuid,uuid,integer) to authenticated;
grant execute on function public.claim_speaker_identification_job(uuid),
  public.complete_speaker_identification_job(uuid,jsonb,text),
  public.fail_speaker_identification_job(uuid,text), public.retry_speaker_identification_job(uuid),
  public.claim_drafting_job(uuid), public.complete_drafting_job(uuid,jsonb,text,text),
  public.fail_drafting_job(uuid,text), public.retry_drafting_job(uuid),
  public.enqueue_drafting_job(uuid,uuid,integer) to authenticated;
