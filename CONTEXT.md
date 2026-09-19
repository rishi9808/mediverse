# Mediverse

Mediverse supports clinicians in documenting patient sessions through reviewable drafts and approved notes.

## Language

**Clinician**:
The professional responsible for reviewing and approving a patient's session documentation. The initial Mediverse user is a psychologist.
_Avoid_: Doctor when referring to all Mediverse users

**Psychologist**:
The initial clinician using Mediverse to document therapy sessions and review the resulting progress notes.
_Avoid_: Psychiatrist, general physician

**Progress note**:
A concise SOAP-structured clinical record of a therapy session for the psychologist's documentation and subsequent care. It separates the patient's account, the psychologist's observations, the psychologist's assessment, and the plan.
_Avoid_: Detailed session summary, psychological assessment report, DAP note

**SOAP progress note**:
The initial Mediverse progress-note format: Subjective, Objective, Assessment, and Plan. It remains a draft until the psychologist reviews and approves it.
_Avoid_: DAP note, psychotherapy process note

**Session**:
A documented encounter between a patient and a clinician. A patient can have multiple sessions.
_Avoid_: Recording, report

**In-person session**:
A session in which the psychologist and patient are physically present in the same room.
_Avoid_: Online consultation, video call

**Session audio**:
An audio recording of a session, captured in Mediverse or supplied as an existing recording. It is the source material for a transcript.
_Avoid_: Session, transcript

**Transcript**:
A textual representation of speech from one session. It is source material rather than an approved clinical note.
_Avoid_: Report, summary

**Transcript segment**:
A speaker-attributed, timestamped portion of a session transcript that can be referenced as evidence.
_Avoid_: Claim, note

**Draft note**:
A proposed progress note awaiting the psychologist's review and approval.
_Avoid_: Final report, approved note

**Approved note**:
A progress note that a clinician has reviewed and explicitly approved.
_Avoid_: AI output, draft

**Approved-note PDF**:
A portable rendering of an approved SOAP progress note, including approval and source-session metadata. It does not include the full transcript by default.
_Avoid_: Transcript export, editable draft

**Retained transcript**:
The session transcript kept after approval so the psychologist can review the evidence behind an approved note. It remains distinct from the approved note.
_Avoid_: Approved note, session audio

## Example dialogue

**Developer:** Is the transcript the document the clinician approves?

**Domain expert:** No. The clinician reviews the draft note against transcript segments, makes corrections, and approves the note.

**Developer:** Can a patient have another session after that?

**Domain expert:** Yes. The new session has its own transcript and draft note; the previous approved note remains part of the patient's history.

**Developer:** Who uses the progress note?

**Domain expert:** The psychologist uses it for clinical documentation and reference when providing subsequent care.

**Developer:** Does uploading an existing recording change what a session means?

**Domain expert:** No. Recording in Mediverse and uploading a recording are two ways of supplying session audio for the same documentation workflow.

**Developer:** What happens to the session audio after approval?

**Domain expert:** Mediverse deletes the audio after the grace period, while retaining the transcript as evidence for the approved note.
