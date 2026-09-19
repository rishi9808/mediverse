-- Run after the fictional seed. All test mutations and helper functions roll back.
begin;
create temporary table test_results(check_name text, passed boolean);
grant insert, select on test_results to anon, authenticated, service_role;
create function pg_temp.ok(condition boolean, description text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', description; end if;
  insert into test_results values(description, true);
end;
$$;
create function pg_temp.throws(query text, expected_state text, description text) returns void language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate <> expected_state then raise exception 'FAIL: % (expected %, got %: %)', description, expected_state, sqlstate, sqlerrm; end if;
    insert into test_results values(description, true);
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', description;
end;
$$;

-- Second clinician and an unconsented session establish adversarial boundaries.
insert into auth.users(id, email) values('10000000-0000-4000-8000-000000000002', 'other@mediverse.example');
insert into public.clinicians(id, display_name) values('10000000-0000-4000-8000-000000000002', 'Other Demo Psychologist');
insert into public.patients(id, clinician_id, display_code, display_name, mobile, email, location)
values('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'OTHER-001', 'Other Fictional Patient', '+15555550102', null, 'Mysuru');
insert into public.sessions(id, clinician_id, patient_id, audio_source)
values('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'recording');

select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.clinicians'::regclass,'public.patients'::regclass,'public.sessions'::regclass,'public.consent_events'::regclass,
  'public.audio_assets'::regclass,'public.transcripts'::regclass,'public.transcript_segments'::regclass,
  'public.note_revisions'::regclass,'public.approved_notes'::regclass,'public.processing_jobs'::regclass)), 'All application tables enable RLS');
select pg_temp.ok((select not public from storage.buckets where id = 'session-audio'), 'Audio bucket is private');

set local role anon;
select pg_temp.throws('select * from public.patients', '42501', 'Anonymous patient access is denied');
select pg_temp.throws($q$select public.approve_note('30000000-0000-4000-8000-000000000001', null)$q$, '42501', 'Anonymous approval RPC is denied');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select pg_temp.ok((select count(*) = 1 from public.patients), 'Clinicians see only their own patients');
select pg_temp.ok((select count(*) = 0 from public.transcript_segments), 'Other clinician cannot read transcript evidence');
select pg_temp.ok((select count(*) = 0 from public.patient_timeline), 'Timeline view respects ownership RLS');
with changed as (update public.patients set display_name = 'Changed' where display_code = 'DEMO-001' returning id)
select pg_temp.ok(count(*) = 0, 'Cross-clinician updates affect no rows') from changed;
select pg_temp.throws($q$insert into public.patients(clinician_id, display_code, display_name, mobile, location) values('10000000-0000-4000-8000-000000000001','ATTACK','Wrong owner','+15555550103','Pune')$q$, '42501', 'Cross-clinician inserts are denied');
select pg_temp.throws($q$insert into public.sessions(clinician_id, patient_id, audio_source) values('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','upload')$q$, '23503', 'Composite FK prevents another clinician patient link');
select pg_temp.throws($q$select public.create_recording_session('20000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001')$q$, '42501', 'Session creation verifies patient ownership');
select pg_temp.throws($q$select public.record_consent('30000000-0000-4000-8000-000000000002','granted','v1')$q$, '42501', 'Consent RPC verifies ownership');
select pg_temp.throws($q$select public.approve_note('30000000-0000-4000-8000-000000000001', null)$q$, '42501', 'Approval RPC verifies ownership');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.create_recording_session('20000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001');
select public.create_recording_session('20000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*) = 1 from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001'), 'Repeated session requests create one session');
select pg_temp.ok((select t.documentation_status = 'awaiting_audio' from public.patient_timeline t join public.sessions s on s.id = t.session_id where s.client_request_id = '41000000-0000-4000-8000-000000000001'), 'New session exposes its current workflow state');
select public.record_consent(id, 'granted', 'audio-upload-consent-v1') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001';
select pg_temp.throws($q$select public.register_audio(id, 'audio/mpeg') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001'$q$, '23514', 'Audio registration requires a selected source');
select public.select_audio_source(id, 'upload') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001';
select public.select_audio_source(id, 'upload') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001';
select pg_temp.throws($q$select public.select_audio_source(id, 'recording') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001'$q$, '23514', 'Audio source cannot change after selection');
select public.register_audio(id, 'audio/mpeg') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001';
insert into storage.objects(bucket_id, name, metadata)
  select bucket_id, object_path, '{"size":2048,"mimetype":"audio/mpeg"}' from public.audio_assets
  where session_id = (select id from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001');
select pg_temp.throws($q$select public.finalize_audio_upload(id, 5400001, 2048) from public.audio_assets where session_id = (select id from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001')$q$, '23514', 'Finalization enforces the 90 minute limit');
select pg_temp.throws($q$select public.finalize_audio_upload(id, 30000, 2047) from public.audio_assets where session_id = (select id from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001')$q$, '23514', 'Finalization verifies the stored byte size');
select public.finalize_audio_upload(id, 30000, 2048) from public.audio_assets where session_id = (select id from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001');
select public.finalize_audio_upload(id, 30000, 2048) from public.audio_assets where session_id = (select id from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001');
select pg_temp.ok((select state = 'verified' and byte_size = 2048 and duration_ms = 30000 from public.audio_assets where session_id = (select id from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001')), 'Upload finalization is verified and idempotent');
select public.record_consent(id, 'revoked', 'audio-upload-consent-v1') from public.sessions where client_request_id = '41000000-0000-4000-8000-000000000001';
select pg_temp.ok((select mobile = '+15555550101' and email = 'fictional.patient@example.com' and location = 'Bengaluru' from public.patients where id = '20000000-0000-4000-8000-000000000001'), 'Owner can read patient contact details');
select pg_temp.throws($q$insert into public.patients(clinician_id,display_code,display_name,mobile,location) values('10000000-0000-4000-8000-000000000001','BAD-MOBILE','Bad Mobile','9876543210','Pune')$q$, '23514', 'Patient mobile requires an international country code');
select pg_temp.throws($q$insert into public.patients(clinician_id,display_code,display_name,mobile,email,location) values('10000000-0000-4000-8000-000000000001','BAD-EMAIL','Bad Email','+15555550104','invalid','Pune')$q$, '23514', 'Malformed patient email is rejected');
select pg_temp.throws($q$update public.patients set clinician_id = '10000000-0000-4000-8000-000000000002'$q$, '42501', 'Client cannot transfer patient ownership');
select pg_temp.throws($q$select public.register_audio('30000000-0000-4000-8000-000000000003','audio/webm')$q$, '23514', 'Audio requires session consent');
select public.record_consent('30000000-0000-4000-8000-000000000003','granted','demo-v1');
select public.record_consent('30000000-0000-4000-8000-000000000003','granted','demo-v1');
select pg_temp.ok((select count(*) = 1 from public.consent_events where session_id = '30000000-0000-4000-8000-000000000003'), 'Consent retries preserve the original event');
select pg_temp.ok((select decision = 'granted' and policy_version = 'demo-v1' and recorded_at is not null from public.consent_events where session_id = '30000000-0000-4000-8000-000000000003'), 'Recording acknowledgment preserves decision, policy version, and timestamp');
select public.register_audio('30000000-0000-4000-8000-000000000003','audio/webm');
select public.register_audio('30000000-0000-4000-8000-000000000003','audio/webm');
select pg_temp.ok((select count(*) = 1 from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003'), 'Repeated audio registration returns one asset');
select pg_temp.throws($q$insert into storage.objects(bucket_id,name) values('session-audio','unregistered/path')$q$, '42501', 'Unregistered storage object paths are denied');
insert into storage.objects(bucket_id,name,metadata) select bucket_id, object_path, '{"size":1000,"mimetype":"audio/webm"}' from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003';
select pg_temp.ok((select count(*) = 1 from storage.objects), 'Owner can upload and read registered audio');
with changed as (update storage.objects set name = 'replacement' returning id)
select pg_temp.ok(count(*) = 0, 'Client cannot overwrite stored audio') from changed;
select pg_temp.throws($q$update public.audio_assets set duration_ms = 1000$q$, '42501', 'Client cannot assert verified media metadata');

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.throws($q$update public.audio_assets set state = 'verified', duration_ms = 5400001, byte_size = 1000 where session_id = '30000000-0000-4000-8000-000000000003'$q$, '23514', 'Audio over 90 minutes is rejected');
select pg_temp.throws($q$update public.audio_assets set state = 'verified', duration_ms = 5400000, byte_size = 52428801 where session_id = '30000000-0000-4000-8000-000000000003'$q$, '23514', 'Audio over the separate file-size limit is rejected');
update public.audio_assets set state = 'verified', duration_ms = 5400000, byte_size = 1000 where session_id = '30000000-0000-4000-8000-000000000003';
select pg_temp.ok((select duration_ms = 5400000 from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003'), 'Exactly 90 minutes is accepted');
select pg_temp.ok((select count(*) = 1 from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and kind = 'transcription' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003')), 'Verified audio atomically enqueues one transcription job');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.claim_transcription_job(id) from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003');
select public.fail_transcription_job(id, 'OPENAI_UNAVAILABLE') from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003');
select public.claim_transcription_job(id) from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003');
select public.fail_transcription_job(id, 'OPENAI_UNAVAILABLE') from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003');
select public.claim_transcription_job(id) from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003');
select public.fail_transcription_job(id, 'OPENAI_UNAVAILABLE') from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003');
select pg_temp.ok((select status = 'failed' and attempts = 3 and error_code = 'OPENAI_UNAVAILABLE' and locked_until is null from public.processing_jobs where session_id = '30000000-0000-4000-8000-000000000003' and request_key = (select id from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003')), 'Transcription retries stop after three sanitized attempts');
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.processing_jobs(session_id,clinician_id,kind,request_key) values('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','transcription','40000000-0000-4000-8000-000000000001');
select pg_temp.throws($q$insert into public.processing_jobs(session_id,clinician_id,kind,request_key) values('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','transcription','40000000-0000-4000-8000-000000000001')$q$, '23505', 'Job request keys prevent duplicate processing');
select pg_temp.throws($q$insert into public.approved_notes(session_id,clinician_id,note_revision_id,snapshot) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}')$q$, '42501', 'Worker role cannot manufacture approval');
insert into public.transcripts(id,session_id,clinician_id,audio_asset_id,version,source,provider,model,duration_ms)
select '50000000-0000-4000-8000-000000000003',session_id,clinician_id,id,1,'audio','test','test',30000
from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000003';
select pg_temp.throws($q$insert into public.transcript_segments(transcript_id,session_id,clinician_id,ordinal,speaker_key,start_ms,end_ms,content) values('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',0,'speaker_0',0,30001,'too long')$q$, '23514', 'Segment timestamps cannot exceed source duration');
insert into public.transcript_segments(transcript_id,session_id,clinician_id,ordinal,speaker_key,start_ms,end_ms,content)
values('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',0,'speaker_0',0,30000,'Fictional test speech.');
update public.transcripts set status = 'ready' where id = '50000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select pg_temp.throws($q$select public.save_note_revision('30000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003',0,'{"subjective":[],"objective":[],"assessment":[],"plan":[]}')$q$, '23514', 'Unconfirmed speaker roles block drafting');
update public.transcript_segments set speaker_role = 'patient' where transcript_id = '50000000-0000-4000-8000-000000000003';
select public.confirm_transcript_speakers('50000000-0000-4000-8000-000000000003', '{"speaker_0":"patient"}');
select pg_temp.ok((select speaker_role = 'patient' from public.transcript_segments where transcript_id = '50000000-0000-4000-8000-000000000003') and (select speakers_confirmed_at is not null and speakers_confirmed_by = '10000000-0000-4000-8000-000000000001' from public.transcripts where id = '50000000-0000-4000-8000-000000000003'), 'Clinician can explicitly confirm speaker roles before drafting');
select pg_temp.throws($q$select public.save_note_revision('30000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003',0,'{"subjective":null,"objective":[],"assessment":[],"plan":[]}')$q$, '23514', 'Malformed SOAP sections are rejected');
select pg_temp.throws($q$select public.save_note_revision(session_id,transcript_id,1,jsonb_set(content,'{subjective,0,segment_ids}','["ffffffff-ffff-4fff-8fff-ffffffffffff"]')) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Unknown citations are rejected');
select pg_temp.throws($q$select public.save_note_revision(n.session_id,n.transcript_id,1,jsonb_set(n.content,'{subjective,0,segment_ids}',(select jsonb_build_array(id) from public.transcript_segments where session_id = '30000000-0000-4000-8000-000000000001' limit 1))) from public.note_revisions n where n.session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Citations from another session are rejected');
select pg_temp.throws($q$select public.save_note_revision(session_id,transcript_id,1,jsonb_set(content,'{subjective,0,segment_ids}','[]')) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Transcript-derived statements require evidence');
select pg_temp.throws($q$select public.save_note_revision(session_id,transcript_id,1,jsonb_set(content,'{subjective,0,origin}','"clinician"')) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Clinician observations cannot carry fabricated transcript citations');
select pg_temp.throws($q$select public.save_note_revision(session_id,transcript_id,0,content) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002'$q$, '40001', 'Stale draft saves fail instead of overwriting');
select public.save_note_revision(session_id,transcript_id,1,jsonb_set(content,'{objective}','[]')) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002';
select pg_temp.throws($q$select public.approve_note(session_id,id) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002' and version = 1$q$, '40001', 'Stale revision cannot be approved');
select pg_temp.throws($q$select public.approve_note(session_id,id) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002' and version = 2$q$, '23514', 'Incomplete SOAP can be saved but not approved');
select public.save_note_revision(session_id,transcript_id,2,content) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002' and version = 1;
select pg_temp.ok((select count(*) = 3 from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002'), 'Every draft save preserves prior versions');
select pg_temp.throws($q$update public.transcript_segments set speaker_role = 'other' where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Referenced speaker roles are frozen with evidence');

-- Add verified audio to the seeded draft session to exercise approval retention.
select public.register_audio('30000000-0000-4000-8000-000000000002','audio/mp4');
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.audio_assets set state = 'verified', byte_size = 1000, duration_ms = 30000 where session_id = '30000000-0000-4000-8000-000000000002';
select pg_temp.throws($q$update public.transcript_segments set content = 'Changed after citation' where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Worker cannot change cited transcript text');
select pg_temp.throws($q$insert into public.transcript_segments(transcript_id,session_id,clinician_id,ordinal,speaker_key,start_ms,end_ms,content) select id,session_id,clinician_id,99,'s',1,2,'Late addition' from public.transcripts where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Worker cannot append evidence after drafting');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.approve_note(session_id,id) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002' and version = 3;
select public.approve_note(session_id,id) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002' and version = 3;
select pg_temp.ok((select count(*) = 1 from public.approved_notes where session_id = '30000000-0000-4000-8000-000000000002'), 'Approval retries return the same snapshot');
select pg_temp.ok((select state = 'pending_deletion' and deletion_due_at = now() + interval '24 hours' from public.audio_assets where session_id = '30000000-0000-4000-8000-000000000002'), 'Approval atomically schedules audio deletion');
select pg_temp.ok((select snapshot->>'format' = 'SOAP' and not(snapshot ?| array['audio','transcript','object_path','is_fictional']) from public.approved_notes where session_id = '30000000-0000-4000-8000-000000000002'), 'Approved export snapshot excludes full transcript, storage paths, and demo markers');
update public.patients set display_name = 'Later name' where id = '20000000-0000-4000-8000-000000000001';
select pg_temp.ok((select snapshot #>> '{patient,display_name}' = 'Fictional Patient One' from public.approved_notes where session_id = '30000000-0000-4000-8000-000000000002'), 'Approval preserves patient identity at approval time');
select pg_temp.throws($q$select public.save_note_revision(session_id,transcript_id,3,content) from public.note_revisions where session_id = '30000000-0000-4000-8000-000000000002' and version = 3$q$, '23514', 'Approved sessions reject further draft saves');
select pg_temp.throws($q$select public.register_audio('30000000-0000-4000-8000-000000000002','audio/mp4')$q$, '23514', 'Approved sessions reject new audio');

reset role;
select pg_temp.throws($q$update public.approved_notes set snapshot = '{}' where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Approved snapshots resist direct SQL mutation');
select pg_temp.throws('delete from public.note_revisions', '23514', 'Draft history cannot be deleted');
select pg_temp.throws('update public.consent_events set decision = ''revoked''', '23514', 'Consent history is append-only');
select pg_temp.throws($q$update public.audio_assets set state = 'deleted', deleted_at = now() where session_id = '30000000-0000-4000-8000-000000000002'$q$, '23514', 'Audio cannot be marked deleted before its grace period');
update public.audio_assets set state = 'deleted', deleted_at = deletion_due_at where session_id = '30000000-0000-4000-8000-000000000002';
select pg_temp.ok((select count(*) = 2 from public.transcript_segments where session_id = '30000000-0000-4000-8000-000000000002'), 'Audio deletion retains transcript evidence');
select pg_temp.ok((select count(*) = 1 from public.approved_notes where session_id = '30000000-0000-4000-8000-000000000002'), 'Audio deletion retains approved note');

set local role authenticated;
select public.record_consent('30000000-0000-4000-8000-000000000003','revoked','demo-v1');
select pg_temp.ok((select count(*) = 0 from storage.objects), 'Revoked consent immediately blocks authenticated audio reads');
select pg_temp.throws($q$select public.register_audio('30000000-0000-4000-8000-000000000003','audio/webm')$q$, '23514', 'Latest consent revocation blocks new audio');
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.throws($q$update public.processing_jobs set status = 'running', locked_until = now() + interval '5 minutes' where session_id = '30000000-0000-4000-8000-000000000003'$q$, '23514', 'Revocation blocks worker job starts');
reset role;
select check_name, passed from test_results order by check_name;
rollback;
