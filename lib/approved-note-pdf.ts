import { PDFDocument, StandardFonts, type PDFFont, type PDFPage, rgb } from "pdf-lib";

import type { SoapDocument, SoapStatement } from "./soap";

type EvidenceReference = {
  segment_id: string;
  start_ms: number;
  end_ms: number;
  speaker_role: string;
};

export type ApprovedNoteSnapshot = {
  schema_version: number;
  format: "SOAP";
  is_fictional?: boolean;
  patient: { id: string; display_code: string; display_name: string };
  clinician: { id: string; display_name: string; profession: string };
  session: { id: string; occurred_at: string; setting: string; language: string };
  note_revision_id: string;
  note_version: number;
  approved_at: string;
  confirmation: { confirmed: true; confirmed_at: string; confirmed_by: string };
  content: SoapDocument;
  evidence_references?: EvidenceReference[];
};

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 52;
const contentWidth = pageWidth - margin * 2;
const sectionOrder = ["subjective", "objective", "assessment", "plan"] as const;
const sectionLabels = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSoapStatement(value: unknown): value is SoapStatement {
  return isRecord(value) && typeof value.text === "string" &&
    ["transcript", "clinician"].includes(String(value.origin)) &&
    Array.isArray(value.segment_ids) && value.segment_ids.every((id) => typeof id === "string");
}

export function parseApprovedNoteSnapshot(value: unknown): ApprovedNoteSnapshot {
  if (!isRecord(value) || value.format !== "SOAP" || !isRecord(value.patient) ||
    !isRecord(value.clinician) || !isRecord(value.session) || !isRecord(value.confirmation) ||
    !isRecord(value.content) || value.confirmation.confirmed !== true ||
    typeof value.patient.id !== "string" || typeof value.patient.display_code !== "string" ||
    typeof value.patient.display_name !== "string" || typeof value.clinician.display_name !== "string" ||
    typeof value.session.occurred_at !== "string" || typeof value.approved_at !== "string") {
    throw new Error("INVALID_APPROVED_NOTE_SNAPSHOT");
  }
  const content = value.content;
  if (!sectionOrder.every((section) => Array.isArray(content[section]) &&
    content[section].every(isSoapStatement))) throw new Error("INVALID_APPROVED_NOTE_SNAPSHOT");
  return value as unknown as ApprovedNoteSnapshot;
}

function printable(value: string, font: PDFFont) {
  const replacements: Record<string, string> = {
    "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": "\"", "\u201d": "\"", "\u2026": "...", "\u00a0": " ",
  };
  return Array.from(value.normalize("NFC")).map((character) => {
    const candidate = replacements[character] ?? character;
    try {
      font.widthOfTextAtSize(candidate, 10);
      return candidate;
    } catch {
      return "?";
    }
  }).join("");
}

function wrapText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of printable(text, font).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        let remainder = word;
        while (font.widthOfTextAtSize(remainder, size) > width && remainder.length > 1) {
          let splitAt = remainder.length - 1;
          while (splitAt > 1 && font.widthOfTextAtSize(`${remainder.slice(0, splitAt)}-`, size) > width) {
            splitAt -= 1;
          }
          lines.push(`${remainder.slice(0, splitAt)}-`);
          remainder = remainder.slice(splitAt);
        }
        line = remainder;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatTimestamp(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function createApprovedNotePdf(rawSnapshot: unknown) {
  const snapshot = parseApprovedNoteSnapshot(rawSnapshot);
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = document.addPage([pageWidth, pageHeight]);
  const pages: PDFPage[] = [page];
  let y = pageHeight - margin;
  page.drawRectangle({ x: 0, y: pageHeight - 12, width: pageWidth, height: 12, color: rgb(0.07, 0.3, 0.34) });

  const addPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    y = pageHeight - margin;
    page.drawRectangle({ x: 0, y: pageHeight - 12, width: pageWidth, height: 12, color: rgb(0.07, 0.3, 0.34) });
  };
  const ensureSpace = (height: number) => {
    if (y - height < margin + 24) addPage();
  };
  const drawLines = (lines: string[], options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; lineHeight?: number } = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const color = options.color ?? rgb(0.12, 0.16, 0.18);
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? size * 1.45;
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: margin + indent, y: y - size, size, font, color });
      y -= lineHeight;
    }
  };
  const drawWrapped = (text: string, options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; width?: number; lineHeight?: number } = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const indent = options.indent ?? 0;
    drawLines(wrapText(text, font, size, options.width ?? contentWidth - indent), { ...options, font, size, indent });
  };

  drawLines(["MEDIVERSE"], { font: bold, size: 10, color: rgb(0.07, 0.3, 0.34), lineHeight: 18 });
  drawLines(["Approved SOAP Progress Note"], { font: bold, size: 22, color: rgb(0.06, 0.14, 0.17), lineHeight: 30 });
  y -= 4;
  ensureSpace(44);
  page.drawRectangle({ x: margin, y: y - 34, width: contentWidth, height: 34, color: rgb(0.94, 0.97, 0.93), borderColor: rgb(0.48, 0.66, 0.45), borderWidth: 0.8 });
  page.drawText(snapshot.is_fictional === false ? "DATA STATUS: CLINICAL RECORD" : "DATA STATUS: FICTIONAL DEMONSTRATION DATA", {
    x: margin + 12, y: y - 21, font: bold, size: 10, color: rgb(0.16, 0.35, 0.17),
  });
  y -= 48;

  const metadata = [
    ["Patient", `${snapshot.patient.display_name} (${snapshot.patient.display_code})`],
    ["Patient identifier", snapshot.patient.display_code],
    ["Psychologist", snapshot.clinician.display_name],
    ["Session date", formatDate(snapshot.session.occurred_at)],
    ["Approved", formatDate(snapshot.approved_at)],
    ["Approved revision", String(snapshot.note_version)],
  ];
  for (const [label, value] of metadata) {
    ensureSpace(20);
    page.drawText(label, { x: margin, y: y - 10, font: bold, size: 9, color: rgb(0.33, 0.4, 0.42) });
    drawWrapped(value, { indent: 118, width: contentWidth - 118, size: 10, lineHeight: 15 });
  }
  y -= 14;

  const evidenceById = new Map((snapshot.evidence_references ?? []).map((reference, index) =>
    [reference.segment_id, { ...reference, label: `E${index + 1}` }]));

  for (const section of sectionOrder) {
    ensureSpace(40);
    page.drawText(sectionLabels[section], { x: margin, y: y - 15, font: bold, size: 15, color: rgb(0.07, 0.3, 0.34) });
    y -= 27;
    for (const [index, statement] of snapshot.content[section].entries()) {
      drawWrapped(`${index + 1}. ${statement.text}`, { indent: 8, width: contentWidth - 8, size: 10.5, lineHeight: 15 });
      const references = statement.segment_ids.map((id) => evidenceById.get(id)?.label ?? `segment ${id.slice(0, 8)}`);
      const evidenceLine = statement.origin === "clinician"
        ? "Source: Clinician-entered observation"
        : `Evidence: ${references.join(", ")}`;
      drawWrapped(evidenceLine, { indent: 20, width: contentWidth - 20, size: 8.5, color: rgb(0.36, 0.43, 0.45), lineHeight: 13 });
      y -= 5;
    }
  }

  if (evidenceById.size > 0) {
    ensureSpace(44);
    page.drawText("Evidence references", { x: margin, y: y - 15, font: bold, size: 15, color: rgb(0.07, 0.3, 0.34) });
    y -= 29;
    drawWrapped("References identify retained transcript segments by timestamp. Transcript text is intentionally excluded from this PDF.", {
      size: 9, color: rgb(0.36, 0.43, 0.45), lineHeight: 13,
    });
    y -= 5;
    for (const reference of evidenceById.values()) {
      const role = reference.speaker_role === "clinician" ? "Psychologist" :
        reference.speaker_role === "patient" ? "Patient" : "Speaker";
      drawWrapped(`${reference.label}  ${formatTimestamp(reference.start_ms)}-${formatTimestamp(reference.end_ms)}  ${role}  Segment ${reference.segment_id}`, {
        size: 8.5, lineHeight: 13,
      });
    }
  }

  for (const [index, pdfPage] of pages.entries()) {
    pdfPage.drawLine({ start: { x: margin, y: 38 }, end: { x: pageWidth - margin, y: 38 }, thickness: 0.5, color: rgb(0.78, 0.82, 0.83) });
    pdfPage.drawText(`Approved immutable snapshot - Page ${index + 1} of ${pages.length}`, {
      x: margin, y: 23, size: 8, font: regular, color: rgb(0.4, 0.46, 0.48),
    });
  }

  document.setTitle(`Approved SOAP Note - ${printable(snapshot.patient.display_code, regular)}`);
  document.setAuthor("Mediverse");
  document.setSubject("Clinician-approved SOAP progress note");
  document.setCreationDate(new Date(snapshot.approved_at));
  document.setModificationDate(new Date(snapshot.approved_at));
  return document.save({ useObjectStreams: false });
}
