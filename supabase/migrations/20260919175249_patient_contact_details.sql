-- Promote patient onboarding from demo-only display identities to real clinical
-- contact profiles while preserving clinician ownership and existing RLS.
alter table public.patients
  add column mobile text not null default '+15555550100',
  add column email text,
  add column location text not null default 'Details pending',
  add column date_of_birth date,
  add column gender text;

alter table public.patients
  alter column mobile drop default,
  alter column location drop default,
  add constraint patients_mobile_format check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  add constraint patients_email_format check (
    email is null or (length(email) <= 254 and email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
  ),
  add constraint patients_location_length check (length(btrim(location)) between 1 and 160),
  add constraint patients_date_of_birth_range check (
    date_of_birth is null or date_of_birth between date '1900-01-01' and current_date
  ),
  add constraint patients_gender_length check (gender is null or length(btrim(gender)) between 1 and 60),
  drop column is_fictional;

grant insert (mobile, email, location, date_of_birth, gender) on public.patients to authenticated;
grant update (mobile, email, location, date_of_birth, gender) on public.patients to authenticated;

-- Future approved snapshots no longer label patients as fictional. Historical
-- approved snapshots remain immutable by design.
create or replace function private.approve_note(p_session_id uuid, p_note_revision_id uuid)
returns public.approved_notes language plpgsql security definer set search_path = '' as $$
declare s public.sessions; revision public.note_revisions; result public.approved_notes; snapshot_data jsonb;
begin
  s := private.lock_owned_session(p_session_id);
  select * into result from public.approved_notes where session_id = s.id;
  if found then
    if result.note_revision_id is distinct from p_note_revision_id then raise exception 'A different revision is already approved' using errcode = '23514'; end if;
    return result;
  end if;
  if private.current_consent(s.id) is null then raise exception 'Current consent required' using errcode = '23514'; end if;
  select * into revision from public.note_revisions where session_id = s.id order by version desc limit 1;
  if not found or revision.id is distinct from p_note_revision_id then
    raise exception 'Approve the latest saved revision' using errcode = '40001';
  end if;
  perform private.validate_soap(revision.content, revision.transcript_id, true);
  if exists(select 1 from public.audio_assets where session_id = s.id and state = 'uploading') then
    raise exception 'Finish media verification before approval' using errcode = '23514';
  end if;
  select jsonb_build_object(
    'schema_version', 1, 'format', 'SOAP',
    'patient', jsonb_build_object('id', p.id, 'display_code', p.display_code, 'display_name', p.display_name),
    'clinician', jsonb_build_object('id', c.id, 'display_name', c.display_name, 'profession', c.profession),
    'session', jsonb_build_object('id', s.id, 'occurred_at', s.occurred_at, 'setting', s.setting, 'language', s.language),
    'note_revision_id', revision.id, 'note_version', revision.version,
    'transcript_id', revision.transcript_id, 'approved_at', now(), 'content', revision.content
  ) into snapshot_data from public.patients p cross join public.clinicians c
    where p.id = s.patient_id and c.id = s.clinician_id;
  insert into public.approved_notes(session_id, clinician_id, note_revision_id, snapshot)
    values(s.id, s.clinician_id, revision.id, snapshot_data) returning * into result;
  update public.audio_assets set state = 'pending_deletion',
    deletion_due_at = now() + (select audio_grace_period from private.retention_settings where singleton)
    where session_id = s.id and state = 'verified';
  return result;
end;
$$;

revoke all on function private.approve_note(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.approve_note(uuid,uuid) to authenticated;
