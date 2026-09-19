"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  confirmTranscriptSpeakers,
  continueSpeakerIdentification,
  continueTranscription,
  retrySpeakerIdentification,
  retryTranscription,
} from "../../actions";

type Job = {
  id: string;
  status: string;
  attempts: number;
};

type Segment = {
  id: string;
  speakerKey: string;
  speakerRole: string;
  suggestedSpeakerRole: string | null;
  startMs: number;
  endMs: number;
  content: string;
};

type Transcript = {
  id: string;
  confirmedAt: string | null;
  identifiedAt: string | null;
  identificationModel: string | null;
  source: string;
};

function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function roleLabel(role: string) {
  if (role === "clinician") return "Psychologist";
  if (role === "patient") return "Patient";
  return "Unassigned speaker";
}

export function TranscriptionReview({
  job,
  speakerJob,
  segments,
  sessionId,
  transcript,
}: {
  job: Job | null;
  speakerJob: Job | null;
  segments: Segment[];
  sessionId: string;
  transcript: Transcript | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const speakers = useMemo(() => Array.from(new Set(segments.map((segment) => segment.speakerKey))), [segments]);
  const [assignments, setAssignments] = useState<Record<string, "" | "clinician" | "patient">>(() =>
    Object.fromEntries(speakers.map((speaker) => [
      speaker,
      segments.find((segment) => segment.speakerKey === speaker)?.suggestedSpeakerRole === "clinician"
        ? "clinician"
        : segments.find((segment) => segment.speakerKey === speaker)?.suggestedSpeakerRole === "patient"
          ? "patient"
          : segments.find((segment) => segment.speakerKey === speaker)?.speakerRole === "clinician"
            ? "clinician"
            : segments.find((segment) => segment.speakerKey === speaker)?.speakerRole === "patient"
              ? "patient"
              : "",
    ])),
  );
  const [message, setMessage] = useState("");
  const activeJobId = job?.id;
  const activeJobStatus = job?.status;

  useEffect(() => {
    if (!transcript && !activeJobId) {
      const discoveryTimer = window.setInterval(() => router.refresh(), 2500);
      return () => window.clearInterval(discoveryTimer);
    }
    if (!activeJobId || !activeJobStatus || !["queued", "running"].includes(activeJobStatus)) return;
    const refreshTimer = window.setInterval(() => router.refresh(), 2500);
    const resume = () => void continueTranscription(sessionId, activeJobId);
    resume();
    const resumeTimer = window.setInterval(resume, 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(resumeTimer);
    };
  }, [activeJobId, activeJobStatus, router, sessionId, transcript]);

  useEffect(() => {
    if (!speakerJob || transcript?.identifiedAt || transcript?.source !== "audio") return;
    if (!["queued", "running"].includes(speakerJob.status)) return;
    const refreshTimer = window.setInterval(() => router.refresh(), 2500);
    const resume = () => void continueSpeakerIdentification(sessionId, speakerJob.id);
    resume();
    const resumeTimer = window.setInterval(resume, 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(resumeTimer);
    };
  }, [router, sessionId, speakerJob, transcript]);

  function retry() {
    if (!job) return;
    setMessage("");
    startTransition(async () => {
      const result = await retryTranscription(sessionId, job.id);
      if (!result.ok) setMessage(result.message);
      router.refresh();
    });
  }

  function confirmSpeakers() {
    if (!transcript) return;
    const completeAssignments = Object.fromEntries(
      Object.entries(assignments).filter((entry): entry is [string, "clinician" | "patient"] => entry[1] !== ""),
    );
    if (Object.keys(completeAssignments).length !== speakers.length) {
      setMessage("Assign every speaker before confirming.");
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await confirmTranscriptSpeakers(sessionId, transcript.id, completeAssignments);
      setMessage(result.ok ? "Speaker roles confirmed. SOAP drafting is now unlocked." : result.message);
      router.refresh();
    });
  }

  function retryIdentification() {
    if (!speakerJob) return;
    setMessage("");
    startTransition(async () => {
      const result = await retrySpeakerIdentification(sessionId, speakerJob.id);
      if (!result.ok) setMessage(result.message);
      router.refresh();
    });
  }

  if (!transcript) {
    const status = job?.status ?? "missing";
    const failed = status === "failed";
    return (
      <section className="transcription-card" aria-labelledby="transcription-heading">
        <div className="transcription-heading-row">
          <div>
            <p className="section-kicker">Private background processing</p>
            <h2 id="transcription-heading">{failed ? "Transcription unavailable" : "Transcribing session audio"}</h2>
            <p>
              {failed
                ? "The audio was not transcribed. The fictional seeded transcript remains available in the demo sessions."
                : "You can leave this page. Progress and bounded retry attempts are saved with the session."}
            </p>
          </div>
          <span className={`status-chip ${failed ? "" : "active-status"}`}>
            {status === "running"
              ? "Processing"
              : status === "queued"
                ? "Queued"
                : status === "missing"
                  ? "Preparing"
                  : "Needs attention"}
          </span>
        </div>
        {job && <p className="processing-meta">Attempt {Math.min(job.attempts, 3)} of 3</p>}
        {!failed && <progress className="indeterminate-progress" aria-label="Transcription in progress" />}
        {failed && job && job.attempts < 3 && (
          <button className="primary-button" disabled={pending} type="button" onClick={retry}>
            {pending ? "Retrying…" : "Retry transcription"}
          </button>
        )}
        {message && <p className="audio-error" role="alert">{message}</p>}
      </section>
    );
  }

  if (transcript.source === "audio" && !transcript.identifiedAt) {
    const failed = speakerJob?.status === "failed";
    return (
      <section className="transcription-card" aria-labelledby="speaker-identification-heading">
        <div className="transcription-heading-row">
          <div>
            <p className="section-kicker">LLM speaker identification</p>
            <h2 id="speaker-identification-heading">
              {failed ? "Speaker identification needs attention" : "Identifying Psychologist and Patient"}
            </h2>
            <p>The complete dialogue is being analyzed by the language model before your required confirmation.</p>
          </div>
          <span className={`status-chip ${failed ? "" : "active-status"}`}>
            {speakerJob?.status === "running" ? "Processing" : failed ? "Needs attention" : "Queued"}
          </span>
        </div>
        {speakerJob && <p className="processing-meta">Attempt {Math.min(speakerJob.attempts, 3)} of 3</p>}
        {!failed && <progress className="indeterminate-progress" aria-label="Speaker identification in progress" />}
        {failed && speakerJob && speakerJob.attempts < 3 && (
          <button className="primary-button" disabled={pending} type="button" onClick={retryIdentification}>
            {pending ? "Retrying…" : "Retry speaker identification"}
          </button>
        )}
        {message && <p className="audio-error" role="alert">{message}</p>}
      </section>
    );
  }

  return (
    <section className="transcription-card" aria-labelledby="transcript-review-heading">
      <div className="transcription-heading-row">
        <div>
          <p className="section-kicker">Speaker-attributed transcript</p>
          <h2 id="transcript-review-heading">Review and confirm speakers</h2>
          <p>Review the LLM’s role suggestions, correct them if needed, then confirm before SOAP drafting.</p>
        </div>
        <span className={`status-chip ${transcript.confirmedAt ? "" : "active-status"}`}>
          {transcript.confirmedAt ? "Speakers confirmed" : "Confirmation required"}
        </span>
      </div>

      {!transcript.confirmedAt && (
        <div className="speaker-assignments">
          {speakers.map((speaker, index) => (
            <label key={speaker}>
              <span>Speaker {index + 1} <small>{speaker} · LLM suggestion</small></span>
              <select
                value={assignments[speaker] ?? ""}
                onChange={(event) => setAssignments((current) => ({
                  ...current,
                  [speaker]: event.target.value as "" | "clinician" | "patient",
                }))}
              >
                <option value="">Choose role</option>
                <option value="clinician">Psychologist</option>
                <option value="patient">Patient</option>
              </select>
            </label>
          ))}
        </div>
      )}

      <ol className="transcript-segments">
        {segments.map((segment) => (
          <li key={segment.id}>
            <div>
              <span>{formatTimestamp(segment.startMs)}–{formatTimestamp(segment.endMs)}</span>
              <strong>
                {transcript.confirmedAt
                  ? roleLabel(segment.speakerRole)
                  : roleLabel(assignments[segment.speakerKey] ?? segment.speakerRole)}
              </strong>
            </div>
            <p>{segment.content}</p>
          </li>
        ))}
      </ol>

      {!transcript.confirmedAt && (
        <button className="primary-button confirm-speakers-button" disabled={pending} type="button" onClick={confirmSpeakers}>
          {pending ? "Confirming…" : "Confirm speaker roles"}
        </button>
      )}
      {message && <p className={message.startsWith("Speaker roles confirmed") ? "audio-message" : "audio-error"} role="status">{message}</p>}
    </section>
  );
}
