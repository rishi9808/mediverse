-- Cover composite ownership FKs, including columns checked on parent writes.
create index approved_notes_revision_fk_idx on public.approved_notes(note_revision_id, session_id, clinician_id);
create index approved_notes_session_fk_idx on public.approved_notes(session_id, clinician_id);
create index audio_assets_session_fk_idx on public.audio_assets(session_id, clinician_id);
create index consent_events_session_fk_idx on public.consent_events(session_id, clinician_id);
create index note_revisions_session_fk_idx on public.note_revisions(session_id, clinician_id);
create index processing_jobs_session_fk_idx on public.processing_jobs(session_id, clinician_id);
create index transcript_segments_transcript_fk_idx on public.transcript_segments(transcript_id, session_id, clinician_id);
create index transcripts_session_fk_idx on public.transcripts(session_id, clinician_id);

-- Configuration is administrative only; table grants remain revoked.
create policy no_client_access on private.retention_settings for all to authenticated
  using (false) with check (false);

-- Hosted projects may ship this event-trigger helper in public. Revoking direct
-- client execution does not disable the event trigger.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
end;
$$;
