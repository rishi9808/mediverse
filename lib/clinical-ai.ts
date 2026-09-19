import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateInitialClinicalDraft,
  serializeTranscript,
  soapSchema,
  type TranscriptSegment,
  validateSoapOutput,
} from "@/lib/clinical-pipeline";
import type { Database, Json } from "@/lib/database.types";
import type { SoapDocument } from "@/lib/soap";

export const CLINICAL_TEXT_MODEL = process.env.OPENAI_CLINICAL_MODEL ?? "gpt-4o-mini-2024-07-18";
export const SOAP_PROMPT_VERSION = "evidence-soap-v1";
export const INITIAL_SOAP_PROMPT_VERSION = "speaker-roles-evidence-soap-v2";
const MAX_ATTEMPTS = 3;

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
      const initialDraft = await generateInitialClinicalDraft(
        segments,
        (schemaName, schema, system, input) =>
          requestStructuredOutput<unknown>(schemaName, schema, system, input),
      );
      const { error: completeError } = await supabase.rpc("complete_speaker_identification_job", {
        p_job_id: jobId,
        p_assignments: initialDraft.assignments,
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
      if (draftingJob) {
        await processDraftingJob(draftingJob.id, supabase, {
          soap: initialDraft.soap,
          promptVersion: INITIAL_SOAP_PROMPT_VERSION,
        });
      }
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
  prefetchedDraft?: { soap: SoapDocument; promptVersion: string },
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
      const soap = prefetchedDraft?.soap ?? await draftSoap(segments);
      const { error: completeError } = await supabase.rpc("complete_drafting_job", {
        p_job_id: jobId,
        p_content: soap,
        p_model: CLINICAL_TEXT_MODEL,
        p_prompt_version: prefetchedDraft?.promptVersion ?? SOAP_PROMPT_VERSION,
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
