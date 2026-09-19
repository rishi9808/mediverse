"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { SoapDocument, SoapStatement } from "@/lib/soap";

import {
  continueDrafting,
  regenerateSoapDraft,
  retryDrafting,
  saveSoapDraft,
} from "../../actions";

type Job = { id: string; status: string; attempts: number };
type SegmentReference = { id: string; startMs: number; endMs: number };
type SectionName = keyof SoapDocument;

const sectionNames: SectionName[] = ["subjective", "objective", "assessment", "plan"];
const sectionLabels: Record<SectionName, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function cloneDocument(document: SoapDocument): SoapDocument {
  return structuredClone(document);
}

export function SoapReview({
  draftingJob,
  note,
  segments,
  sessionId,
  transcriptId,
}: {
  draftingJob: Job | null;
  note: { version: number; content: SoapDocument } | null;
  segments: SegmentReference[];
  sessionId: string;
  transcriptId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [document, setDocument] = useState<SoapDocument | null>(() => note ? cloneDocument(note.content) : null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const evidence = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);
  const active = draftingJob && ["queued", "running"].includes(draftingJob.status);

  useEffect(() => {
    if (!active || !draftingJob) return;
    const refreshTimer = window.setInterval(() => router.refresh(), 2500);
    const resume = () => void continueDrafting(sessionId, draftingJob.id);
    resume();
    const resumeTimer = window.setInterval(resume, 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(resumeTimer);
    };
  }, [active, draftingJob, router, sessionId]);

  function updateStatement(section: SectionName, index: number, text: string) {
    if (!document) return;
    setDocument({
      ...document,
      [section]: document[section].map((statement, statementIndex) =>
        statementIndex === index ? { ...statement, text } : statement),
    });
    setDirty(true);
  }

  function removeStatement(section: SectionName, index: number) {
    if (!document) return;
    setDocument({
      ...document,
      [section]: document[section].filter((_, statementIndex) => statementIndex !== index),
    });
    setDirty(true);
  }

  function addClinicianEntry(section: SectionName) {
    if (!document) return;
    const statement: SoapStatement = { text: "", origin: "clinician", segment_ids: [] };
    setDocument({ ...document, [section]: [...document[section], statement] });
    setDirty(true);
  }

  function save() {
    if (!document || !note) return;
    if (sectionNames.some((section) => document[section].some((statement) => !statement.text.trim()))) {
      setMessage("Complete or remove every blank entry before saving.");
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await saveSoapDraft(sessionId, transcriptId, note.version, document);
      setMessage(result.ok ? "SOAP revision saved." : result.message);
      if (result.ok) setDirty(false);
      router.refresh();
    });
  }

  function retry() {
    if (!draftingJob) return;
    setMessage("");
    startTransition(async () => {
      const result = await retryDrafting(sessionId, draftingJob.id);
      if (!result.ok) setMessage(result.message);
      router.refresh();
    });
  }

  function regenerate() {
    if (!note) return;
    if (dirty) {
      setMessage("Save or discard your edits before regenerating. They will never be overwritten silently.");
      return;
    }
    setMessage("");
    startTransition(async () => {
      const result = await regenerateSoapDraft(sessionId, transcriptId, note.version);
      setMessage(result.ok ? "A new evidence-linked revision is being generated." : result.message);
      router.refresh();
    });
  }

  if (!document) {
    const failed = draftingJob?.status === "failed";
    return (
      <section className="soap-card" aria-labelledby="soap-drafting-heading">
        <div className="transcription-heading-row">
          <div>
            <p className="section-kicker">Evidence-linked SOAP</p>
            <h2 id="soap-drafting-heading">{failed ? "SOAP drafting needs attention" : "Drafting the SOAP note"}</h2>
            <p>The full confirmed transcript is used. Unsupported sections remain empty for psychologist input.</p>
          </div>
          <span className={`status-chip ${failed ? "" : "active-status"}`}>
            {draftingJob?.status === "running" ? "Processing" : failed ? "Needs attention" : "Queued"}
          </span>
        </div>
        {draftingJob && <p className="processing-meta">Attempt {Math.min(draftingJob.attempts, 3)} of 3</p>}
        {!failed && <progress className="indeterminate-progress" aria-label="SOAP drafting in progress" />}
        {failed && draftingJob && draftingJob.attempts < 3 && (
          <button className="primary-button" disabled={pending} type="button" onClick={retry}>
            {pending ? "Retrying…" : "Retry SOAP drafting"}
          </button>
        )}
        {message && <p className="audio-error" role="alert">{message}</p>}
      </section>
    );
  }

  return (
    <section className="soap-card" aria-labelledby="soap-review-heading">
      <div className="transcription-heading-row">
        <div>
          <p className="section-kicker">Evidence-linked SOAP</p>
          <h2 id="soap-review-heading">Review SOAP draft · version {note?.version}</h2>
          <p>AI entries retain transcript evidence. Your own observations are stored separately without fabricated citations.</p>
        </div>
        <span className="status-chip">Clinician review required</span>
      </div>

      {active && (
        <div className="draft-regeneration-status" role="status">
          A new revision is processing. This version remains editable and will not be overwritten.
        </div>
      )}

      <div className="soap-sections">
        {sectionNames.map((section) => (
          <section className="soap-section" key={section}>
            <div className="soap-section-heading">
              <h3>{sectionLabels[section]}</h3>
              <button className="secondary-button" type="button" onClick={() => addClinicianEntry(section)}>
                Add clinician entry
              </button>
            </div>
            {document[section].length === 0 && (
              <p className="unsupported-section">No supported transcript content. Add a clinician observation if appropriate.</p>
            )}
            {document[section].map((statement, index) => (
              <div className="soap-statement" key={`${section}-${index}`}>
                <div className="soap-statement-meta">
                  <span className={`origin-chip ${statement.origin}`}>
                    {statement.origin === "transcript" ? "Transcript-derived" : "Clinician-entered"}
                  </span>
                  <button type="button" onClick={() => removeStatement(section, index)}>Remove</button>
                </div>
                <textarea
                  aria-label={`${sectionLabels[section]} entry ${index + 1}`}
                  onChange={(event) => updateStatement(section, index, event.target.value)}
                  rows={3}
                  value={statement.text}
                />
                {statement.origin === "transcript" ? (
                  <p className="evidence-links">
                    Evidence: {statement.segment_ids.map((id) => {
                      const segment = evidence.get(id);
                      return segment
                        ? `${formatTimestamp(segment.startMs)}–${formatTimestamp(segment.endMs)}`
                        : "Unavailable segment";
                    }).join(", ")}
                  </p>
                ) : (
                  <p className="evidence-links">Clinician observation · no transcript citation required</p>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="soap-actions">
        <button className="primary-button" disabled={pending || !dirty} type="button" onClick={save}>
          {pending ? "Saving…" : "Save new revision"}
        </button>
        <button className="secondary-button" disabled={pending || Boolean(active)} type="button" onClick={regenerate}>
          Regenerate as new revision
        </button>
      </div>
      {message && <p className={message.includes("saved") || message.includes("generated") ? "audio-message" : "audio-error"} role="status">{message}</p>}
    </section>
  );
}
