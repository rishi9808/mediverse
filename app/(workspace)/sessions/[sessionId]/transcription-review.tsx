"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
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
  speakerRole: string;
  startMs: number;
  endMs: number;
  content: string;
};

type Transcript = {
  confirmedAt: string | null;
  identifiedAt: string | null;
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
                ? "The audio was not transcribed. A fictional seeded transcript remains available in the restored fixtures."
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
            <p>The complete dialogue is being analyzed. Psychologist and Patient roles will be applied automatically.</p>
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
          <h2 id="transcript-review-heading">
            {transcript.confirmedAt ? "Transcript evidence" : "Applying speaker roles"}
          </h2>
          <p>
            {transcript.confirmedAt
              ? "The LLM assigned Psychologist and Patient automatically. SOAP evidence links bring the corresponding transcript segment into view."
              : "The LLM has identified the speakers and is applying their roles automatically before SOAP drafting."}
          </p>
        </div>
        <span className={`status-chip ${transcript.confirmedAt ? "" : "active-status"}`}>
          {transcript.confirmedAt ? "AI-assigned speakers" : "Applying roles"}
        </span>
      </div>

      <ol className="transcript-segments">
        {segments.map((segment) => (
          <li id={`transcript-segment-${segment.id}`} key={segment.id} tabIndex={-1}>
            <div>
              <span>{formatTimestamp(segment.startMs)}-{formatTimestamp(segment.endMs)}</span>
              <strong>
                {roleLabel(segment.speakerRole)}
              </strong>
            </div>
            <p>{segment.content}</p>
          </li>
        ))}
      </ol>

      {message && <p className="audio-error" role="status">{message}</p>}
    </section>
  );
}
