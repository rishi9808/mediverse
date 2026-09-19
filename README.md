# Mediverse

Psychologist-reviewed, evidence-linked SOAP progress notes with clinician-owned patient records.

## Development

Run commands from this Git repository (`mediverse/` inside the outer workspace):

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The clinician workspace supports a work-queue dashboard, separate patient onboarding, explicit follow-ups, patient history, private audio capture/upload, durable diarized transcription, LLM-proposed Psychologist/Patient identification with explicit clinician confirmation, evidence-linked SOAP drafting, immutable approval, approved-note PDF export, and structured psychologist feedback.

Set `OPENAI_API_KEY` in `.env` to process verified audio with `gpt-4o-transcribe-diarize`, identify speakers with an LLM, and draft SOAP with Structured Outputs. The key is server-only and must never use a `NEXT_PUBLIC_` prefix. `OPENAI_CLINICAL_MODEL` optionally overrides the pinned `gpt-4o-mini-2024-07-18` default used for speaker identification and SOAP drafting.

Production retention also requires server-only `SUPABASE_SECRET_KEY` and `CRON_SECRET` environment variables. Vercel calls `/api/cron/audio-retention` hourly with `Authorization: Bearer <CRON_SECRET>`. The worker leases due jobs, deletes the exact object through the Supabase Storage API, and only then records completion. Never expose either secret with a `NEXT_PUBLIC_` prefix.

The full confirmed transcript is sent to the drafting model. Generated statements must cite valid segment IDs; unsupported sections remain empty. Clinician-entered observations are stored with `origin: "clinician"` and no transcript citations. Processing ledgers store only bounded status/error codes—never raw audio, transcript content, prompts, or SOAP content.

## Database

- [Database design, ER diagram, permissions, and workflow contract](docs/database-design.md)
- [Migrations](supabase/migrations)
- [Local fictional seed](supabase/seed.sql)
- [Generated database types](lib/database.types.ts)
- [SOAP content types](lib/soap.ts)
- [Confirmed product scope](docs/project-report.md)

```bash
pnpm test                  # Database, PDF, and Storage-retention behavior
pnpm db:test               # PostgreSQL tests; no Docker or secrets needed
pnpm lint
pnpm exec tsc --noEmit
```

With Docker running:

```bash
pnpm db:start              # Start local Supabase
pnpm db:reset              # Rebuild LOCAL database and fictional fixtures
pnpm db:types              # Generate TypeScript types from local public schema
```

Hosted project: **Mediverse** (`fhkujbwabvsuykjkczbk`). Apply new migrations before using the latest session workflow. Local fixtures remain synthetic and must never contain real patient information. Milestone 8 adds repeatable short and exact 90-minute fixtures, reliability evidence, clinician-created follow-ups, workspace restoration, and feedback capture. Production retention still requires both server-only secrets and a deployed cron schedule.
