-- New sessions defer the audio-entry choice until the session screen. Existing
-- sessions retain their selected source.
alter table public.sessions drop constraint sessions_audio_source_check;
alter table public.sessions add constraint sessions_audio_source_check
  check (audio_source in ('pending', 'recording', 'upload'));

drop trigger session_immutable on public.sessions;
create function private.guard_session_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'This record is immutable' using errcode = '23514';
  end if;
  if (new.id, new.clinician_id, new.patient_id, new.occurred_at, new.setting,
      new.language, new.client_request_id, new.created_at)
    is distinct from
     (old.id, old.clinician_id, old.patient_id, old.occurred_at, old.setting,
      old.language, old.client_request_id, old.created_at) then
    raise exception 'Session identity is immutable' using errcode = '23514';
  end if;
  if old.audio_source <> 'pending'
    or new.audio_source not in ('recording', 'upload') then
    raise exception 'Audio source is already selected' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger session_mutation_guard before update or delete on public.sessions
  for each row execute function private.guard_session_mutation();

create or replace function private.create_recording_session(p_patient_id uuid, p_client_request_id uuid)
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
    values(owner_id, p_patient_id, 'pending', p_client_request_id)
    on conflict (clinician_id, client_request_id) do nothing
    returning * into result;

  if result.id is null then
    select * into result from public.sessions
      where clinician_id = owner_id and client_request_id = p_client_request_id;
    if result.patient_id <> p_patient_id then
      raise exception 'Request id belongs to another session' using errcode = '23514';
    end if;
  end if;

  return result;
end;
$$;

create function private.select_audio_source(p_session_id uuid, p_audio_source text)
returns public.sessions language plpgsql security definer set search_path = '' as $$
declare result public.sessions;
begin
  result := private.lock_owned_session(p_session_id);
  if p_audio_source not in ('recording', 'upload') then
    raise exception 'Unsupported audio source' using errcode = '23514';
  end if;
  if result.audio_source = 'pending' then
    update public.sessions set audio_source = p_audio_source where id = result.id returning * into result;
  elsif result.audio_source <> p_audio_source then
    raise exception 'Audio source is already selected' using errcode = '23514';
  end if;
  return result;
end;
$$;
create function public.select_audio_source(p_session_id uuid, p_audio_source text)
returns public.sessions language sql security invoker set search_path = '' as $$
  select private.select_audio_source(p_session_id, p_audio_source);
$$;

create or replace function private.register_audio(p_session_id uuid, p_mime_type text)
returns public.audio_assets language plpgsql security definer set search_path = '' as $$
declare s public.sessions; consent_id uuid; result public.audio_assets;
begin
  s := private.lock_owned_session(p_session_id);
  if s.audio_source = 'pending' then
    raise exception 'Select an audio source first' using errcode = '23514';
  end if;
  consent_id := private.current_consent(s.id);
  if consent_id is null then raise exception 'Current consent required' using errcode = '23514'; end if;
  if exists(select 1 from public.approved_notes where session_id = s.id) then
    raise exception 'Session is approved' using errcode = '23514';
  end if;
  select * into result from public.audio_assets where session_id = s.id and state <> 'deleted';
  if found then
    if result.mime_type <> p_mime_type or result.consent_event_id <> consent_id or result.state = 'pending_deletion' then
      raise exception 'Existing audio does not match this request' using errcode = '23514';
    end if;
    return result;
  end if;
  insert into public.audio_assets(session_id, clinician_id, consent_event_id, mime_type)
    values (s.id, s.clinician_id, consent_id, p_mime_type) returning * into result;
  return result;
end;
$$;

-- Storage owns the byte count and MIME metadata. Duration is measured by the
-- browser but remains bounded here; later transcription is also constrained to
-- the verified duration. Repeating finalization returns the same verified row.
create function private.finalize_audio_upload(
  p_audio_asset_id uuid,
  p_duration_ms integer,
  p_expected_byte_size bigint
)
returns public.audio_assets language plpgsql security definer set search_path = '' as $$
declare
  result public.audio_assets;
  stored_size bigint;
  stored_mime text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into result from public.audio_assets
    where id = p_audio_asset_id and clinician_id = auth.uid() for update;
  if not found then raise exception 'Audio unavailable' using errcode = '42501'; end if;
  perform 1 from public.sessions where id = result.session_id for update;
  if private.current_consent(result.session_id) is distinct from result.consent_event_id then
    raise exception 'Current consent required' using errcode = '23514';
  end if;
  if p_duration_ms not between 1 and 5400000
    or p_expected_byte_size not between 1 and 52428800 then
    raise exception 'Audio limits exceeded' using errcode = '23514';
  end if;

  select coalesce(nullif(o.metadata ->> 'size', '')::bigint,
                  nullif(o.metadata ->> 'contentLength', '')::bigint),
         coalesce(o.metadata ->> 'mimetype', o.metadata ->> 'contentType')
    into stored_size, stored_mime
    from storage.objects o
    where o.bucket_id = result.bucket_id and o.name = result.object_path;
  if stored_size is null or stored_mime is null then
    raise exception 'Stored audio is not complete' using errcode = '23514';
  end if;
  if stored_size <> p_expected_byte_size or stored_size > 52428800
    or split_part(lower(stored_mime), ';', 1) <> result.mime_type then
    raise exception 'Stored audio does not match this request' using errcode = '23514';
  end if;

  if result.state = 'verified' then
    if result.byte_size <> stored_size or result.duration_ms <> p_duration_ms then
      raise exception 'Verified audio metadata does not match' using errcode = '23514';
    end if;
    return result;
  end if;
  if result.state <> 'uploading' then
    raise exception 'Audio cannot be finalized' using errcode = '23514';
  end if;

  update public.audio_assets
    set state = 'verified', byte_size = stored_size, duration_ms = p_duration_ms
    where id = result.id returning * into result;
  return result;
end;
$$;
create function public.finalize_audio_upload(
  p_audio_asset_id uuid,
  p_duration_ms integer,
  p_expected_byte_size bigint
)
returns public.audio_assets language sql security invoker set search_path = '' as $$
  select private.finalize_audio_upload(p_audio_asset_id, p_duration_ms, p_expected_byte_size);
$$;

revoke all on function private.guard_session_mutation(),
  private.select_audio_source(uuid, text), public.select_audio_source(uuid, text),
  private.finalize_audio_upload(uuid, integer, bigint), public.finalize_audio_upload(uuid, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.select_audio_source(uuid, text),
  private.finalize_audio_upload(uuid, integer, bigint) to authenticated;
grant execute on function public.select_audio_source(uuid, text),
  public.finalize_audio_upload(uuid, integer, bigint) to authenticated;
