# Mediverse Phase 1 product prototype report

Updated: 19 September 2026. Status: discovery decisions captured; ready to guide a one-week fictional-data prototype.

## Purpose and current direction

Mediverse helps clinicians turn a consented consultation into a traceable draft that they review, edit, approve, and reopen later. The confirmed initial output is a concise SOAP progress note used by the psychologist for clinical documentation. The first milestone is a product prototype to show psychologists in India, gather feedback, and recruit pilot users, with English-only conversation audio. Both direct recording in Mediverse and existing audio-file upload are in scope, with a maximum of 90 minutes per session. Built-in recording targets in-person sessions with the psychologist and patient in the same room. General physicians remain a later extension.

The starting specification is [Mediverse — Phase 1 Technical Implementation](https://app.notion.com/p/3dfe35bbbf0281869848ca12171b9819). It describes a fictional-data hackathon demonstration, including authentication, patient records, consent, prerecorded audio, transcription, a DAP draft, approval, and a patient timeline. The user has now selected clinician feedback and pilot recruitment as the prototype's purpose. Its initial fictional-data boundary remains the baseline; a real-patient pilot is a later milestone whose scope has not been established.

Local inspection found a clean Git repository at `mediverse/` inside the workspace, containing a Next.js starter. No clinical workflow, context glossary, or prior architecture decisions were present. Application behavior described here is proposed, not implemented.

## Confirmed prototype scope

| Area | Decision |
| --- | --- |
| Primary user | Psychologist |
| First market | India |
| Prototype purpose | Demonstrate the workflow, gather psychologist feedback, and recruit pilot users |
| Data boundary | Fictional patients and fictional sessions only |
| Session setting | In-person, with psychologist and patient in the same room |
| Language | English conversation audio and English note output |
| Audio entry | Record in Mediverse or upload an existing recording |
| Maximum duration | 90 minutes |
| Transcription | Start with Deepgram Nova-3 Medical; retain Whisper as a benchmark candidate |
| Drafting | Complete transcript to LLM |
| Output | Concise, evidence-linked SOAP progress note |
| Human control | Psychologist edits and explicitly approves every note |
| Jev | Benchmark after the direct-LLM baseline; not required in the initial golden path |
| Retention | Delete audio after approval and a short grace period; retain the transcript for evidence |
| Export | Approved-note PDF without the full transcript by default |
| Delivery target | One week; 26 September 2026 if work begins on 19 September 2026 |
| Later expansion | General physicians, multilingual sessions, EMR integration, and real-patient pilot readiness |

## Product and evaluation recommendation

The psychologist audience, concise SOAP progress-note output, India recruitment market, and English conversation audio are confirmed. English note output is the working default matching the input language. The first drafting pipeline sends the complete transcript to an LLM to create an evidence-linked SOAP draft. Jev will be benchmarked afterward as an optional passage-labeling or citation-review component rather than made a dependency of the initial workflow. The user accepts Deepgram Nova or Whisper as transcription candidates; the recommended first integration is Deepgram Nova-3, initially evaluating Nova-3 Medical from the source plan.

A suitable initial hypothesis is: clinicians can finish an accurate note faster by reviewing a sourced draft than by writing it from scratch. This must be measured with clinicians. Neither willingness to pay nor clinical accuracy has been established.

The user has confirmed that no psychologist is currently available as a design partner. SOAP is the selected structure, but its field prompts and clinical usefulness remain product hypotheses. A fictional-session prototype provides a concrete example for recruiting psychologists and gathering feedback.

## Jev plus LLM versus direct LLM drafting

TypeSafe's primitives support bounded judgments: Noul returns the probability of a yes/no condition, while Choice and Score expose distributions and a confidence statistic. That confidence is derived from the distribution; it is not proof of clinical correctness. Thresholds need domain-specific evaluation. Sources: [Noul](https://docs.typesafe.ai/primitives/noul.md) and [Confidence](https://docs.typesafe.ai/confidence.md), fetched during this research.

| Approach | Potential value | Main trade-off | Recommendation |
| --- | --- | --- | --- |
| Full transcript → LLM → validated draft | Few processing stages; preserves conversational context; fastest baseline to evaluate | Can omit facts, invent content, or misattribute speakers despite valid JSON | Build and measure first |
| Transcript → Jev labels + full transcript → LLM | Produces reusable topic labels and a possible navigation aid without discarding source context | Adds calls, latency, costs, another service, and potentially misleading labels | Experiment after the baseline works |
| Transcript → Jev-selected excerpts only → LLM | Might reduce LLM input volume | A false-negative selection can hide information from the writer; excerpt selection may remove negation, chronology, or attribution | Do not make this the initial design |
| Transcript → LLM → Jev claim/evidence checks → clinician | Can flag citations whose context does not support the claim | A verifier can also be wrong; it does not replace clinician review | A focused alternative worth testing |

These are engineering judgments, not results of a Mediverse benchmark. No clinical head-to-head test of these pipelines was performed in this session. Hybrid processing is not automatically cheaper: if the LLM still reads the complete transcript, Jev adds work. If Jev reduces the input, savings must be weighed against missed evidence.

### A useful Jev experiment

Use context windows containing speaker identities, adjacent turns, and stable segment IDs. Ask separate questions about the presence of topics such as symptoms/functioning, therapist interventions, patient responses, agreed follow-up, and explicit safety-related discussion. Several labels can apply to one passage; separate Noul questions fit this better than forcing every passage into one exclusive category.

Do not ask one vague question such as “Is this important?” Define what each label means. Preserve speaker attribution, historical versus current statements, negation, and uncertainty. For example, “I had those thoughts years ago, but not now” must not become a claim about current intent. A safety-topic label is a review cue, not a diagnosis or risk determination.

Keep the complete transcript available to both the note-generation process and the clinician during initial evaluation. Low-confidence labels must not cause source text to disappear. If the optional label service fails, the validated baseline remains available.

For citation checking, first validate source IDs and exact quoted spans in code. Then, if useful, evaluate whether the surrounding context supports the generated claim. TypeSafe documents this split in its [citation-checking cookbook](https://docs.typesafe.ai/cookbooks/citation_check.md). A valid source ID alone does not establish support.

### How to decide which pipeline wins

Compare outputs using the same transcripts, note specification, generation model, and reviewer rubric. Use clinician-reviewed fictional cases first, including full-length sessions and difficult examples: speaker swaps, repeated topics, historical symptoms, negated statements, corrections, uncertain plans, and details introduced late in the session.

Measure factual support, important omissions, speaker/time attribution, clinician correction effort, total time to approve, cost per session, end-to-end latency, and failures. Have reviewers compare outputs without knowing the pipeline where practical. A small initial evaluation finds problems; it does not establish clinical safety. Adopt Jev only if it shows useful gains without unacceptable omission or attribution errors.

## Psychologist, psychiatrist, and general physician documentation

The user used both “psychologist” and “psychiatrist.” They describe different professions and often different encounters. Psychiatrists are medical doctors who may provide psychotherapy and prescribe medication; psychologists commonly provide psychotherapy and psychological assessment. These distinctions do not make every visit follow a fixed format. Source: [American Psychiatric Association — What is Psychiatry?](https://www.psychiatry.org/patients-families/what-is-psychiatry).

| First workflow | Typical content to support | Product implication |
| --- | --- | --- |
| Psychologist's routine therapy progress note | Session themes, relevant functioning, intervention, patient response, progress toward goals, agreed next steps | Good initial focus; validate one template with practising psychologists |
| Psychological assessment report | Referral question, history, observations, test results where used, formulation and recommendations | A different deliverable; a conversation transcript alone may be insufficient |
| Psychiatrist's follow-up note | Interval symptoms, mental status findings, medication effectiveness/tolerability, relevant safety discussion, treatment plan | Needs medication and examination inputs in addition to conversational themes |
| General physician's consultation note | Presenting complaint, history, examination/vitals, available investigations, clinician assessment and plan | Requires structured or clinician-entered facts that may never be spoken aloud |

These are workflow comparisons, not a universal mandated schema. Professional sources support the differences: [psychiatric clinical documentation](https://www.psychiatry.org/psychiatrists/practice/telepsychiatry/toolkit/clinical-documentation), [medication follow-up](https://www.psychiatry.org/patients-families/psychiatric-medications-an-overview-1), [psychotherapy treatment and response documentation](https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=56865), and [primary-care SOAP documentation](https://www.aafp.org/fpm/2007/0300/p54). US sources illustrate clinical documentation content; this report does not import their billing or legal requirements into India.

DAP and SOAP are organizational formats, not exclusive to a profession. The user selected SOAP for the first prototype. The note separates Subjective, Objective, Assessment, and Plan, while remaining concise and editable. Psychologist feedback may refine the fields later without changing the confirmed SOAP structure.

SOAP separates the patient's account (Subjective), psychologist observations or measurements (Objective), clinical interpretation and progress (Assessment), and next steps (Plan). A psychologist's local documentation requirements must still be checked with their practice. The [Palm Beach County psychology practicum handbook, pages 102–103](https://discover.pbcgov.org/youthservices/Training_Docs/PRACTICUM_Handbook.pdf) discusses SOAP and DAP as alternatives and advises choosing a template suited to the setting. This illustrates format flexibility, not an Indian documentation requirement.

For Mediverse, the psychologist must be able to add Objective observations unavailable in the transcript, such as appearance or eye contact. Generated Assessment and Plan content must reflect source-supported information and remain subject to psychologist review. The system must distinguish transcript-derived content from psychologist-entered observations rather than manufacture evidence for unspoken findings.

A progress note should also be distinguished from private therapist process notes. In the US, “psychotherapy notes” has a specific separate-record meaning; it should not be used casually as a synonym for every therapy progress note. See [CMS's discussion of the distinction](https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=56937). The product terminology and any country-specific treatment must be settled for the intended launch.

### Expansion without building every specialty now

Keep the shared concepts — clinician, patient, session, consent, transcript, draft, approval, and timeline — reusable. Add general medicine later through an explicit encounter type, validated note template, required supplemental inputs, and a separate evaluation set. A profession dropdown and a changed prompt alone do not establish support for another clinical workflow.

The AI may organize what was said and what the clinician supplies. It must not invent an examination finding, diagnosis, prescription, or treatment decision to fill a template. Distinguish patient-reported material from clinician observations and assessments. Clinician additions need their own attribution; they should not be given fabricated transcript citations.

## Language and first market

There are three separate decisions: where the initial users practise, what languages patients speak during sessions, and what language the approved note uses. India is confirmed as the first recruitment market, and the user selected English conversation audio. English note output is the working default; multilingual support is outside the initial prototype scope.

Deepgram currently lists `nova-3-medical` for English, including Indian English. Its general Nova-3 model separately lists multilingual code-switching that includes Hindi and English. This does not establish equivalent clinical accuracy across accents, mixed-language sessions, or all Indian languages. Source: [Deepgram models and languages](https://developers.deepgram.com/docs/models-languages-overview).

Use the confirmed English input scope for the fictional-session prototype, then use conversations with recruited Indian psychologists to establish their actual language needs. If their sessions predominantly use mixed-language speech, evaluate the relevant language pair before claiming the prototype fits their workflow.

Later multilingual expansion should begin with one validated language pair, preserve original-language evidence, and explicitly test meaning changes caused by transcription and translation. “Multilingual supported” should describe observed quality on the target workflow, not only a vendor's language list.

## Transcription candidates

The user proposed Deepgram Nova or Whisper. Recommendation: use Deepgram Nova-3 as the first integration, with `nova-3-medical` as the initial candidate inherited from the source plan. It supports English including Indian English, and Deepgram exposes speaker diarization and timestamped utterances useful for evidence links. Sources: [model support](https://developers.deepgram.com/docs/models-languages-overview), [speaker diarization](https://developers.deepgram.com/docs/diarization), and [utterances](https://developers.deepgram.com/docs/utterances).

This is an integration recommendation, not a claim that the medical variant is more accurate for psychotherapy or that it outperforms Whisper on Indian English. Compare relevant fictional therapy samples before finalizing the model variant. Check clinically meaningful word errors, negation, speaker attribution, timestamps, long-session processing, and total latency/cost. A speaker number does not identify the psychologist; the user must be able to confirm and correct speaker roles.

Retain Whisper as a comparison candidate. Its hosting option and version have not been selected, so no Whisper integration, automatic provider fallback, or infrastructure commitment is implied. Keep the existing seeded transcript fallback for the prototype.

## Changes needed from the Notion plan

| Source plan | Proposed change or open decision |
| --- | --- |
| Doctor used throughout | Use clinician for the common product role; resolve profession and encounter vocabulary in discovery |
| Generic final report | Confirmed: concise therapy progress note used by the psychologist |
| Upload prepared audio only | Confirmed: offer both direct recording in Mediverse and existing audio-file upload |
| One LLM call | Confirmed as the initial complete-transcript drafting baseline; benchmark optional Jev labeling or verification afterward |
| Prepared 3–5 minute audio | Confirmed: support up to 90 minutes for recording and uploads; keep a short demonstration fixture and test the full duration separately |
| Short synchronous transcription | Reassess job processing, timeouts, retry behavior, file size, and progress display for actual session duration |
| DAP recommended | Replaced by the user's confirmed SOAP progress-note format |
| Every factual claim cites transcript segments | Preserve this for generated claims; separately attribute clinician-entered observations and corrections |
| Fictional-data hackathon | Confirmed new purpose: product prototype for psychologist feedback and pilot recruitment; retain fictional sessions for this initial stage |

The consent gate, explicit clinician approval, private storage, ownership isolation, immutable approved snapshot, evidence access, persistence, and seeded fallback remain valuable requirements from the source. No new real-patient processing is authorized or performed by this report.

## Retention decision

After the psychologist approves the SOAP note, Mediverse deletes the associated session audio following a short configurable grace period and retains the transcript for evidence and review. The transcript remains separate from the approved note and must not be treated as the clinical record merely because it is retained.

The fictional-data prototype should show the audio's pending-deletion state, allow an explicit demo reset, and verify that deleting audio does not break the transcript, citations, approved note, or patient timeline. The exact grace period, transcript lifetime, deletion exceptions, and real-patient retention policy remain subject to validation before a pilot.

## Approved-note export

The first prototype provides PDF download for approved SOAP notes. The PDF includes a fictional-data banner, patient display identifier, session reference, psychologist identity, approval timestamp, SOAP content, and evidence references where useful. It excludes the full transcript and private audio/storage paths by default.

Only an approved immutable snapshot can be exported. Drafts remain editable inside Mediverse and should not produce a document that could be mistaken for an approved record. Structured EMR export, FHIR integration, bulk export, external sharing links, and transcript export remain outside the first prototype.

## Audio entry workflow

The psychologist can either record session audio directly in Mediverse or upload an existing audio recording. Both entry points lead into the same session, transcription, draft, review, approval, and history workflow. Apply the consent requirement to both paths before capture or processing as appropriate.

Built-in recording is confirmed for in-person sessions with the psychologist and patient in the same room. Online-call capture and meeting-platform integrations are outside the initial built-in recording scope. Existing audio-file upload remains a separate entry option.

The confirmed maximum audio duration is 90 minutes per session for both recording and uploads. Validate media duration and set an appropriate separate file-size limit; do not silently truncate an over-limit upload. Recording should warn before reaching its limit and preserve the captured audio when it stops. Full-duration fictional recordings must be included in reliability and note-quality evaluation.

The proposed initial processing mode is to transcribe after recording ends or an upload completes. Direct recording does not by itself imply live transcript display. Recording device, controls, interruption recovery, and file sizes will use documented implementation defaults. Evaluate recordings containing both voices under representative room conditions rather than assuming one microphone captures both equally well.

## One-week delivery plan

The target is a reviewable fictional-data prototype in seven days. If work begins on 19 September 2026, the target review date is 26 September 2026.

### Day 1 — foundation and protected data model

- Establish authentication, protected routes, fictional patient records, consent events, sessions, transcripts, drafts, approved notes, and private audio storage.
- Add seeded fictional patient, transcript, SOAP draft, and reset data.
- Confirm ownership isolation and the core session states.

### Day 2 — patient and audio workflow

- Build patient list, patient detail, consent gate, session creation, browser recording, and existing-file upload.
- Enforce the 90-minute limit and supported file rules.
- Make recording/upload failures recoverable without creating duplicate sessions.

### Day 3 — transcription

- Integrate Deepgram Nova-3 Medical for post-session transcription with diarization, utterances, timestamps, and safe retries.
- Normalize both audio paths into the same transcript-segment structure.
- Provide speaker-role confirmation and the seeded transcript fallback.

### Day 4 — evidence-linked SOAP drafting

- Generate Subjective, Objective, Assessment, and Plan from the complete transcript.
- Validate the structured output and every transcript citation.
- Leave unsupported observations visibly incomplete rather than inventing content.

### Day 5 — psychologist review and approval

- Build the transcript-and-SOAP review screen, editing, versioned saves, explicit approval, immutable approved snapshot, and patient timeline.
- Add approved-note PDF export without the full transcript.
- Implement audio pending-deletion state and deletion after the configured demo grace period.

### Day 6 — reliability and representative testing

- Test protected access, consent enforcement, duplicate retries, citation validity, refresh persistence, speaker correction, PDF output, audio deletion, and seeded fallback.
- Exercise representative short and long fictional sessions, including a 90-minute processing test.
- Fix golden-path blockers before adding polish.

### Day 7 — review package and rehearsal

- Polish the core screens and error states.
- Prepare one short fictional demonstration and one realistic long-session example.
- Rehearse the workflow, capture known limitations, and prepare the psychologist feedback questions.

### One-week scope gate

The week does not include Jev benchmarking, Whisper integration, multilingual transcription, online-call capture, general-physician templates, EMR/FHIR integration, real-patient processing, or production/compliance claims. These follow psychologist feedback and a separate pilot-readiness phase.

## Discovery record

Confirmed from the user's request: psychologists are the initial users, and the first output is a concise SOAP progress note for their clinical documentation. The first milestone is a product prototype for clinician feedback and pilot recruitment in India, using English conversation audio. Both direct recording and existing recording upload are included, with a 90-minute maximum; built-in recording targets in-person sessions. Deepgram Nova and Whisper are acceptable transcription candidates. Direct LLM drafting from the complete transcript is the first pipeline; Jev is reserved for later benchmarking. Support for general doctors is a later ambition. English note output is the working default.

Resolved decision: the user selected a concise progress note and emphasized that the psychologist will use it. The interface, terminology, and note-review workflow should address the psychologist as the user. Exact note fields, length, sharing, and access permissions are not settled by this decision.

Data-use boundary: the initial prototype retains the source plan's fictional sessions. Recruiting pilot users does not itself establish real-patient pilot scope, clinician participation, or authorization to process actual consultations.

Resolved clarification: the user does not currently have a psychologist whose workflow can guide the template. The user selected SOAP as the provisional format; recruiting reviewers and validating its fields remain future work.

Resolved milestone: the user selected the product prototype to show psychologists and recruit first pilot users. The source plan's 12-hour hackathon schedule is therefore a reference rather than the delivery schedule.

Resolved market: the user selected India for initial psychologist recruitment. No specific city or clinic type has been selected.

Resolved language: the user selected English audio and proposed Deepgram Nova or Whisper. The recommendation is to start with Deepgram Nova-3 Medical and evaluate actual therapy samples; the user has not expressed a preference between the candidates.

Resolved capture options: the user requested both direct recording in Mediverse and upload of existing audio. This replaces the source plan's upload-only restriction. Transcription after recording ends remains the proposed processing mode; live transcript display has not been requested.

Resolved recording setting: the user selected same-room sessions for built-in recording. This does not select a device, microphone, or number of recorded participants beyond establishing the in-person setting.

Resolved duration: the user selected a 90-minute maximum for both direct recording and uploaded audio.

Resolved note format: the user selected SOAP for the prototype. Subjective content comes from the patient's report, Objective content contains psychologist observations or measurements, Assessment captures clinician interpretation and progress, and Plan captures next steps. The psychologist must review and approve every section.

Resolved drafting pipeline: the user accepted direct SOAP drafting from the complete transcript using an LLM, followed by later Jev benchmarking. Jev is not required for transcription, draft creation, editing, or approval in the initial prototype.

Resolved retention: the user selected automatic audio deletion after approval while retaining the transcript for evidence and review. The working design includes a short configurable grace period and visible reset behavior; its duration and the transcript lifetime remain unvalidated for real-patient use.

Resolved export: the user selected PDF download for approved SOAP notes. The working scope exports the approved snapshot with fictional-data and approval metadata, excludes the full transcript by default, and defers structured EMR integration.

Resolved timeline: the user selected one week for the first reviewable prototype. Assuming work begins on 19 September 2026, the target review date is 26 September 2026. The one-week scope is limited to the fictional-data golden path documented above.

All core discovery questions in this interview are resolved. Implementation details not explicitly selected will use documented, reversible defaults and must preserve the confirmed scope.
