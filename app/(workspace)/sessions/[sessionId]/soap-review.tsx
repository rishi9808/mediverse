"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { SoapDocument, SoapStatement } from "@/lib/soap";

import {
  approveSoapNote,
  continueDrafting,
  regenerateSoapDraft,
  retryDrafting,
  saveSoapDraft,
} from "../../actions";

type Job = { id: string; status: string; attempts: number };
type SegmentReference = { id: string; startMs: number; endMs: number };
type RevisionReference = { id: string; version: number; createdAt: string };
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

function formatSavedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SoapReview({
  approved,
  draftingJob,
  note,
  revisions,
  segments,
  sessionId,
  transcriptId,
}: {
  approved: { approvedAt: string; noteRevisionId: string } | null;
  draftingJob: Job | null;
  note: { id: string; version: number; content: SoapDocument } | null;
  revisions: RevisionReference[];
  segments: SegmentReference[];
  sessionId: string;
  transcriptId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [document, setDocument] = useState<SoapDocument | null>(() => note ? cloneDocument(note.content) : null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const evidence = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);
  const active = draftingJob && ["queued", "running"].includes(draftingJob.status);
  const isApproved = Boolean(approved);
  const isComplete = Boolean(document && sectionNames.every((section) =>
    document[section].length > 0 && document[section].every((statement) => statement.text.trim().length > 0)));

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
    if (!document || isApproved) return;
    setDocument({
      ...document,
      [section]: document[section].map((statement, statementIndex) =>
        statementIndex === index ? { ...statement, text } : statement),
    });
    setDirty(true);
  }

  function removeStatement(section: SectionName, index: number) {
    if (!document || isApproved) return;
    setDocument({
      ...document,
      [section]: document[section].filter((_, statementIndex) => statementIndex !== index),
    });
    setDirty(true);
  }

  function addClinicianEntry(section: SectionName) {
    if (!document || isApproved) return;
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
    setConflict(false);
    startTransition(async () => {
      const result = await saveSoapDraft(sessionId, transcriptId, note.version, document);
      setMessage(result.ok ? "SOAP revision saved." : result.message);
      if (result.ok) {
        setDirty(false);
        router.refresh();
      } else {
        setConflict(Boolean(result.conflict));
      }
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
    if (!note || isApproved) return;
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

  function approve() {
    if (!note || !confirmed || dirty || !isComplete || isApproved) return;
    setMessage("");
    setConflict(false);
    startTransition(async () => {
      const result = await approveSoapNote(sessionId, note.id, confirmed);
      if (result.ok) {
        setShowConfirmation(false);
        router.refresh();
      } else {
        setMessage(result.message);
        setConflict(Boolean(result.conflict));
        if (result.conflict) setShowConfirmation(false);
      }
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
          <h2 id="soap-review-heading">
            {isApproved ? `Approved SOAP note, revision ${note?.version}` : `Review SOAP draft, revision ${note?.version}`}
          </h2>
          <p>
            {isApproved
              ? `Approved ${approved ? formatSavedAt(approved.approvedAt) : ""}. This note is locked and cannot be edited.`
              : "AI entries retain transcript evidence. Your own observations are stored separately without fabricated citations."}
          </p>
        </div>
        <span className={`status-chip ${isApproved ? "" : "active-status"}`}>
          {isApproved ? "Approved and immutable" : "Clinician review required"}
        </span>
      </div>

      {isApproved && (
        <div className="approved-note-export">
          <div>
            <strong>Approved-note PDF</strong>
            <p>Includes approval metadata, SOAP content, and evidence timestamps. The full transcript and media location are excluded.</p>
          </div>
          <a className="primary-button" href={`/sessions/${sessionId}/approved-note.pdf`}>
            Download PDF
          </a>
        </div>
      )}

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
              {!isApproved && (
                <button className="secondary-button" type="button" onClick={() => addClinicianEntry(section)}>
                  Add clinician entry
                </button>
              )}
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
                  {!isApproved && <button type="button" onClick={() => removeStatement(section, index)}>Remove</button>}
                </div>
                <textarea
                  aria-label={`${sectionLabels[section]} entry ${index + 1}`}
                  onChange={(event) => updateStatement(section, index, event.target.value)}
                  readOnly={isApproved}
                  rows={3}
                  value={statement.text}
                />
                {statement.origin === "transcript" ? (
                  <p className="evidence-links">
                    Evidence: {statement.segment_ids.map((id, evidenceIndex) => {
                      const segment = evidence.get(id);
                      return segment
                        ? <span key={id}>
                            {evidenceIndex > 0 ? ", " : ""}
                            <a href={`#transcript-segment-${id}`}>
                              {formatTimestamp(segment.startMs)}-{formatTimestamp(segment.endMs)}
                            </a>
                          </span>
                        : <span key={id}>{evidenceIndex > 0 ? ", " : ""}Unavailable segment</span>;
                    })}
                  </p>
                ) : (
                  <p className="evidence-links">Clinician observation, no transcript citation required</p>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      {!isApproved && (
        <>
          <div className="soap-actions">
            <button className="primary-button" disabled={pending || !dirty} type="button" onClick={save}>
              {pending ? "Saving…" : "Save new revision"}
            </button>
            <button className="secondary-button" disabled={pending || Boolean(active)} type="button" onClick={regenerate}>
              Regenerate as new revision
            </button>
            <button
              className="approve-button"
              disabled={pending || dirty || !isComplete || Boolean(active)}
              type="button"
              onClick={() => {
                setConfirmed(false);
                setShowConfirmation(true);
              }}
            >
              Approve latest revision
            </button>
          </div>
          {!isComplete && (
            <p className="approval-help">Approval requires content in Subjective, Objective, Assessment, and Plan.</p>
          )}
          {dirty && <p className="approval-help">Save your corrections as a new revision before approval.</p>}
        </>
      )}

      {revisions.length > 0 && (
        <details className="revision-history">
          <summary>{revisions.length} saved {revisions.length === 1 ? "revision" : "revisions"}</summary>
          <ol>
            {revisions.map((revision) => (
              <li key={revision.id}>
                <span>Revision {revision.version}</span>
                <time dateTime={revision.createdAt}>{formatSavedAt(revision.createdAt)}</time>
                {approved?.noteRevisionId === revision.id && <strong>Approved</strong>}
                {!approved && note?.id === revision.id && <strong>Latest</strong>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {message && (
        <div className={message.includes("saved") || message.includes("generated") ? "audio-message" : "audio-error"} role="status">
          {message}
          {conflict && (
            <button className="secondary-button conflict-refresh" type="button" onClick={() => router.refresh()}>
              Load latest revision
            </button>
          )}
        </div>
      )}

      {showConfirmation && note && (
        <div className="dialog-backdrop" role="presentation">
          <section aria-labelledby="approval-confirmation-heading" aria-modal="true" className="approval-dialog" role="dialog">
            <p className="section-kicker">Final clinical record</p>
            <h2 id="approval-confirmation-heading">Approve revision {note.version}?</h2>
            <p>Approval permanently locks this SOAP note. Further corrections require a future amendment workflow.</p>
            <label className="consent-checkbox">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>I reviewed the complete latest revision and confirm it is ready to become the approved clinical note.</span>
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" disabled={pending} type="button" onClick={() => setShowConfirmation(false)}>
                Cancel
              </button>
              <button className="approve-button" disabled={pending || !confirmed} type="button" onClick={approve}>
                {pending ? "Approving…" : "Approve immutable note"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
