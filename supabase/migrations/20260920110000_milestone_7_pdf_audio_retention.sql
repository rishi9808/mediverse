-- Milestone 7: self-contained approved-note exports and auditable deletion of
-- the underlying Storage object after the configured grace period.

create or replace function private.approve_note(
  p_session_id uuid,
  p_note_revision_id uuid,
  p_confirmed boolean
)
returns public.approved_notes language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  revision public.note_revisions;
  result public.approved_notes;
  snapshot_data jsonb;
  evidence_data jsonb;
  approval_time timestamptz := now();
begin
  if p_confirmed is distinct from true then
    raise exception 'Explicit clinician confirmation required' using errcode = '23514';
  end if;

  s := private.lock_owned_session(p_session_id);
  select * into result from public.approved_notes where session_id = s.id;
  if found then
    if result.note_revision_id is distinct from p_note_revision_id then
      raise exception 'A different revision is already approved' using errcode = '23514';
    end if;
    return result;
  end if;

  if private.current_consent(s.id) is null then
    raise exception 'Current consent required' using errcode = '23514';
  end if;

  select * into revision from public.note_revisions where session_id = s.id order by version desc limit 1;
  if not found or revision.id is distinct from p_note_revision_id then
    raise exception 'Approve the latest saved revision' using errcode = '40001';
  end if;

  perform private.validate_soap(revision.content, revision.transcript_id, true);
  if exists(select 1 from public.audio_assets where session_id = s.id and state = 'uploading') then
    raise exception 'Finish media verification before approval' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'segment_id', cited.id,
    'start_ms', cited.start_ms,
    'end_ms', cited.end_ms,
    'speaker_role', cited.speaker_role
  ) order by cited.ordinal), '[]'::jsonb)
  into evidence_data
  from (
    select distinct on (segment.id)
      segment.id, segment.ordinal, segment.start_ms, segment.end_ms, segment.speaker_role
    from jsonb_each(revision.content) section
    cross join lateral jsonb_array_elements(section.value) statement
    cross join lateral jsonb_array_elements_text(statement -> 'segment_ids') cited_id
    join public.transcript_segments segment
      on segment.id::text = cited_id and segment.transcript_id = revision.transcript_id
    order by segment.id, segment.ordinal
  ) cited;

  select jsonb_build_object(
    'schema_version', 2,
    'format', 'SOAP',
    'is_fictional', true,
    'patient', jsonb_build_object(
      'id', p.id,
      'display_code', p.display_code,
      'display_name', p.display_name
    ),
    'clinician', jsonb_build_object(
      'id', c.id,
      'display_name', c.display_name,
      'profession', c.profession
    ),
    'session', jsonb_build_object(
      'id', s.id,
      'occurred_at', s.occurred_at,
      'setting', s.setting,
      'language', s.language
    ),
    'note_revision_id', revision.id,
    'note_version', revision.version,
    'transcript_id', revision.transcript_id,
    'approved_at', approval_time,
    'confirmation', jsonb_build_object(
      'confirmed', true,
      'confirmed_at', approval_time,
      'confirmed_by', s.clinician_id
    ),
    'content', revision.content,
    'evidence_references', evidence_data
  ) into snapshot_data
  from public.patients p cross join public.clinicians c
  where p.id = s.patient_id and c.id = s.clinician_id;

  insert into public.approved_notes(
    session_id,
    clinician_id,
    note_revision_id,
    snapshot,
    approved_at
  ) values (
    s.id,
    s.clinician_id,
    revision.id,
    snapshot_data,
    approval_time
  ) returning * into result;

  update public.audio_assets
  set state = 'pending_deletion',
      deletion_due_at = approval_time + (select audio_grace_period from private.retention_settings where singleton)
  where session_id = s.id and state = 'verified';

  return result;
end;
$$;

-- Every transition into pending_deletion creates exactly one durable job. This
-- covers both approval and consent revocation, including rows from old releases.
create function private.enqueue_audio_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'pending_deletion' and old.state is distinct from 'pending_deletion' then
    insert into public.processing_jobs(
      session_id,
      clinician_id,
      kind,
      request_key,
      available_at
    ) values (
      new.session_id,
      new.clinician_id,
      'audio_deletion',
      new.id,
      new.deletion_due_at
    ) on conflict (session_id, kind, request_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger enqueue_audio_deletion
after update of state on public.audio_assets
for each row execute function private.enqueue_audio_deletion();

insert into public.processing_jobs(session_id, clinician_id, kind, request_key, available_at)
select session_id, clinician_id, 'audio_deletion', id, deletion_due_at
from public.audio_assets
where state = 'pending_deletion'
on conflict (session_id, kind, request_key) do nothing;

-- The scheduler leases one due object at a time. Only service_role can call
-- these RPCs. The job contains identifiers and safe status codes, never media
-- contents, transcript text, note text, or a provider response.
create function private.claim_audio_deletion_job()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed record;
begin
  select
    job.id as job_id,
    job.request_key as audio_asset_id,
    asset.bucket_id,
    asset.object_path
  into claimed
  from public.processing_jobs job
  join public.audio_assets asset
    on asset.id = job.request_key
    and asset.session_id = job.session_id
    and asset.clinician_id = job.clinician_id
  where job.kind = 'audio_deletion'
    and job.attempts < 5
    and asset.state = 'pending_deletion'
    and asset.deletion_due_at <= now()
    and (
      (job.status = 'queued' and job.available_at <= now())
      or (job.status = 'running' and job.locked_until <= now())
    )
  order by asset.deletion_due_at, job.created_at
  for update of job skip locked
  limit 1;

  if not found then
    return jsonb_build_object('state', 'empty');
  end if;

  update public.processing_jobs
  set status = 'running',
      attempts = attempts + 1,
      locked_until = now() + interval '5 minutes',
      error_code = null,
      finished_at = null
  where id = claimed.job_id;

  return jsonb_build_object(
    'state', 'claimed',
    'job_id', claimed.job_id,
    'audio_asset_id', claimed.audio_asset_id,
    'bucket_id', claimed.bucket_id,
    'object_path', claimed.object_path
  );
end;
$$;

create function public.claim_audio_deletion_job()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_audio_deletion_job();
$$;

create function private.complete_audio_deletion_job(p_job_id uuid, p_audio_asset_id uuid)
returns public.audio_assets language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  asset public.audio_assets;
begin
  select * into job from public.processing_jobs
  where id = p_job_id and kind = 'audio_deletion' and request_key = p_audio_asset_id
  for update;
  if not found then raise exception 'Deletion job unavailable' using errcode = '42501'; end if;

  select * into asset from public.audio_assets where id = p_audio_asset_id for update;
  if not found or asset.session_id <> job.session_id or asset.clinician_id <> job.clinician_id then
    raise exception 'Deletion asset unavailable' using errcode = '42501';
  end if;

  if asset.state = 'deleted' and job.status = 'succeeded' then return asset; end if;
  if job.status <> 'running' then raise exception 'Deletion job is not running' using errcode = '23514'; end if;
  if asset.state = 'pending_deletion' and asset.deletion_due_at > now() then
    raise exception 'Audio grace period has not elapsed' using errcode = '23514';
  end if;
  if asset.state not in ('pending_deletion', 'deleted') then
    raise exception 'Audio is not pending deletion' using errcode = '23514';
  end if;

  if asset.state = 'pending_deletion' then
    update public.audio_assets
    set state = 'deleted', deleted_at = greatest(now(), deletion_due_at)
    where id = asset.id returning * into asset;
  end if;

  update public.processing_jobs
  set status = 'succeeded', locked_until = null, error_code = null, finished_at = now()
  where id = job.id;
  return asset;
end;
$$;

create function public.complete_audio_deletion_job(p_job_id uuid, p_audio_asset_id uuid)
returns public.audio_assets language sql security invoker set search_path = '' as $$
  select private.complete_audio_deletion_job(p_job_id, p_audio_asset_id);
$$;

create function private.fail_audio_deletion_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'Invalid error code' using errcode = '23514';
  end if;
  select * into job from public.processing_jobs
  where id = p_job_id and kind = 'audio_deletion' for update;
  if not found then raise exception 'Deletion job unavailable' using errcode = '42501'; end if;
  if job.status = 'succeeded' then return job; end if;
  if job.status <> 'running' then raise exception 'Deletion job is not running' using errcode = '23514'; end if;

  update public.processing_jobs
  set status = case when attempts < 5 then 'queued' else 'failed' end,
      available_at = case when attempts < 5 then now() + interval '15 minutes' else available_at end,
      locked_until = null,
      error_code = p_error_code,
      finished_at = case when attempts < 5 then null else now() end
  where id = job.id returning * into job;
  return job;
end;
$$;

create function public.fail_audio_deletion_job(p_job_id uuid, p_error_code text)
returns public.processing_jobs language sql security invoker set search_path = '' as $$
  select private.fail_audio_deletion_job(p_job_id, p_error_code);
$$;

revoke all on function private.enqueue_audio_deletion(), private.claim_audio_deletion_job(),
  private.complete_audio_deletion_job(uuid, uuid), private.fail_audio_deletion_job(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_audio_deletion_job(),
  public.complete_audio_deletion_job(uuid, uuid), public.fail_audio_deletion_job(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.claim_audio_deletion_job(),
  private.complete_audio_deletion_job(uuid, uuid), private.fail_audio_deletion_job(uuid, text)
  to service_role;
grant execute on function public.claim_audio_deletion_job(),
  public.complete_audio_deletion_job(uuid, uuid), public.fail_audio_deletion_job(uuid, text)
  to service_role;
