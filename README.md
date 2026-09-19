# Mediverse

Psychologist-reviewed, evidence-linked SOAP progress notes with clinician-owned patient records.

## Development

Run commands from this Git repository (`mediverse/` inside the outer workspace):

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The clinician workspace supports patient onboarding, contact-detail editing, session history, private audio capture/upload, durable diarized transcription, LLM-proposed Psychologist/Patient identification with explicit clinician confirmation, and evidence-linked SOAP drafting. The database foundation is implemented on Supabase Postgres: clinician ownership, patients/sessions, consent, private audio, transcript evidence, versioned SOAP drafts, immutable approval, and processing/retention metadata.

Set `OPENAI_API_KEY` in `.env` to process verified audio with `gpt-4o-transcribe-diarize`, identify speakers with an LLM, and draft SOAP with Structured Outputs. The key is server-only and must never use a `NEXT_PUBLIC_` prefix. `OPENAI_CLINICAL_MODEL` optionally overrides the pinned `gpt-4o-mini-2024-07-18` default used for speaker identification and SOAP drafting.

The full confirmed transcript is sent to the drafting model. Generated statements must cite valid segment IDs; unsupported sections remain empty. Clinician-entered observations are stored with `origin: "clinician"` and no transcript citations. Processing ledgers store only bounded status/error codes—never raw audio, transcript content, prompts, or SOAP content.

## Database

- [Database design, ER diagram, permissions, and workflow contract](docs/database-design.md)
- [Migrations](supabase/migrations)
- [Local fictional seed](supabase/seed.sql)
- [Generated database types](lib/database.types.ts)
- [SOAP content types](lib/soap.ts)
- [Confirmed product scope](docs/project-report.md)

```bash
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

Hosted project: **Mediverse** (`fhkujbwabvsuykjkczbk`). Apply new migrations before using the latest session workflow. Local fixtures remain synthetic and must never contain real patient information. Media deletion workers and PDF rendering are separate implementation work. The schema schedules deletion and preserves evidence; it does not itself remove audio bytes.
