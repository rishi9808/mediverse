import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/database.types";
import { buildSpeakerIdentificationInput } from "@/lib/speaker-identification";
import type { SoapDocument, SoapStatement } from "@/lib/soap";

export const CLINICAL_TEXT_MODEL = process.env.OPENAI_CLINICAL_MODEL ?? "gpt-4o-mini-2024-07-18";
export const SOAP_PROMPT_VERSION = "evidence-soap-v1";
const MAX_ATTEMPTS = 3;

type TranscriptSegment = {
  id: string;
  speaker_key: string;
  speaker_role: string;
  start_ms: number;
  end_ms: number;
  content: string;
};

type ClaimedSpeakerJob = {
  state: "claimed";
  attempt: number;
  transcript_id: string;
};

type ClaimedDraftingJob = ClaimedSpeakerJob & {
  base_note_version: number;
};

type ChatCompletionPayload = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
};

const speakerIdentificationSchema = {
  type: "object",
  properties: {
    assignments: {
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
    },
  },
  required: ["assignments"],
  additionalProperties: false,
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

const soapSchema = {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function isClaimedSpeakerJob(value: Json): value is ClaimedSpeakerJob & Json {
  return isObject(value) && value.state === "claimed" &&
    typeof value.attempt === "number" && typeof value.transcript_id === "string";
}

function isClaimedDraftingJob(value: Json): value is ClaimedDraftingJob & Json {
  return isObject(value) && value.state === "claimed" &&
    typeof value.attempt === "number" && typeof value.transcript_id === "string" &&
    typeof value.base_note_version === "number";
}

function safeProviderErrorCode(status: number) {
  if (status === 401 || status === 403) return "OPENAI_AUTH_UNAVAILABLE";
  if (status === 429) return "OPENAI_RATE_LIMITED";
  if (status >= 500) return "OPENAI_UNAVAILABLE";
  return "OPENAI_DRAFT_REJECTED";
}

function boundedErrorCode(error: unknown, fallback: string) {
  if (error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "OPENAI_TIMEOUT";
  return fallback;
}

async function requestStructuredOutput<T>(
  schemaName: string,
  schema: object,
  system: string,
  input: string,
): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_CONFIGURATION_UNAVAILABLE");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLINICAL_TEXT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(safeProviderErrorCode(response.status));

  const payload = await response.json() as ChatCompletionPayload;
  const choice = payload.choices?.[0];
  if (choice?.message?.refusal) throw new Error("OPENAI_REFUSED");
  if (choice?.finish_reason !== "stop" || !choice.message?.content) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  try {
    return JSON.parse(choice.message.content) as T;
  } catch {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
}

function serializeTranscript(segments: TranscriptSegment[]) {
  return segments.map((segment) => JSON.stringify({
    segment_id: segment.id,
    speaker_key: segment.speaker_key,
    speaker_role: segment.speaker_role,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    text: segment.content,
  })).join("\n");
}

async function identifySpeakerRoles(segments: TranscriptSegment[]) {
  const expectedSpeakers = new Set(segments.map((segment) => segment.speaker_key));
  if (expectedSpeakers.size < 2) throw new Error("SPEAKER_IDENTIFICATION_UNAVAILABLE");
  const result = await requestStructuredOutput<unknown>(
    "speaker_role_identification",
    speakerIdentificationSchema,
    [
      "Identify the role of every diarized speaker in this psychotherapy dialogue.",
      "Assign each exact speaker_key to clinician (the Psychologist) or patient.",
      "Use the representative excerpts, question style, clinical framing, and first-person reports.",
      "Do not rename keys, omit speakers, add speakers, or return any transcript text.",
      "The output must contain at least one clinician and one patient.",
    ].join(" "),
    buildSpeakerIdentificationInput(segments),
  );
  if (!isObject(result) || !Array.isArray(result.assignments)) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  const assignments: Record<string, "clinician" | "patient"> = {};
  for (const item of result.assignments) {
    if (!isObject(item) || typeof item.speaker_key !== "string" ||
      !["clinician", "patient"].includes(String(item.role)) ||
      !expectedSpeakers.has(item.speaker_key) || assignments[item.speaker_key]) {
      throw new Error("INVALID_PROVIDER_RESPONSE");
    }
    assignments[item.speaker_key] = item.role as "clinician" | "patient";
  }
  if (Object.keys(assignments).length !== expectedSpeakers.size ||
    !Object.values(assignments).includes("clinician") ||
    !Object.values(assignments).includes("patient")) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  return assignments;
}

function validateSoapOutput(value: unknown, validSegmentIds: Set<string>): SoapDocument {
  if (!isObject(value)) throw new Error("INVALID_PROVIDER_RESPONSE");
  const sections = ["subjective", "objective", "assessment", "plan"] as const;
  if (Object.keys(value).length !== sections.length || sections.some((section) => !(section in value))) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }
  return Object.fromEntries(sections.map((section) => {
    const rawStatements = value[section];
    if (!Array.isArray(rawStatements) || rawStatements.length > 100) {
      throw new Error("INVALID_PROVIDER_RESPONSE");
    }
    const statements: SoapStatement[] = rawStatements.map((statement) => {
      if (!isObject(statement) || Object.keys(statement).length !== 2 ||
        typeof statement.text !== "string" || !statement.text.trim() ||
        statement.text.trim().length > 10_000 || !Array.isArray(statement.segment_ids) ||
        statement.segment_ids.length === 0 || statement.segment_ids.length > 100 ||
        statement.segment_ids.some((id) => typeof id !== "string" || !validSegmentIds.has(id))) {
        throw new Error("INVALID_PROVIDER_RESPONSE");
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

async function draftSoap(segments: TranscriptSegment[]) {
  const validSegmentIds = new Set(segments.map((segment) => segment.id));
  const result = await requestStructuredOutput<unknown>(
    "evidence_linked_soap",
    soapSchema,
    [
      "Draft a concise psychotherapy SOAP progress note from the complete confirmed transcript.",
      "Use only facts supported by the dialogue. Do not diagnose, infer unspoken observations, or invent risk, appearance, behavior, medication, examination, or treatment details.",
      "Every statement must cite one or more exact segment_id values that directly support it.",
      "Subjective is the patient's reported experience. Objective contains only transcript-observable interaction or explicitly spoken clinician observations; leave it empty if unsupported.",
      "Assessment contains only source-supported clinical interpretation explicitly stated in the transcript. Plan contains only agreed next steps.",
      "Return an empty array for any unsupported section. Do not create clinician-entered observations; the psychologist adds those separately in the editor.",
    ].join(" "),
    serializeTranscript(segments),
  );
  return validateSoapOutput(result, validSegmentIds);
}

async function loadTranscriptSegments(
  transcriptId: string,
  supabase: SupabaseClient<Database>,
): Promise<TranscriptSegment[]> {
  const { data, error } = await supabase
    .from("transcript_segments")
    .select("id, speaker_key, speaker_role, start_ms, end_ms, content")
    .eq("transcript_id", transcriptId)
    .order("ordinal");
  if (error || !data?.length) throw new Error("TRANSCRIPT_UNAVAILABLE");
  return data;
}

export async function processSpeakerIdentificationJob(
  jobId: string,
  supabase: SupabaseClient<Database>,
) {
  for (let cycle = 0; cycle < MAX_ATTEMPTS; cycle += 1) {
    const { data: claim, error: claimError } = await supabase.rpc("claim_speaker_identification_job", {
      p_job_id: jobId,
    });
    if (claimError || !isClaimedSpeakerJob(claim)) return;
    try {
      const segments = await loadTranscriptSegments(claim.transcript_id, supabase);
      const assignments = await identifySpeakerRoles(segments);
      const { error: completeError } = await supabase.rpc("complete_speaker_identification_job", {
        p_job_id: jobId,
        p_assignments: assignments,
        p_model: CLINICAL_TEXT_MODEL,
      });
      if (completeError) throw new Error("SPEAKER_IDENTIFICATION_COMMIT_FAILED");

      const { data: draftingJob, error: draftingJobError } = await supabase
        .from("processing_jobs")
        .select("id")
        .eq("transcript_id", claim.transcript_id)
        .eq("kind", "drafting")
        .eq("status", "queued")
        .maybeSingle();
      if (draftingJobError) throw new Error("DRAFT_HANDOFF_FAILED");
      if (draftingJob) await processDraftingJob(draftingJob.id, supabase);
      return;
    } catch (error) {
      const { data: failedJob } = await supabase.rpc("fail_speaker_identification_job", {
        p_job_id: jobId,
        p_error_code: boundedErrorCode(error, "SPEAKER_IDENTIFICATION_FAILED"),
      });
      if (!failedJob || failedJob.status === "failed") return;
      await new Promise((resolve) => setTimeout(resolve, claim.attempt * 750));
    }
  }
}

export async function processDraftingJob(
  jobId: string,
  supabase: SupabaseClient<Database>,
) {
  for (let cycle = 0; cycle < MAX_ATTEMPTS; cycle += 1) {
    const { data: claim, error: claimError } = await supabase.rpc("claim_drafting_job", {
      p_job_id: jobId,
    });
    if (claimError || !isClaimedDraftingJob(claim)) return;
    try {
      const segments = await loadTranscriptSegments(claim.transcript_id, supabase);
      if (segments.some((segment) => !["clinician", "patient"].includes(segment.speaker_role))) {
        throw new Error("SPEAKER_CONFIRMATION_REQUIRED");
      }
      const soap = await draftSoap(segments);
      const { error: completeError } = await supabase.rpc("complete_drafting_job", {
        p_job_id: jobId,
        p_content: soap,
        p_model: CLINICAL_TEXT_MODEL,
        p_prompt_version: SOAP_PROMPT_VERSION,
      });
      if (completeError) throw new Error(
        completeError.code === "40001" ? "DRAFT_VERSION_CONFLICT" : "DRAFT_COMMIT_FAILED",
      );
      return;
    } catch (error) {
      const { data: failedJob } = await supabase.rpc("fail_drafting_job", {
        p_job_id: jobId,
        p_error_code: boundedErrorCode(error, "DRAFT_PROCESSING_FAILED"),
      });
      if (!failedJob || failedJob.status === "failed") return;
      await new Promise((resolve) => setTimeout(resolve, claim.attempt * 750));
    }
  }
}
