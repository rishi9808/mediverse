-- LOCAL DEVELOPMENT ONLY. Fictional fixtures; no password or real patient data.
-- Re-running is idempotent. Use restore_fictional_workspace() for an explicit reset.
do $$
declare
  clinician uuid := '10000000-0000-4000-8000-000000000001';
  legacy_patient uuid := '20000000-0000-4000-8000-000000000001';
  session_id uuid;
  transcript_id uuid;
  patient_segment uuid;
  clinician_segment uuid;
  revision public.note_revisions;
  session_number integer;
  previous_subject text := current_setting('request.jwt.claim.sub', true);
  previous_claims text := current_setting('request.jwt.claims', true);
begin
  insert into auth.users(id, email, aud, role, email_confirmed_at, created_at, updated_at)
    values(clinician, 'psychologist@mediverse.example', 'authenticated', 'authenticated', now(), now(), now())
    on conflict(id) do nothing;
  insert into public.clinicians(id, display_name)
    values(clinician, 'Dr. Issac')
    on conflict(id) do update set display_name = excluded.display_name;

  perform set_config('request.jwt.claim.sub', clinician::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', clinician, 'role', 'authenticated', 'email', 'psychologist@mediverse.example')::text, true);
  if not exists(
    select 1 from public.patients
    where clinician_id = clinician and display_code = 'FP-1042' and archived_at is null
  ) then
    perform public.restore_fictional_workspace();
  end if;

  -- Stable identifiers retained for database behavior tests.
  insert into public.patients(id, clinician_id, display_code, display_name, mobile, email, location, date_of_birth, gender)
    values(legacy_patient, clinician, 'DEMO-001', 'Fictional Patient One', '+15555550101', 'fictional.patient@example.com', 'Bengaluru', '1990-01-15', 'Woman')
    on conflict(id) do nothing;
  for session_number in 1..2 loop
    session_id := ('30000000-0000-4000-8000-' || lpad(session_number::text, 12, '0'))::uuid;
    if exists(select 1 from public.sessions where id = session_id) then continue; end if;
    insert into public.sessions(id, clinician_id, patient_id, occurred_at, audio_source)
      values(session_id, clinician, legacy_patient, '2026-09-19 09:00:00+00'::timestamptz - (2 - session_number) * interval '7 days', 'upload');
    perform public.record_consent(session_id, 'granted', 'fictional-workflow-v1');
    insert into public.transcripts(session_id, clinician_id, version, source, provider, model, duration_ms)
      values(session_id, clinician, 1, 'seeded', 'fixture', 'fictional-english-v1', 30000) returning id into transcript_id;
    insert into public.transcript_segments(transcript_id, session_id, clinician_id, ordinal, speaker_key, speaker_role, start_ms, end_ms, content)
      values(transcript_id, session_id, clinician, 0, 'speaker_0', 'patient', 0, 10000,
        'I felt tense before work, but taking a short walk helped me settle.') returning id into patient_segment;
    insert into public.transcript_segments(transcript_id, session_id, clinician_id, ordinal, speaker_key, speaker_role, start_ms, end_ms, content)
      values(transcript_id, session_id, clinician, 1, 'speaker_1', 'clinician', 10000, 25000,
        'You described using the strategy we discussed. We agreed you will try another short walk and discuss how it went next session.') returning id into clinician_segment;
    update public.transcripts set status = 'ready' where id = transcript_id;
    perform public.confirm_transcript_speakers(transcript_id, jsonb_build_object('speaker_0', 'patient', 'speaker_1', 'clinician'));
    select * into revision from public.save_note_revision(session_id, transcript_id, 0, jsonb_build_object(
      'subjective', jsonb_build_array(jsonb_build_object('text', 'Reports tension before work and relief after a short walk.', 'origin', 'transcript', 'segment_ids', jsonb_build_array(patient_segment))),
      'objective', jsonb_build_array(jsonb_build_object('text', 'Fictional observation: engaged in the discussion.', 'origin', 'clinician', 'segment_ids', '[]'::jsonb)),
      'assessment', jsonb_build_array(jsonb_build_object('text', 'Psychologist noted use of the previously discussed strategy.', 'origin', 'transcript', 'segment_ids', jsonb_build_array(clinician_segment))),
      'plan', jsonb_build_array(jsonb_build_object('text', 'Try another short walk and review the experience next session.', 'origin', 'transcript', 'segment_ids', jsonb_build_array(clinician_segment)))
    ), 'fixture', 'fictional-soap-v1');
    if session_number = 1 then perform public.approve_note(session_id, revision.id, true); end if;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, '{}'), true);
end;
$$;
