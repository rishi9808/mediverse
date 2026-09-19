-- Session creation is an authenticated, ownership-checked, idempotent operation.
-- The client request id is generated once by the patient screen and survives
-- duplicate form submissions and network retries.
create function private.create_recording_session(p_patient_id uuid, p_client_request_id uuid)
returns public.sessions language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  result public.sessions;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_patient_id is null or p_client_request_id is null then
    raise exception 'Patient and request id are required' using errcode = '22004';
  end if;
  if not exists(
    select 1 from public.patients
    where id = p_patient_id and clinician_id = owner_id and archived_at is null
  ) then
    raise exception 'Patient unavailable' using errcode = '42501';
  end if;

  insert into public.sessions(clinician_id, patient_id, audio_source, client_request_id)
    values(owner_id, p_patient_id, 'recording', p_client_request_id)
    on conflict (clinician_id, client_request_id) do nothing
    returning * into result;

  if result.id is null then
    select * into result from public.sessions
      where clinician_id = owner_id and client_request_id = p_client_request_id;
    if result.patient_id <> p_patient_id or result.audio_source <> 'recording' then
      raise exception 'Request id belongs to another session' using errcode = '23514';
    end if;
  end if;

  return result;
end;
$$;

create function public.create_recording_session(p_patient_id uuid, p_client_request_id uuid)
returns public.sessions language sql security invoker set search_path = '' as $$
  select private.create_recording_session(p_patient_id, p_client_request_id);
$$;

revoke all on function private.create_recording_session(uuid, uuid),
  public.create_recording_session(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.create_recording_session(uuid, uuid) to authenticated;
grant execute on function public.create_recording_session(uuid, uuid) to authenticated;
