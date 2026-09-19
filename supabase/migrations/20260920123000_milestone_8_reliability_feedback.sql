-- Milestone 8: explicit clinician follow-ups, structured evaluation feedback,
-- and repeatable fictional fixtures for reliable workflow evaluation.

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians(id),
  patient_id uuid not null,
  session_id uuid,
  action text not null check (length(btrim(action)) between 1 and 240),
  private_note text check (private_note is null or length(btrim(private_note)) between 1 and 2000),
  due_on date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (patient_id, clinician_id) references public.patients(id, clinician_id),
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id)
);
create index follow_ups_open_due_idx on public.follow_ups(clinician_id, due_on) where completed_at is null;
alter table public.follow_ups enable row level security;
create policy owner_select on public.follow_ups for select to authenticated using ((select auth.uid()) = clinician_id);
create policy owner_insert on public.follow_ups for insert to authenticated with check ((select auth.uid()) = clinician_id);
create policy owner_update on public.follow_ups for update to authenticated using ((select auth.uid()) = clinician_id) with check ((select auth.uid()) = clinician_id);
revoke all on public.follow_ups from public, anon;
grant select, insert, update on public.follow_ups to authenticated;

create table public.evaluation_feedback (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians(id),
  note_accuracy smallint not null check (note_accuracy between 1 and 5),
  missing_information text not null check (length(btrim(missing_information)) between 1 and 2000),
  correction_effort smallint not null check (correction_effort between 1 and 5),
  approval_minutes smallint not null check (approval_minutes between 0 and 240),
  usefulness smallint not null check (usefulness between 1 and 5),
  pilot_interest text not null check (pilot_interest in ('yes', 'maybe', 'no')),
  comments text check (comments is null or length(btrim(comments)) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.evaluation_feedback enable row level security;
create policy owner_select on public.evaluation_feedback for select to authenticated using ((select auth.uid()) = clinician_id);
create policy owner_insert on public.evaluation_feedback for insert to authenticated with check ((select auth.uid()) = clinician_id);
revoke all on public.evaluation_feedback from public, anon;
grant select, insert on public.evaluation_feedback to authenticated;

create function private.create_fictional_session(
  p_owner uuid,
  p_patient uuid,
  p_duration_ms integer,
  p_approved boolean,
  p_occurred_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid := gen_random_uuid();
  consent_id uuid;
  audio_id uuid;
  v_transcript_id uuid;
  patient_segment uuid;
  clinician_segment uuid;
  speaker_job_id uuid;
  revision public.note_revisions;
begin
  insert into public.sessions(id, clinician_id, patient_id, occurred_at, audio_source)
    values(v_session_id, p_owner, p_patient, p_occurred_at, 'upload');
  insert into public.consent_events(session_id, clinician_id, decision, policy_version)
    values(v_session_id, p_owner, 'granted', 'fictional-workflow-v1') returning id into consent_id;
  insert into public.audio_assets(session_id, clinician_id, consent_event_id, mime_type, byte_size, duration_ms, state)
    values(v_session_id, p_owner, consent_id, 'audio/mpeg', greatest(2048, p_duration_ms / 12), p_duration_ms, 'verified') returning id into audio_id;
  insert into public.transcripts(session_id, clinician_id, audio_asset_id, version, source, provider, model, duration_ms)
    values(v_session_id, p_owner, audio_id, 1, 'audio', 'fixture', 'fictional-dialogue-v1', p_duration_ms) returning id into v_transcript_id;
  insert into public.transcript_segments(transcript_id, session_id, clinician_id, ordinal, speaker_key, start_ms, end_ms, content)
    values(v_transcript_id, v_session_id, p_owner, 0, 'speaker_0', 0, least(18000, p_duration_ms - 2000),
      'I noticed the worry building before work. The breathing exercise helped me pause before responding.') returning id into patient_segment;
  insert into public.transcript_segments(transcript_id, session_id, clinician_id, ordinal, speaker_key, start_ms, end_ms, content)
    values(v_transcript_id, v_session_id, p_owner, 1, 'speaker_1', greatest(19000, p_duration_ms - 45000), p_duration_ms - 1000,
      'We reviewed the coping strategy and agreed to record when it is used before the next session.') returning id into clinician_segment;
  update public.transcripts set status = 'ready' where id = v_transcript_id;
  select id into speaker_job_id from public.processing_jobs
    where processing_jobs.transcript_id = v_transcript_id and kind = 'speaker_identification';
  perform public.claim_speaker_identification_job(speaker_job_id);
  perform public.complete_speaker_identification_job(
    speaker_job_id,
    jsonb_build_object('speaker_0', 'clinician', 'speaker_1', 'patient'),
    'fictional-role-check-v1'
  );
  perform public.confirm_transcript_speakers(v_transcript_id, jsonb_build_object('speaker_0', 'patient', 'speaker_1', 'clinician'));
  update public.processing_jobs set status = 'succeeded', finished_at = now(), locked_until = null
    where processing_jobs.session_id = v_session_id and status = 'queued';
  select * into revision from public.save_note_revision(v_session_id, v_transcript_id, 0, jsonb_build_object(
    'subjective', jsonb_build_array(jsonb_build_object('text', 'Reports anticipatory worry before work and benefit from paced breathing.', 'origin', 'transcript', 'segment_ids', jsonb_build_array(patient_segment))),
    'objective', jsonb_build_array(jsonb_build_object('text', 'Psychologist observed active engagement with the coping-strategy review.', 'origin', 'clinician', 'segment_ids', '[]'::jsonb)),
    'assessment', jsonb_build_array(jsonb_build_object('text', 'Patient is applying the previously discussed pause strategy.', 'origin', 'transcript', 'segment_ids', jsonb_build_array(clinician_segment))),
    'plan', jsonb_build_array(jsonb_build_object('text', 'Record each use of the strategy and review the log next session.', 'origin', 'transcript', 'segment_ids', jsonb_build_array(clinician_segment)))
  ), 'fixture', 'fictional-soap-v1');
  if p_approved then
    perform public.approve_note(v_session_id, revision.id, true);
    update public.audio_assets set state = 'deleted', deleted_at = deletion_due_at where id = audio_id;
    update public.processing_jobs set status = 'succeeded', finished_at = now(), locked_until = null
      where processing_jobs.session_id = v_session_id and kind = 'audio_deletion';
  end if;
  return v_session_id;
end;
$$;

create function private.restore_fictional_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  patient_one uuid := gen_random_uuid();
  patient_two uuid := gen_random_uuid();
  short_session uuid;
  long_session uuid;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  update public.patients
    set archived_at = coalesce(archived_at, now()), display_code = 'ARCHIVED-' || left(id::text, 8)
    where clinician_id = owner_id;

  insert into public.patients(id, clinician_id, display_code, display_name, mobile, email, location, date_of_birth, gender)
    values(patient_one, owner_id, 'FP-1042', 'Aarohi Mehta', '+919876540142', 'aarohi.fixture@example.com', 'Bengaluru', '1992-06-18', 'Woman');
  insert into public.patients(id, clinician_id, display_code, display_name, mobile, email, location, date_of_birth, gender)
    values(patient_two, owner_id, 'FP-1087', 'Kabir Rao', '+919876540187', 'kabir.fixture@example.com', 'Bengaluru', '1988-11-03', 'Man');

  short_session := private.create_fictional_session(owner_id, patient_one, 180000, true, now() - interval '2 days');
  long_session := private.create_fictional_session(owner_id, patient_one, 5400000, true, now() - interval '7 days');
  insert into public.sessions(clinician_id, patient_id, occurred_at, audio_source)
    values(owner_id, patient_two, now() - interval '3 hours', 'pending');
  insert into public.follow_ups(clinician_id, patient_id, session_id, action, private_note, due_on)
    values
      (owner_id, patient_one, short_session, 'Review coping-strategy log', 'Ask which situations made the strategy easier to use.', current_date + 2),
      (owner_id, patient_two, null, 'Confirm next appointment', null, current_date);

  return jsonb_build_object('patient_id', patient_one, 'short_session_id', short_session, 'long_session_id', long_session);
end;
$$;

create function public.restore_fictional_workspace()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.restore_fictional_workspace();
$$;

revoke all on function private.create_fictional_session(uuid,uuid,integer,boolean,timestamptz),
  private.restore_fictional_workspace(), public.restore_fictional_workspace()
  from public, anon, authenticated, service_role;
grant execute on function private.restore_fictional_workspace() to authenticated;
grant execute on function public.restore_fictional_workspace() to authenticated;
