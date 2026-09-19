-- Fictional-data prototype. Authentication is supplied by Supabase Auth.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.clinicians (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  profession text not null default 'psychologist' check (profession = 'psychologist'),
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians(id),
  display_code text not null check (length(btrim(display_code)) between 1 and 40),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  is_fictional boolean not null default true check (is_fictional),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, clinician_id),
  unique (clinician_id, display_code)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references public.clinicians(id),
  patient_id uuid not null,
  occurred_at timestamptz not null default now(),
  setting text not null default 'in_person' check (setting = 'in_person'),
  language text not null default 'en' check (language = 'en'),
  audio_source text not null check (audio_source in ('recording', 'upload')),
  client_request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  foreign key (patient_id, clinician_id) references public.patients(id, clinician_id),
  unique (id, clinician_id),
  unique (clinician_id, client_request_id)
);
create index sessions_patient_timeline_idx on public.sessions(patient_id, clinician_id, occurred_at desc);

-- Append-only, session-specific consent covering capture/upload, transcription and AI drafting.
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  clinician_id uuid not null,
  event_sequence bigint generated always as identity,
  decision text not null check (decision in ('granted', 'revoked')),
  policy_version text not null check (length(btrim(policy_version)) between 1 and 80),
  recorded_at timestamptz not null default now(),
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id),
  unique (id, session_id, clinician_id)
);
create index consent_events_latest_idx on public.consent_events(session_id, event_sequence desc);
create index consent_events_owner_idx on public.consent_events(clinician_id);

create table public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  clinician_id uuid not null,
  consent_event_id uuid not null,
  bucket_id text not null default 'session-audio' check (bucket_id = 'session-audio'),
  object_path text generated always as (clinician_id::text || '/' || session_id::text || '/' || id::text) stored,
  mime_type text not null check (mime_type in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac')),
  byte_size bigint check (byte_size between 1 and 52428800),
  duration_ms integer check (duration_ms between 1 and 5400000),
  state text not null default 'uploading' check (state in ('uploading', 'verified', 'pending_deletion', 'deleted')),
  deletion_due_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id),
  foreign key (consent_event_id, session_id, clinician_id) references public.consent_events(id, session_id, clinician_id),
  unique (id, session_id, clinician_id),
  unique (bucket_id, object_path),
  check (state <> 'verified' or (byte_size is not null and duration_ms is not null)),
  check ((state in ('pending_deletion', 'deleted')) = (deletion_due_at is not null)),
  check ((state = 'deleted') = (deleted_at is not null)),
  check (deleted_at is null or deleted_at >= deletion_due_at)
);
create unique index audio_assets_one_active_idx on public.audio_assets(session_id) where state <> 'deleted';
create index audio_assets_owner_idx on public.audio_assets(clinician_id);
create index audio_assets_consent_idx on public.audio_assets(consent_event_id, session_id, clinician_id);
create index audio_assets_deletion_queue_idx on public.audio_assets(deletion_due_at) where state = 'pending_deletion';

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  clinician_id uuid not null,
  audio_asset_id uuid,
  version integer not null check (version > 0),
  source text not null check (source in ('audio', 'seeded')),
  provider text not null check (length(btrim(provider)) between 1 and 80),
  model text not null check (length(btrim(model)) between 1 and 120),
  language text not null default 'en' check (language = 'en'),
  duration_ms integer not null check (duration_ms between 1 and 5400000),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  created_at timestamptz not null default now(),
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id),
  foreign key (audio_asset_id, session_id, clinician_id) references public.audio_assets(id, session_id, clinician_id),
  unique (id, session_id, clinician_id),
  unique (session_id, version),
  check ((source = 'audio') = (audio_asset_id is not null))
);
create index transcripts_owner_idx on public.transcripts(clinician_id);
create index transcripts_audio_idx on public.transcripts(audio_asset_id, session_id, clinician_id);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null,
  session_id uuid not null,
  clinician_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  speaker_key text not null check (length(btrim(speaker_key)) between 1 and 80),
  speaker_role text not null default 'unknown' check (speaker_role in ('clinician', 'patient', 'other', 'unknown')),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms and end_ms <= 5400000),
  content text not null check (length(btrim(content)) between 1 and 20000),
  foreign key (transcript_id, session_id, clinician_id) references public.transcripts(id, session_id, clinician_id),
  unique (transcript_id, ordinal)
);
create index transcript_segments_owner_idx on public.transcript_segments(clinician_id);

-- SOAP is an ordered JSON document; source IDs are checked by save_note_revision.
-- Every save creates a new immutable row; there is no mutable 'current note' row.
create table public.note_revisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  clinician_id uuid not null,
  transcript_id uuid not null,
  version integer not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  generation_model text check (length(btrim(generation_model)) between 1 and 120),
  prompt_version text check (length(btrim(prompt_version)) between 1 and 80),
  created_at timestamptz not null default now(),
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id),
  foreign key (transcript_id, session_id, clinician_id) references public.transcripts(id, session_id, clinician_id),
  unique (session_id, version),
  unique (id, session_id, clinician_id)
);
create index note_revisions_owner_idx on public.note_revisions(clinician_id);
create index note_revisions_transcript_idx on public.note_revisions(transcript_id, session_id, clinician_id);

create table public.approved_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique,
  clinician_id uuid not null,
  note_revision_id uuid not null unique,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  approved_at timestamptz not null default now(),
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id),
  foreign key (note_revision_id, session_id, clinician_id) references public.note_revisions(id, session_id, clinician_id)
);
create index approved_notes_owner_idx on public.approved_notes(clinician_id);

-- A durable work ledger; provider payloads and transcript text do not belong in errors.
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  clinician_id uuid not null,
  kind text not null check (kind in ('transcription', 'drafting', 'audio_deletion')),
  request_key uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  error_code text check (error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (session_id, clinician_id) references public.sessions(id, clinician_id),
  unique (session_id, kind, request_key),
  check ((status = 'running') = (locked_until is not null)),
  check ((status in ('succeeded', 'failed')) = (finished_at is not null))
);
create index processing_jobs_owner_idx on public.processing_jobs(clinician_id);
create index processing_jobs_queue_idx on public.processing_jobs(available_at) where status = 'queued';
create index processing_jobs_leases_idx on public.processing_jobs(locked_until) where status = 'running';

create table private.retention_settings (
  singleton boolean primary key default true check (singleton),
  audio_grace_period interval not null default interval '24 hours'
    check (audio_grace_period between interval '0 seconds' and interval '7 days')
);
insert into private.retention_settings default values;
alter table private.retention_settings enable row level security;
revoke all on private.retention_settings from public, anon, authenticated, service_role;

-- Explicit grants work with both old and new Supabase Data API defaults.
do $$
declare table_name text;
begin
  foreach table_name in array array['clinicians', 'patients', 'sessions', 'consent_events',
    'audio_assets', 'transcripts', 'transcript_segments', 'note_revisions', 'approved_notes', 'processing_jobs']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select on public.%I to authenticated, service_role', table_name);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = %I)',
      table_name, case when table_name = 'clinicians' then 'id' else 'clinician_id' end);
  end loop;
end;
$$;

grant insert (id, display_name) on public.clinicians to authenticated;
grant update (display_name) on public.clinicians to authenticated;
create policy owner_insert on public.clinicians for insert to authenticated with check ((select auth.uid()) = id);
create policy owner_update on public.clinicians for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant insert (id, clinician_id, display_code, display_name) on public.patients to authenticated;
grant update (display_code, display_name, archived_at) on public.patients to authenticated;
create policy owner_insert on public.patients for insert to authenticated with check ((select auth.uid()) = clinician_id);
create policy owner_update on public.patients for update to authenticated using ((select auth.uid()) = clinician_id) with check ((select auth.uid()) = clinician_id);

grant insert (id, clinician_id, patient_id, occurred_at, audio_source, client_request_id) on public.sessions to authenticated;
create policy owner_insert on public.sessions for insert to authenticated with check ((select auth.uid()) = clinician_id);

grant update (speaker_role) on public.transcript_segments to authenticated;
create policy owner_update on public.transcript_segments for update to authenticated using ((select auth.uid()) = clinician_id) with check ((select auth.uid()) = clinician_id);

-- Workers can ingest evidence and progress jobs, but cannot manufacture approval.
grant insert, update on public.transcripts, public.transcript_segments, public.processing_jobs to service_role;
grant update (byte_size, duration_ms, state, deleted_at) on public.audio_assets to service_role;

create view public.patient_timeline with (security_invoker = true) as
select s.id as session_id, s.clinician_id, s.patient_id, s.occurred_at, s.audio_source,
  case
    when a.id is not null then 'approved'
    when exists (select 1 from public.note_revisions n where n.session_id = s.id) then 'ready_for_review'
    when exists (select 1 from public.transcripts t where t.session_id = s.id and t.status = 'ready') then 'transcribed'
    when exists (select 1 from public.audio_assets f where f.session_id = s.id and f.state = 'verified') then 'audio_ready'
    else 'awaiting_audio'
  end as documentation_status,
  a.id as approved_note_id, a.approved_at
from public.sessions s left join public.approved_notes a on a.session_id = s.id;
revoke all on public.patient_timeline from public, anon, authenticated, service_role;
grant select on public.patient_timeline to authenticated, service_role;
