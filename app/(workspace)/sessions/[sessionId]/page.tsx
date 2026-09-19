import Link from "next/link";
import { notFound } from "next/navigation";

import { requireClinician } from "@/lib/clinician";
import {
  AUDIO_UPLOAD_CONSENT_POLICY_VERSION,
  RECORDING_CONSENT_POLICY_VERSION,
} from "@/lib/recording-consent";
import { getSessionWorkflowCopy, SESSION_WORKFLOW, type SessionWorkflowState } from "@/lib/session-workflow";
import type { SoapDocument } from "@/lib/soap";

import { RetryButton } from "../../components";
import { FollowUpPanel } from "../../follow-up-panel";
import { AudioEntryControls } from "./audio-entry-controls";
import { SoapReview } from "./soap-review";
import { TranscriptDisclosure } from "./transcript-disclosure";
import { TranscriptionReview } from "./transcription-review";

export const maxDuration = 300;

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const workflowOrder = Object.keys(SESSION_WORKFLOW) as SessionWorkflowState[];

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { supabase, clinician } = await requireClinician();
  const [{ data: session, error: sessionError }, { data: timeline, error: timelineError }] =
    await Promise.all([
      supabase
        .from("sessions")
        .select("id, patient_id, occurred_at, audio_source")
        .eq("id", sessionId)
        .eq("clinician_id", clinician.id)
        .maybeSingle(),
      supabase
        .from("patient_timeline")
        .select("session_id, documentation_status")
        .eq("session_id", sessionId)
        .eq("clinician_id", clinician.id)
        .maybeSingle(),
    ]);

  if (sessionError || timelineError) {
    return (
      <main className="workspace-page">
        <section className="state-panel error-state" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <h1>We couldn’t load this session</h1>
            <p>Your data has not changed. Check your connection and try again.</p>
            <RetryButton />
          </div>
        </section>
      </main>
    );
  }

  if (!session || !timeline) notFound();

  const [
    { data: patient, error: patientError },
    { data: acknowledgment, error: acknowledgmentError },
    { data: audioAsset, error: audioAssetError },
    { data: transcriptionJob, error: transcriptionJobError },
    { data: speakerIdentificationJob, error: speakerIdentificationJobError },
    { data: draftingJob, error: draftingJobError },
    { data: transcript, error: transcriptError },
    { data: noteRevision, error: noteRevisionError },
    { data: noteRevisions, error: noteRevisionsError },
    { data: approvedNote, error: approvedNoteError },
  ] =
    await Promise.all([
      supabase
        .from("patients")
        .select("id, display_name, display_code")
        .eq("id", session.patient_id)
        .eq("clinician_id", clinician.id)
        .maybeSingle(),
      supabase
        .from("consent_events")
        .select("decision, policy_version, recorded_at")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .order("event_sequence", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("audio_assets")
        .select("id, mime_type, state")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .neq("state", "deleted")
        .maybeSingle(),
      supabase
        .from("processing_jobs")
        .select("id, status, attempts")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .eq("kind", "transcription")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("processing_jobs")
        .select("id, status, attempts")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .eq("kind", "speaker_identification")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("processing_jobs")
        .select("id, status, attempts")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .eq("kind", "drafting")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("transcripts")
        .select("id, source, speakers_confirmed_at, speaker_identified_at")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .eq("status", "ready")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("note_revisions")
        .select("id, transcript_id, version, content")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("note_revisions")
        .select("id, version, created_at")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .order("version", { ascending: false }),
      supabase
        .from("approved_notes")
        .select("note_revision_id, approved_at")
        .eq("session_id", session.id)
        .eq("clinician_id", clinician.id)
        .maybeSingle(),
    ]);

  if (patientError || acknowledgmentError || audioAssetError || transcriptionJobError ||
    speakerIdentificationJobError || draftingJobError || transcriptError || noteRevisionError ||
    noteRevisionsError || approvedNoteError) {
    return (
      <main className="workspace-page">
        <section className="state-panel error-state" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <h1>We couldn’t load this session</h1>
            <p>Your data has not changed. Check your connection and try again.</p>
            <RetryButton />
          </div>
        </section>
      </main>
    );
  }

  if (!patient) notFound();

  const { data: followUps, error: followUpsError } = await supabase
    .from("follow_ups")
    .select("id, action, private_note, due_on")
    .eq("patient_id", patient.id)
    .eq("clinician_id", clinician.id)
    .is("completed_at", null)
    .order("due_on");

  if (followUpsError) throw new Error("We couldn’t load the follow-ups for this session.");

  const { data: transcriptSegments, error: transcriptSegmentsError } = transcript
    ? await supabase
        .from("transcript_segments")
        .select("id, speaker_role, start_ms, end_ms, content")
        .eq("transcript_id", transcript.id)
        .eq("clinician_id", clinician.id)
        .order("ordinal")
    : { data: [], error: null };

  if (transcriptSegmentsError) {
    return (
      <main className="workspace-page">
        <section className="state-panel error-state" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <div>
            <h1>We couldn’t load this transcript</h1>
            <p>Your data has not changed. Check your connection and try again.</p>
            <RetryButton />
          </div>
        </section>
      </main>
    );
  }

  const state = (timeline.documentation_status ?? "awaiting_audio") as SessionWorkflowState;
  const stateCopy = getSessionWorkflowCopy(state);
  const activeIndex = Math.max(0, workflowOrder.indexOf(state));
  const expectedPolicyVersion = session.audio_source === "upload"
    ? AUDIO_UPLOAD_CONSENT_POLICY_VERSION
    : RECORDING_CONSENT_POLICY_VERSION;
  const acknowledgedAt = acknowledgment?.decision === "granted" &&
    acknowledgment.policy_version === expectedPolicyVersion
    ? acknowledgment.recorded_at
    : null;
  const transcriptPanel = (
    <TranscriptionReview
      job={transcriptionJob ? {
        id: transcriptionJob.id,
        status: transcriptionJob.status,
        attempts: transcriptionJob.attempts,
      } : null}
      speakerJob={speakerIdentificationJob ? {
        id: speakerIdentificationJob.id,
        status: speakerIdentificationJob.status,
        attempts: speakerIdentificationJob.attempts,
      } : null}
      segments={(transcriptSegments ?? []).map((segment) => ({
        id: segment.id,
        speakerRole: segment.speaker_role,
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        content: segment.content,
      }))}
      sessionId={session.id}
      transcript={transcript ? {
        confirmedAt: transcript.speakers_confirmed_at,
        identifiedAt: transcript.speaker_identified_at,
        source: transcript.source,
      } : null}
    />
  );

  return (
    <main className="workspace-page session-page">
      <Link className="back-link" href={`/patients/${patient.id}`}>← Back to {patient.display_name}</Link>
      <header className="session-heading">
        <div>
          <p className="section-kicker">{patient.display_code} · In-person session</p>
          <h1>Session with {patient.display_name}</h1>
          <p>{formatSessionDate(session.occurred_at)}</p>
        </div>
        <span className={`status-chip ${state === "approved" ? "" : "active-status"}`}>{stateCopy.label}</span>
      </header>

      <section className="workflow-card" aria-labelledby="workflow-heading">
        <div className="workflow-card-heading">
          <div>
            <p className="section-kicker">Current workflow state</p>
            <h2 id="workflow-heading">{stateCopy.label}</h2>
            <p>{stateCopy.detail}</p>
          </div>
        </div>
        <ol className="workflow-steps">
          {workflowOrder.map((workflowState, index) => (
            <li
              className={index < activeIndex ? "complete" : index === activeIndex ? "current" : ""}
              key={workflowState}
            >
              <span aria-hidden="true">{index < activeIndex ? "✓" : index + 1}</span>
              {SESSION_WORKFLOW[workflowState].label}
            </li>
          ))}
        </ol>
      </section>

      {state === "awaiting_audio" && (
        <section className="audio-entry-card" aria-labelledby="audio-entry-heading">
          <div>
            <p className="section-kicker">Session audio</p>
            <h2 id="audio-entry-heading">Add session audio</h2>
            <p>Record in the room or upload an existing audio file. Both paths use the same private session workflow.</p>
          </div>
          <AudioEntryControls
            initialAcknowledgedAt={acknowledgedAt}
            initialAssetMimeType={audioAsset?.mime_type ?? null}
            initialSource={session.audio_source}
            sessionId={session.id}
          />
        </section>
      )}

      {transcript?.speakers_confirmed_at ? (
        <div className="soap-primary-workspace">
          <SoapReview
            key={noteRevision?.version ?? "drafting"}
            approved={approvedNote ? {
              approvedAt: approvedNote.approved_at,
              noteRevisionId: approvedNote.note_revision_id,
            } : null}
            draftingJob={draftingJob ? {
              id: draftingJob.id,
              status: draftingJob.status,
              attempts: draftingJob.attempts,
            } : null}
            note={noteRevision ? {
              id: noteRevision.id,
              version: noteRevision.version,
              content: noteRevision.content as unknown as SoapDocument,
            } : null}
            revisions={(noteRevisions ?? []).map((revision) => ({
              id: revision.id,
              version: revision.version,
              createdAt: revision.created_at,
            }))}
            segments={(transcriptSegments ?? []).map((segment) => ({
              id: segment.id,
              startMs: segment.start_ms,
              endMs: segment.end_ms,
            }))}
            sessionId={session.id}
            transcriptId={transcript.id}
          />
          <TranscriptDisclosure>{transcriptPanel}</TranscriptDisclosure>
        </div>
      ) : ["audio_ready", "transcribed", "ready_for_review"].includes(state) ? transcriptPanel : null}

      {(noteRevision || approvedNote) && (
        <FollowUpPanel
          followUps={(followUps ?? []).map((item) => ({ id: item.id, action: item.action, privateNote: item.private_note, dueOn: item.due_on }))}
          patientId={patient.id}
          sessionId={session.id}
        />
      )}
    </main>
  );
}
