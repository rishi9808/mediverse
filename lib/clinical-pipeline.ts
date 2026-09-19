import type { SoapDocument, SoapStatement } from "@/lib/soap";

export type TranscriptSegment = {
  id: string;
  speaker_key: string;
  speaker_role: string;
  start_ms: number;
  end_ms: number;
  content: string;
};

type StructuredOutputRequester = (
  schemaName: string,
  schema: object,
  system: string,
  input: string,
) => Promise<unknown>;

const speakerAssignmentSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      speaker_key: { type: "string" },
      role: { type: "string", enum: ["clinician", "patient"] },
    },
    required: ["speaker_key", "role"],
    additionalProperties: false,
  },
} as const;

const soapStatementSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    segment_ids: { type: "array", items: { type: "string" } },
  },
  required: ["text", "segment_ids"],
  additionalProperties: false,
} as const;

export const soapSchema = {
  type: "object",
  properties: {
    subjective: { type: "array", items: soapStatementSchema },
    objective: { type: "array", items: soapStatementSchema },
    assessment: { type: "array", items: soapStatementSchema },
    plan: { type: "array", items: soapStatementSchema },
  },
  required: ["subjective", "objective", "assessment", "plan"],
  additionalProperties: false,
} as const;

export function soapSchemaForTranscript(segments: TranscriptSegment[]) {
  const ids = segments.map((segment) => segment.id);
  // Four SOAP sections repeat this enum. Bound schema size for long recordings.
  if (ids.length > 200) return soapSchema;
  const statement = {
    ...soapStatementSchema,
    properties: {
      ...soapStatementSchema.properties,
      segment_ids: { type: "array", items: { type: "string", enum: ids } },
    },
  };
  return {
    ...soapSchema,
    properties: Object.fromEntries(
      Object.keys(soapSchema.properties).map((section) => [
        section, { type: "array", items: statement },
      ]),
    ),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

export function serializeTranscript(segments: TranscriptSegment[], includeRoles = true) {
  return segments.map((segment) => JSON.stringify({
    segment_id: segment.id,
    speaker_key: segment.speaker_key,
    ...(includeRoles ? { speaker_role: segment.speaker_role } : {}),
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    text: segment.content,
  })).join("\n");
}

function validateSpeakerAssignments(value: unknown, segments: TranscriptSegment[]) {
  if (!Array.isArray(value)) throw new Error("INVALID_SPEAKER_ASSIGNMENTS");
  const expectedSpeakers = new Set(segments.map((segment) => segment.speaker_key));
  if (expectedSpeakers.size < 2) throw new Error("SPEAKER_IDENTIFICATION_UNAVAILABLE");

  const assignments: Record<string, "clinician" | "patient"> = {};
  for (const item of value) {
    if (!isObject(item) || typeof item.speaker_key !== "string" ||
      !["clinician", "patient"].includes(String(item.role)) ||
      !expectedSpeakers.has(item.speaker_key) || assignments[item.speaker_key]) {
      throw new Error("INVALID_SPEAKER_ASSIGNMENTS");
    }
    assignments[item.speaker_key] = item.role as "clinician" | "patient";
  }
  if (Object.keys(assignments).length !== expectedSpeakers.size ||
    !Object.values(assignments).includes("clinician") ||
    !Object.values(assignments).includes("patient")) {
    throw new Error("INVALID_SPEAKER_ASSIGNMENTS");
  }
  return assignments;
}

export function validateSoapOutput(value: unknown, validSegmentIds: Set<string>): SoapDocument {
  if (!isObject(value)) throw new Error("INVALID_SOAP_STRUCTURE");
  const sections = ["subjective", "objective", "assessment", "plan"] as const;
  if (Object.keys(value).length !== sections.length || sections.some((section) => !(section in value))) {
    throw new Error("INVALID_SOAP_STRUCTURE");
  }
  return Object.fromEntries(sections.map((section) => {
    const rawStatements = value[section];
    if (!Array.isArray(rawStatements) || rawStatements.length > 100) {
      throw new Error("INVALID_SOAP_STRUCTURE");
    }
    const statements: SoapStatement[] = rawStatements.map((statement) => {
      if (!isObject(statement) || Object.keys(statement).length !== 2 ||
        typeof statement.text !== "string" || !statement.text.trim() ||
        statement.text.trim().length > 10_000 || !Array.isArray(statement.segment_ids) ||
        statement.segment_ids.length > 100) {
        throw new Error("INVALID_SOAP_STRUCTURE");
      }
      if (statement.segment_ids.length === 0 ||
        statement.segment_ids.some((id) => typeof id !== "string" || !validSegmentIds.has(id))) {
        throw new Error("INVALID_SOAP_EVIDENCE");
      }
      return {
        text: statement.text.trim(),
        origin: "transcript",
        segment_ids: statement.segment_ids as [string, ...string[]],
      };
    });
    return [section, statements];
  })) as SoapDocument;
}

export async function generateInitialClinicalDraft(
  segments: TranscriptSegment[],
  requestStructuredOutput: StructuredOutputRequester,
) {
  const speakers = [...new Set(segments.map((segment) => segment.speaker_key))];
  if (speakers.length < 2) throw new Error("SPEAKER_IDENTIFICATION_UNAVAILABLE");
  const initialClinicalDraftSchema = {
    type: "object",
    properties: {
      assignments: {
        ...speakerAssignmentSchema,
        items: {
          ...speakerAssignmentSchema.items,
          properties: {
            ...speakerAssignmentSchema.items.properties,
            speaker_key: { type: "string", enum: speakers },
          },
        },
      },
      soap: soapSchemaForTranscript(segments),
    },
    required: ["assignments", "soap"],
    additionalProperties: false,
  };
  const result = await requestStructuredOutput(
    "speaker_roles_and_evidence_linked_soap",
    initialClinicalDraftSchema,
    [
      "Complete two linked tasks for this psychotherapy dialogue in one response.",
      "First, assign every exact speaker_key to clinician (the Psychologist) or patient. Include at least one of each role.",
      "Second, draft a concise SOAP progress note using those assignments and only facts supported by the dialogue.",
      "Every SOAP statement must cite one or more exact segment_id values that directly support it.",
      "Subjective is the patient's reported experience. Objective contains only transcript-observable interaction or explicitly spoken clinician observations; leave it empty if unsupported.",
      "Assessment contains only source-supported clinical interpretation explicitly stated in the transcript. Plan contains only agreed next steps.",
      "Do not diagnose, infer unspoken observations, or invent risk, appearance, behavior, medication, examination, or treatment details.",
      "Return an empty array for unsupported SOAP sections. Do not include transcript text in the output.",
    ].join(" "),
    serializeTranscript(segments, false),
  );
  if (!isObject(result) || Object.keys(result).length !== 2) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  return {
    assignments: validateSpeakerAssignments(result.assignments, segments),
    soap: validateSoapOutput(result.soap, new Set(segments.map((segment) => segment.id))),
  };
}
