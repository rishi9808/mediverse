import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";
import { createApprovedNotePdf, parseApprovedNoteSnapshot } from "../lib/approved-note-pdf.ts";

const evidenceId = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  schema_version: 2,
  format: "SOAP",
  is_fictional: true,
  patient: { id: "patient-1", display_code: "DEMO-001", display_name: "Fictional Patient" },
  clinician: { id: "clinician-1", display_name: "Dr. Asha Rao", profession: "psychologist" },
  session: { id: "session-1", occurred_at: "2026-09-19T09:30:00Z", setting: "in_person", language: "en" },
  note_revision_id: "revision-1",
  note_version: 3,
  approved_at: "2026-09-19T11:00:00Z",
  confirmation: { confirmed: true, confirmed_at: "2026-09-19T11:00:00Z", confirmed_by: "clinician-1" },
  content: {
    subjective: [{ text: "Reports tension before work.", origin: "transcript", segment_ids: [evidenceId] }],
    objective: [{ text: "Engaged throughout.", origin: "clinician", segment_ids: [] }],
    assessment: [{ text: "Work-related anxiety remains under review.", origin: "transcript", segment_ids: [evidenceId] }],
    plan: [{ text: "Continue breathing practice.", origin: "clinician", segment_ids: [] }],
  },
  evidence_references: [{ segment_id: evidenceId, start_ms: 12000, end_ms: 28400, speaker_role: "patient" }],
};

test("renders a valid approved-note PDF from the immutable snapshot", async () => {
  const bytes = await createApprovedNotePdf(snapshot);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");

  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.getTitle(), "Approved SOAP Note - DEMO-001");
});

test("rejects draft-shaped input without explicit approval confirmation", () => {
  assert.throws(
    () => parseApprovedNoteSnapshot({ ...snapshot, confirmation: { confirmed: false } }),
    /INVALID_APPROVED_NOTE_SNAPSHOT/,
  );
});
