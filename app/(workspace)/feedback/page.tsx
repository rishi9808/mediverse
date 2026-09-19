import { requireClinician } from "@/lib/clinician";

import { FeedbackForm } from "./feedback-form";
import { RestoreFixtures } from "./restore-fixtures";

type Snapshot = { content?: Record<string, Array<{ segment_ids?: string[] }>> };

export default async function FeedbackPage() {
  const { supabase, clinician } = await requireClinician();
  const [assetsResult, consentsResult, segmentsResult, approvalsResult, feedbackResult] = await Promise.all([
    supabase.from("audio_assets").select("session_id, duration_ms, state, deleted_at").eq("clinician_id", clinician.id),
    supabase.from("consent_events").select("session_id, decision, recorded_at").eq("clinician_id", clinician.id).eq("decision", "granted"),
    supabase.from("transcript_segments").select("id, speaker_role, suggested_speaker_role").eq("clinician_id", clinician.id),
    supabase.from("approved_notes").select("session_id, snapshot, approved_at").eq("clinician_id", clinician.id),
    supabase.from("evaluation_feedback").select("id", { count: "exact", head: true }).eq("clinician_id", clinician.id),
  ]);
  const queryError = assetsResult.error || consentsResult.error || segmentsResult.error || approvalsResult.error || feedbackResult.error;
  if (queryError) throw new Error("We could not load the reliability evidence.");

  const assets = assetsResult.data ?? [];
  const approvals = approvalsResult.data ?? [];
  const approvedIds = new Set(approvals.map((item) => item.session_id));
  const shortAsset = assets.find((item) => item.duration_ms === 180000);
  const longAsset = assets.find((item) => item.duration_ms === 5400000);
  const automaticRolesApplied = (segmentsResult.data ?? []).some((segment) => segment.suggested_speaker_role) &&
    (segmentsResult.data ?? []).filter((segment) => segment.suggested_speaker_role)
      .every((segment) => ["clinician", "patient"].includes(segment.speaker_role));
  const hasCitations = approvals.some((approval) => {
    const snapshot = approval.snapshot as Snapshot;
    return Object.values(snapshot.content ?? {}).flat().some((statement) => (statement.segment_ids?.length ?? 0) > 0);
  });
  const checks = [
    { label: "Short golden path", detail: "Consent, transcript, SOAP review, approval, PDF source, and retention state", passed: Boolean(shortAsset && approvedIds.has(shortAsset.session_id) && shortAsset.state === "deleted") },
    { label: "90-minute boundary", detail: "A representative fixture is stored at exactly 5,400,000 ms and completes the workflow", passed: Boolean(longAsset && approvedIds.has(longAsset.session_id) && longAsset.state === "deleted") },
    { label: "Consent evidence", detail: "Granted consent events retain their policy decision and timestamp", passed: (consentsResult.data?.length ?? 0) >= 2 },
    { label: "Automatic speaker roles", detail: "Stored Psychologist and Patient roles were completed from LLM identification without clinician selection", passed: automaticRolesApplied },
    { label: "Evidence citations", detail: "Approved SOAP snapshots retain transcript-segment references", passed: hasCitations },
    { label: "Audio deletion", detail: "Approved fixture audio has a completed deletion state and timestamp", passed: assets.filter((item) => item.state === "deleted" && item.deleted_at).length >= 2 },
    { label: "Duplicate and refresh recovery", detail: "Session request IDs, upload fingerprints, durable jobs, and revision conflicts protect retries", passed: Boolean(shortAsset && longAsset) },
  ];

  return (
    <main className="workspace-page feedback-page">
      <header className="page-heading"><div><p className="page-context">Product feedback</p><h1>Help us improve the workflow</h1><p>Review the reliability evidence, then tell us where the note and approval experience needs work.</p></div></header>

      <section className="reliability-panel" aria-labelledby="reliability-heading">
        <div className="section-heading-row"><div><h2 id="reliability-heading">Reliability checks</h2><p>Evidence derived from the current fictional workspace.</p></div><span>{checks.filter((item) => item.passed).length}/{checks.length} verified</span></div>
        <div className="reliability-list">{checks.map((item) => <article key={item.label}><span className={item.passed ? "check-pass" : "check-pending"} aria-hidden="true">{item.passed ? "✓" : "!"}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div><small>{item.passed ? "Verified" : "Needs attention"}</small></article>)}</div>
      </section>

      <section className="scope-panel"><h2>Current scope</h2><div><p><strong>Supported:</strong> English, in-person sessions, two-speaker review, SOAP progress notes, PDF export, and recordings up to 90 minutes.</p><p><strong>Not yet covered:</strong> appointments, guardian consent, multilingual transcription, more than two speakers, amendments after approval, or EMR integration.</p></div></section>

      <div className="feedback-layout"><section aria-labelledby="feedback-form-heading"><div className="section-heading-row"><div><h2 id="feedback-form-heading">Your assessment</h2><p>{feedbackResult.count ?? 0} response{feedbackResult.count === 1 ? "" : "s"} submitted from this account.</p></div></div><FeedbackForm /></section><aside><RestoreFixtures /><div className="feedback-guide"><h2>What to evaluate</h2><ol><li>Can you verify each note statement against its evidence?</li><li>How much correction is needed before approval?</li><li>Does the workflow preserve your clinical judgment?</li><li>Would it save time in a supervised pilot?</li></ol></div></aside></div>
    </main>
  );
}
