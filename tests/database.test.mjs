import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);

test('migrations and database behavior on embedded PostgreSQL', async (t) => {
  const db = new PGlite();
  try {
    // Only Supabase-owned infrastructure is stubbed. The actual migrations,
    // constraints, RLS, grants, triggers and RPCs run without modification.
    await db.exec(await readFile(new URL('tests/support/supabase.sql', root), 'utf8'));
    const migrations = (await readdir(new URL('supabase/migrations/', root))).filter((name) => name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      await t.test(migration, async () => {
        await db.exec(await readFile(new URL(`supabase/migrations/${migration}`, root), 'utf8'));
      });
    }
    await db.exec(await readFile(new URL('supabase/seed.sql', root), 'utf8'));
    const results = await db.exec(await readFile(new URL('tests/database-behavior.sql', root), 'utf8'));
    const checks = results.flatMap((result) => result.rows).filter((row) => row.check_name);
    assert.ok(checks.length >= 30, 'The behavior suite must execute all checks');
    for (const check of checks) await t.test(check.check_name, () => assert.equal(check.passed, true));

    await t.test('fictional seed is repeatable and includes short, long, follow-up, draft and approved history', async () => {
      const seed = await readFile(new URL('supabase/seed.sql', root), 'utf8');
      await db.exec(seed);
      await db.exec(seed);
      const { rows } = await db.query(`
        select
          (select count(*)::int from public.patients) as patients,
          (select count(*)::int from public.note_revisions) as revisions,
          (select count(*)::int from public.approved_notes) as approved,
          (select count(*)::int from public.follow_ups where completed_at is null) as follow_ups,
          (select count(*)::int from public.audio_assets where duration_ms = 5400000 and state = 'deleted') as long_deleted
      `);
      assert.deepEqual(rows[0], { patients: 3, revisions: 4, approved: 3, follow_ups: 2, long_deleted: 1 });

      await db.exec(`
        select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
        select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
        select public.restore_fictional_workspace();
        select public.restore_fictional_workspace();
      `);
      const restored = await db.query(`
        select
          (select count(*)::int from public.patients where archived_at is null) as active_patients,
          (select count(*)::int from public.patients where archived_at is null and display_code in ('FP-1042', 'FP-1087')) as expected_patients,
          (select count(*)::int from public.follow_ups f join public.patients p on p.id = f.patient_id where p.archived_at is null and f.completed_at is null) as open_follow_ups,
          (select count(*)::int from public.audio_assets a join public.sessions s on s.id = a.session_id join public.patients p on p.id = s.patient_id where p.archived_at is null and a.duration_ms = 5400000 and a.state = 'deleted') as active_long_deleted
      `);
      assert.deepEqual(restored.rows[0], { active_patients: 2, expected_patients: 2, open_follow_ups: 2, active_long_deleted: 1 });
    });
  } catch (error) {
    throw new Error([error.message, error.code, error.where, error.internalQuery].filter(Boolean).join('\n'));
  } finally {
    await db.close();
  }
});

test('Milestone 4 backfills transcription jobs for previously verified audio', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('tests/support/supabase.sql', root), 'utf8'));
    const migrations = (await readdir(new URL('supabase/migrations/', root)))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const migration of migrations.filter((name) => name < '20260919190544')) {
      await db.exec(await readFile(new URL(`supabase/migrations/${migration}`, root), 'utf8'));
    }

    await db.exec(`
      insert into auth.users(id, email) values ('90000000-0000-4000-8000-000000000001', 'backfill@example.test');
      insert into public.clinicians(id, display_name) values ('90000000-0000-4000-8000-000000000001', 'Backfill Psychologist');
      insert into public.patients(id, clinician_id, display_code, display_name, mobile, location)
        values ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'BACKFILL', 'Fictional Backfill Patient', '+15555550900', 'Test');
      insert into public.sessions(id, clinician_id, patient_id, audio_source)
        values ('90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'upload');
      insert into public.consent_events(id, session_id, clinician_id, decision, policy_version)
        values ('90000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 'granted', 'audio-upload-consent-v1');
      insert into public.audio_assets(id, session_id, clinician_id, consent_event_id, mime_type, byte_size, duration_ms, state)
        values ('90000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004', 'audio/mpeg', 1024, 30000, 'verified');
    `);

    await db.exec(await readFile(new URL('supabase/migrations/20260919190544_milestone_4_transcription.sql', root), 'utf8'));
    const before = await db.query("select count(*)::int as jobs from public.processing_jobs where session_id = '90000000-0000-4000-8000-000000000003'");
    assert.equal(before.rows[0].jobs, 0);

    await db.exec(await readFile(new URL('supabase/migrations/20260919192506_backfill_verified_audio_transcription_jobs.sql', root), 'utf8'));
    const after = await db.query("select count(*)::int as jobs from public.processing_jobs where session_id = '90000000-0000-4000-8000-000000000003'");
    assert.equal(after.rows[0].jobs, 1);
  } finally {
    await db.close();
  }
});
