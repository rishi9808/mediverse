-- Milestone 6: require an explicit clinician confirmation at the database boundary.
-- The approved snapshot remains append-only and captures the confirmation event.

drop function public.approve_note(uuid, uuid);
drop function private.approve_note(uuid, uuid);

create function private.approve_note(
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

  select jsonb_build_object(
    'schema_version', 1,
    'format', 'SOAP',
    'patient', jsonb_build_object('id', p.id, 'display_code', p.display_code, 'display_name', p.display_name),
    'clinician', jsonb_build_object('id', c.id, 'display_name', c.display_name, 'profession', c.profession),
    'session', jsonb_build_object('id', s.id, 'occurred_at', s.occurred_at, 'setting', s.setting, 'language', s.language),
    'note_revision_id', revision.id,
    'note_version', revision.version,
    'transcript_id', revision.transcript_id,
    'approved_at', approval_time,
    'confirmation', jsonb_build_object(
      'confirmed', true,
      'confirmed_at', approval_time,
      'confirmed_by', s.clinician_id
    ),
    'content', revision.content
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

create function public.approve_note(
  p_session_id uuid,
  p_note_revision_id uuid,
  p_confirmed boolean
)
returns public.approved_notes language sql security invoker set search_path = '' as $$
  select private.approve_note(p_session_id, p_note_revision_id, p_confirmed);
$$;

revoke all on function private.approve_note(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.approve_note(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.approve_note(uuid, uuid, boolean) to authenticated;
grant execute on function public.approve_note(uuid, uuid, boolean) to authenticated;
