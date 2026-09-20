# Mediverse

## Overview

Mediverse is a documentation workspace for psychologists that turns consented session audio into evidence-linked SOAP progress notes. Clinicians can manage patient records, record or upload a consultation, review the transcript and draft, approve the final note, and export it as a PDF.

The hackathon prototype uses fictional patients and sessions and focuses on English, in-person consultations.

## Problem Statement

Writing progress notes after a consultation adds administrative work. Turning a long conversation into a concise record also makes it difficult to check where a summary came from. Psychologists need a drafting workflow that keeps the source evidence accessible and leaves the final documentation under their control.

## Solution

Mediverse connects the documentation workflow in one place: patient record → consent → audio → speaker-labelled transcript → SOAP draft → clinician review → approval → PDF.

SOAP organizes a note into **Subjective, Objective, Assessment, and Plan**. AI-generated statements link to transcript segments so the psychologist can inspect their sources. Clinicians can edit the draft and add observations that were not spoken aloud. Explicit approval creates an immutable note snapshot that remains available in the patient's history.

## Features

- **Clinician workspace:** authenticated access, a work queue, patient onboarding, patient history, and follow-up tracking.
- **Consent and audio capture:** record an in-person session or upload audio, with limits of 90 minutes and 50 MiB.
- **Speaker-labelled transcription:** Deepgram transcription with diarization, automatic psychologist/patient identification, and a speaker-review workflow.
- **Evidence-linked SOAP drafts:** structured AI output with transcript references and separately identified clinician observations.
- **Review and approval:** editable drafts, revision tracking, and immutable approved notes.
- **PDF export:** download an approved note without including the full transcript by default.
- **Audio retention:** a scheduled deletion worker removes due audio while retaining transcripts and note evidence; deployment configuration is required.
- **Prototype feedback:** structured psychologist feedback and repeatable fictional workspace fixtures.

## Tech Stack

- **Frontend:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, and custom CSS.
- **Backend:** Next.js Server Actions and Route Handlers, with PostgreSQL functions for workflow rules.
- **Database:** Supabase PostgreSQL with row-level security and versioned SQL migrations.
- **APIs / Services:** Supabase Auth and private Storage; Deepgram Nova-3; OpenAI for structured SOAP drafting and speaker identification, plus an alternative transcription path.
- **Hosting / Deployment:** Vercel configuration, including a daily audio-retention cron compatible with the Hobby plan; Supabase for hosted backend services. A live deployment URL is still to be added.
- **Other Tools:** pnpm, Supabase CLI, PGlite, Node.js test runner, ESLint, pdf-lib, and tus-js-client for resumable uploads.

## Codex / OpenAI Usage

OpenAI is part of the application's core drafting workflow. The complete transcript is supplied to a model to identify speaker roles and produce a SOAP draft using Structured Outputs. The default text model is `gpt-4o-mini-2024-07-18`, configurable through `OPENAI_CLINICAL_MODEL`. Application and database validation check output structure and transcript references before saving the draft.

Deepgram Nova-3 handles transcription when configured. OpenAI `gpt-4o-transcribe-diarize` provides the alternative when the Deepgram key is absent, or when `TRANSCRIPTION_PROVIDER=openai` is selected.

Codex assisted with inspecting the implementation and preparing this project documentation, including checking features, dependencies, and local setup requirements against the repository.

AI helps turn conversation content into an organized first draft. The psychologist remains responsible for reviewing, correcting, and approving the note; valid references alone do not establish clinical accuracy.

## Demo

### Live Demo

**To add:** deployed project URL and judge access instructions.

### Demo / Pitch Video

**To add:** demo or pitch video link.

Suggested walkthrough: introduce the documentation problem, open a fictional patient, show consent and audio entry, inspect a transcript-linked SOAP draft, approve it, and download the PDF.

## Screenshots

**To add before submission:** screenshots of the clinician dashboard, patient timeline, SOAP review with transcript evidence, and approved PDF. Use fictional data only.

## How to Run Locally

Prerequisites: Node.js compatible with the pinned Next.js and pnpm versions, pnpm 11.0.6, Docker for local Supabase, and API keys for live AI processing.

```bash
git clone <repo-url>
cd <project-folder>
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:reset
```

The clone URL is still to be supplied. In the current workspace, the Git repository is the inner `mediverse/` directory; run these commands there. `pnpm db:reset` rebuilds the **local** database and loads fictional fixtures.

Create `.env.local` in the repository root with your own values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<local Supabase API URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local Supabase publishable key>
OPENAI_API_KEY=<your OpenAI API key>
DEEPGRAM_API_KEY=<your Deepgram API key>
```

Use the local URL and public key reported by Supabase. Keep OpenAI and Deepgram keys server-only, without a `NEXT_PUBLIC_` prefix. Deepgram is optional if you use OpenAI transcription; OpenAI is still required for live SOAP generation.

In local Supabase Studio, create a confirmed email/password test user. The app creates its clinician profile on first authenticated access. The seeded `psychologist@mediverse.example` record has no password and is not a ready-to-use login. A newly created user has a separate workspace; use the fictional workspace restoration control on the Feedback page to populate it.

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the test account.

For production audio retention, also configure server-only `SUPABASE_SECRET_KEY` and `CRON_SECRET`. The Vercel schedule in `vercel.json` calls `/api/cron/audio-retention` daily at midnight UTC (`0 0 * * *`) with bearer authentication. On the Hobby plan, invocation can occur anywhere within the scheduled hour. Due audio is deleted on the next successful run after its retention deadline, so daily scheduling adds roughly a day of possible cleanup delay. Running the development server alone does not schedule deletion jobs.

### Checks and maintenance

```bash
pnpm test                 # Database, clinical pipeline, transcription, PDF, and retention tests
pnpm db:test              # PostgreSQL behavior through PGlite; no Docker or secrets required
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm db:types             # Regenerate types from a running local Supabase instance
```

For a manual demo check, sign in, open a fictional patient, capture consent, upload short fictional audio, review speaker attribution and SOAP evidence, approve the note, and inspect its downloaded PDF and patient-history entry.

## Additional Notes

- **Prototype scope:** fictional data only. Clinical accuracy, time savings, and suitability for a real-patient pilot have not been established.
- **Current limits:** English, in-person sessions and two-speaker review. Appointment scheduling, guardian consent, multilingual support, more than two speakers, amendments after approval, and EMR integration are not yet covered.
- **Long sessions:** the application enforces a 90-minute limit and includes boundary fixtures. Seeded fixtures do not prove live transcription reliability or note quality for a full-length recording.
- **Human review:** evidence links support review but do not guarantee that generated claims accurately reflect their sources.
- **Retention:** audio deletion uses a 24-hour prototype grace period after approval and requires a configured worker. This is a prototype setting, not a validated real-patient retention policy.
- **Next steps:** gather psychologist feedback, evaluate factual support and correction effort, test full-length sessions, and assess real-patient pilot requirements before expanding to other specialties.

Further implementation details:

- [Database design, permissions, and workflow contract](docs/database-design.md)
- [Database migrations](supabase/migrations)
- [Fictional local seed](supabase/seed.sql)
- [Generated database types](lib/database.types.ts)
- [SOAP content types](lib/soap.ts)
- [Original product discovery and scope report](docs/project-report.md) — planning context; some implementation descriptions predate the current build.
