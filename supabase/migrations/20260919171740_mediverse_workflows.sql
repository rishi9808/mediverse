-- Privileged implementations stay outside the exposed API schema. Each user RPC
-- authenticates and locks the owned session; public wrappers remain invokers.
create function private.lock_owned_session(p_session_id uuid)
returns public.sessions language plpgsql security definer set search_path = '' as $$
declare result public.sessions;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into result from public.sessions where id = p_session_id and clinician_id = auth.uid() for update;
  if not found then raise exception 'Session unavailable' using errcode = '42501'; end if;
  return result;
end;
$$;

create function private.current_consent(p_session_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select case when decision = 'granted' then id else null end
  from public.consent_events where session_id = p_session_id order by event_sequence desc limit 1;
$$;

create function private.reject_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'This record is immutable; create a new version' using errcode = '23514';
end;
$$;
create trigger consent_immutable before update or delete on public.consent_events for each row execute function private.reject_mutation();
create trigger note_revision_immutable before update or delete on public.note_revisions for each row execute function private.reject_mutation();
create trigger approved_note_immutable before update or delete on public.approved_notes for each row execute function private.reject_mutation();
create trigger session_immutable before update or delete on public.sessions for each row execute function private.reject_mutation();

create function private.record_consent(p_session_id uuid, p_decision text, p_policy_version text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.sessions; event_id uuid; previous_event public.consent_events;
begin
  s := private.lock_owned_session(p_session_id);
  select * into previous_event from public.consent_events where session_id = s.id order by event_sequence desc limit 1;
  if found and previous_event.decision = p_decision and previous_event.policy_version = p_policy_version then
    return previous_event.id;
  end if;
  insert into public.consent_events(session_id, clinician_id, decision, policy_version)
    values(s.id, s.clinician_id, p_decision, p_policy_version) returning id into event_id;
  -- Revocation stops new processing and schedules any remaining audio for removal.
  if p_decision = 'revoked' then
    update public.audio_assets set state = 'pending_deletion', deletion_due_at = now()
      where session_id = s.id and state <> 'deleted';
  end if;
  return event_id;
end;
$$;
create function public.record_consent(p_session_id uuid, p_decision text, p_policy_version text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.record_consent(p_session_id, p_decision, p_policy_version);
$$;

create function private.register_audio(p_session_id uuid, p_mime_type text)
returns public.audio_assets language plpgsql security definer set search_path = '' as $$
declare s public.sessions; consent_id uuid; result public.audio_assets;
begin
  s := private.lock_owned_session(p_session_id);
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
create function public.register_audio(p_session_id uuid, p_mime_type text)
returns public.audio_assets language sql security invoker set search_path = '' as $$
  select private.register_audio(p_session_id, p_mime_type);
$$;

-- Verify audio on a trusted worker after inspecting the stored file, never from
-- browser-supplied duration or file-size values. Deletion is acknowledged only
-- AFTER Storage API removal succeeds; the database does not delete blob bytes.
create function private.guard_audio_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id = old.session_id for update;
  if (new.id, new.session_id, new.clinician_id, new.consent_event_id, new.bucket_id, new.mime_type, new.created_at)
    is distinct from (old.id, old.session_id, old.clinician_id, old.consent_event_id, old.bucket_id, old.mime_type, old.created_at) then
    raise exception 'Audio identity is immutable' using errcode = '23514';
  end if;
  if old.state = 'deleted' or (new.state <> old.state and not (
    (old.state = 'uploading' and new.state in ('verified', 'pending_deletion')) or
    (old.state = 'verified' and new.state = 'pending_deletion') or
    (old.state = 'pending_deletion' and new.state = 'deleted')
  )) then raise exception 'Invalid audio state transition' using errcode = '23514'; end if;
  if new.state = 'verified' and private.current_consent(new.session_id) is null then
    raise exception 'Current consent required' using errcode = '23514';
  end if;
  if old.state <> 'uploading' and (new.duration_ms, new.byte_size) is distinct from (old.duration_ms, old.byte_size) then
    raise exception 'Verified media metadata is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger audio_update_guard before update on public.audio_assets for each row execute function private.guard_audio_update();
create trigger audio_no_delete before delete on public.audio_assets for each row execute function private.reject_mutation();

-- All evidence writes use the same session lock as save/approval. Once a
-- transcript has been cited by any saved revision, its text and roles freeze.
create function private.guard_transcript()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_transcript_id uuid; s_id uuid; max_duration integer;
begin
  if tg_op = 'DELETE' then raise exception 'Retained evidence cannot be deleted' using errcode = '23514'; end if;
  s_id := new.session_id;
  if tg_table_name = 'transcripts' then v_transcript_id := new.id;
  else v_transcript_id := new.transcript_id; end if;
  perform 1 from public.sessions where id = s_id for update;
  if auth.uid() is not null and new.clinician_id <> auth.uid() then
    raise exception 'Session unavailable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.session_id, new.clinician_id) is distinct from (old.id, old.session_id, old.clinician_id) then
      raise exception 'Evidence identity is immutable' using errcode = '23514';
    end if;
    if tg_table_name = 'transcript_segments' then
      if new.transcript_id <> old.transcript_id then
        raise exception 'Evidence identity is immutable' using errcode = '23514';
      end if;
    end if;
  end if;
  if private.current_consent(s_id) is null then raise exception 'Current consent required' using errcode = '23514'; end if;
  if exists(select 1 from public.approved_notes where session_id = s_id)
    or exists(select 1 from public.note_revisions r where r.transcript_id = v_transcript_id) then
    raise exception 'Evidence is frozen; create a new transcript version' using errcode = '23514';
  end if;
  if tg_table_name = 'transcripts' then
    if new.source = 'audio' and not exists(select 1 from public.audio_assets a
      where a.id = new.audio_asset_id and a.session_id = s_id and a.clinician_id = new.clinician_id
        and a.state = 'verified' and new.duration_ms <= a.duration_ms) then
      raise exception 'Verified session audio required' using errcode = '23514';
    end if;
    if new.status = 'ready' and not exists(select 1 from public.transcript_segments where transcript_segments.transcript_id = new.id) then
      raise exception 'A ready transcript needs segments' using errcode = '23514';
    end if;
    if exists(select 1 from public.transcript_segments where transcript_segments.transcript_id = new.id and end_ms > new.duration_ms) then
      raise exception 'Segment exceeds transcript duration' using errcode = '23514';
    end if;
  else
    select duration_ms into max_duration from public.transcripts where id = new.transcript_id;
    if new.end_ms > max_duration then raise exception 'Segment exceeds transcript duration' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger transcript_guard before insert or update or delete on public.transcripts for each row execute function private.guard_transcript();
create trigger segment_guard before insert or update or delete on public.transcript_segments for each row execute function private.guard_transcript();

create function private.validate_soap(p_content jsonb, p_transcript_id uuid, p_complete boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare section_name text; statement jsonb; segment_id text; source_count integer;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' or
    not (p_content ?& array['subjective','objective','assessment','plan']) or
    (p_content - array['subjective','objective','assessment','plan']) <> '{}'::jsonb then
    raise exception 'SOAP requires exactly subjective, objective, assessment and plan' using errcode = '23514';
  end if;
  foreach section_name in array array['subjective','objective','assessment','plan'] loop
    if jsonb_typeof(p_content -> section_name) <> 'array' then
      raise exception 'SOAP sections must be arrays' using errcode = '23514';
    end if;
    if jsonb_array_length(p_content -> section_name) > 100 or
      (p_complete and jsonb_array_length(p_content -> section_name) = 0) then
      raise exception 'Approval requires content in every SOAP section' using errcode = '23514';
    end if;
    for statement in select value from jsonb_array_elements(p_content -> section_name) loop
      if jsonb_typeof(statement) <> 'object' or not (statement ?& array['text','origin','segment_ids'])
        or (statement - array['text','origin','segment_ids']) <> '{}'::jsonb
        or jsonb_typeof(statement -> 'text') <> 'string'
        or length(btrim(statement ->> 'text')) not between 1 and 10000
        or jsonb_typeof(statement -> 'origin') <> 'string'
        or (statement ->> 'origin') not in ('transcript','clinician')
        or jsonb_typeof(statement -> 'segment_ids') <> 'array' then
        raise exception 'Invalid SOAP statement' using errcode = '23514';
      end if;
      source_count := jsonb_array_length(statement -> 'segment_ids');
      if ((statement ->> 'origin') = 'transcript' and source_count = 0)
        or ((statement ->> 'origin') = 'clinician' and source_count <> 0) or source_count > 100 then
        raise exception 'Transcript statements need citations; clinician observations must not fabricate citations' using errcode = '23514';
      end if;
      for segment_id in select value from jsonb_array_elements_text(statement -> 'segment_ids') loop
        if not exists(select 1 from public.transcript_segments where id::text = segment_id and transcript_id = p_transcript_id) then
          raise exception 'Citation does not belong to the selected transcript' using errcode = '23514';
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

create function private.save_note_revision(p_session_id uuid, p_transcript_id uuid, p_expected_version integer,
  p_content jsonb, p_generation_model text default null, p_prompt_version text default null)
returns public.note_revisions language plpgsql security definer set search_path = '' as $$
declare s public.sessions; latest integer; result public.note_revisions;
begin
  s := private.lock_owned_session(p_session_id);
  if private.current_consent(s.id) is null then raise exception 'Current consent required' using errcode = '23514'; end if;
  if exists(select 1 from public.approved_notes where session_id = s.id) then
    raise exception 'Session is approved' using errcode = '23514';
  end if;
  select coalesce(max(version), 0) into latest from public.note_revisions where session_id = s.id;
  if p_expected_version is distinct from latest then raise exception 'Draft version conflict' using errcode = '40001'; end if;
  if not exists(select 1 from public.transcripts where id = p_transcript_id and session_id = s.id and clinician_id = s.clinician_id and status = 'ready') then
    raise exception 'Ready session transcript required' using errcode = '23514';
  end if;
  if exists(select 1 from public.transcript_segments where transcript_id = p_transcript_id and speaker_role = 'unknown') then
    raise exception 'Confirm speaker roles before drafting' using errcode = '23514';
  end if;
  perform private.validate_soap(p_content, p_transcript_id);
  insert into public.note_revisions(session_id, clinician_id, transcript_id, version, content, generation_model, prompt_version)
    values (s.id, s.clinician_id, p_transcript_id, latest + 1, p_content, p_generation_model, p_prompt_version) returning * into result;
  return result;
end;
$$;
create function public.save_note_revision(p_session_id uuid, p_transcript_id uuid, p_expected_version integer,
  p_content jsonb, p_generation_model text default null, p_prompt_version text default null)
returns public.note_revisions language sql security invoker set search_path = '' as $$
  select private.save_note_revision(p_session_id, p_transcript_id, p_expected_version, p_content, p_generation_model, p_prompt_version);
$$;

create function private.approve_note(p_session_id uuid, p_note_revision_id uuid)
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
    'schema_version', 1, 'format', 'SOAP', 'is_fictional', true,
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
create function public.approve_note(p_session_id uuid, p_note_revision_id uuid)
returns public.approved_notes language sql security invoker set search_path = '' as $$
  select private.approve_note(p_session_id, p_note_revision_id);
$$;

create function private.guard_processing_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sessions where id = new.session_id for update;
  if tg_op = 'UPDATE' and (new.id, new.session_id, new.clinician_id, new.kind, new.request_key, new.created_at)
    is distinct from (old.id, old.session_id, old.clinician_id, old.kind, old.request_key, old.created_at) then
    raise exception 'Job identity is immutable' using errcode = '23514';
  end if;
  if new.kind <> 'audio_deletion' and new.status in ('queued','running') then
    if private.current_consent(new.session_id) is null then raise exception 'Current consent required' using errcode = '23514'; end if;
    if exists(select 1 from public.approved_notes where session_id = new.session_id) then raise exception 'Session is approved' using errcode = '23514'; end if;
    if new.kind = 'transcription' and not exists(select 1 from public.audio_assets where session_id = new.session_id and state = 'verified') then
      raise exception 'Verified session audio required' using errcode = '23514';
    end if;
    if new.kind = 'drafting' and not exists(select 1 from public.transcripts where session_id = new.session_id and status = 'ready') then
      raise exception 'Ready session transcript required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger processing_job_guard before insert or update on public.processing_jobs for each row execute function private.guard_processing_job();

-- Functions have PUBLIC execute by default. Revoke it before exposing a narrow
-- user API. Trigger-only/internal functions receive no user execute grant.
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.record_consent(uuid,text,text), public.register_audio(uuid,text),
  public.save_note_revision(uuid,uuid,integer,jsonb,text,text), public.approve_note(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_consent(uuid), private.record_consent(uuid,text,text),
  private.register_audio(uuid,text), private.save_note_revision(uuid,uuid,integer,jsonb,text,text),
  private.approve_note(uuid,uuid) to authenticated;
grant execute on function public.record_consent(uuid,text,text), public.register_audio(uuid,text),
  public.save_note_revision(uuid,uuid,integer,jsonb,text,text), public.approve_note(uuid,uuid) to authenticated;
