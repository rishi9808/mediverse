import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { processSpeakerIdentificationJob } from "@/lib/clinical-ai";
import type { Database, Json } from "@/lib/database.types";

const TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const MAX_ATTEMPTS = 3;

type ClaimedJob = {
  state: "claimed";
  attempt: number;
  bucket_id: string;
  object_path: string;
  mime_type: string;
  duration_ms: number;
};

type DiarizedSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
};

type DiarizedResponse = {
  segments?: DiarizedSegment[];
};

const FILE_EXTENSIONS: Record<string, string> = {
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

function isClaimedJob(value: Json): value is ClaimedJob & Json {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  return value.state === "claimed" &&
    typeof value.attempt === "number" &&
    typeof value.bucket_id === "string" &&
    typeof value.object_path === "string" &&
    typeof value.mime_type === "string" &&
    typeof value.duration_ms === "number";
}

function safeProviderErrorCode(status: number) {
  if (status === 401 || status === 403) return "OPENAI_AUTH_UNAVAILABLE";
  if (status === 429) return "OPENAI_RATE_LIMITED";
  if (status >= 500) return "OPENAI_UNAVAILABLE";
  return "OPENAI_TRANSCRIPTION_REJECTED";
}

function normalizeSegments(response: DiarizedResponse, durationMs: number): Json[] {
  if (!Array.isArray(response.segments) || response.segments.length === 0) {
    throw new Error("INVALID_PROVIDER_RESPONSE");
  }

  const providerIds = new Set<string>();
  return response.segments.map((segment) => {
    const id = typeof segment.id === "string" ? segment.id.trim() : "";
    const speaker = typeof segment.speaker === "string" ? segment.speaker.trim() : "";
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    const rawStartMs = Math.round(Number(segment.start) * 1000);
    const rawEndMs = Math.round(Number(segment.end) * 1000);
    const startMs = Math.max(0, Math.min(rawStartMs, durationMs - 1));
    const endMs = Math.max(startMs + 1, Math.min(rawEndMs, durationMs));

    if (
      !id || id.length > 160 || providerIds.has(id) ||
      !speaker || speaker.length > 80 ||
      !text || text.length > 20_000 ||
      !Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs) || rawEndMs <= rawStartMs
    ) {
      throw new Error("INVALID_PROVIDER_RESPONSE");
    }
    providerIds.add(id);
    return { id, speaker, text, start_ms: startMs, end_ms: endMs };
  });
}

async function transcribeAudio(audio: Blob, job: ClaimedJob) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_CONFIGURATION_UNAVAILABLE");

  const formData = new FormData();
  const extension = FILE_EXTENSIONS[job.mime_type] ?? "webm";
  formData.append("file", audio, `session-audio.${extension}`);
  formData.append("model", TRANSCRIPTION_MODEL);
  formData.append("response_format", "diarized_json");
  formData.append("chunking_strategy", "auto");
  formData.append("language", "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(safeProviderErrorCode(response.status));

  const payload = await response.json() as DiarizedResponse;
  return normalizeSegments(payload, job.duration_ms);
}

function boundedErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "OPENAI_TIMEOUT";
  return "TRANSCRIPTION_PROCESSING_FAILED";
}

export async function processTranscriptionJob(
  jobId: string,
  supabase: SupabaseClient<Database>,
) {
  for (let cycle = 0; cycle < MAX_ATTEMPTS; cycle += 1) {
    const { data: claim, error: claimError } = await supabase.rpc("claim_transcription_job", {
      p_job_id: jobId,
    });
    if (claimError || !isClaimedJob(claim)) return;

    try {
      const { data: audio, error: downloadError } = await supabase.storage
        .from(claim.bucket_id)
        .download(claim.object_path);
      if (downloadError || !audio) throw new Error("AUDIO_DOWNLOAD_FAILED");

      const segments = await transcribeAudio(audio, claim);
      const { data: transcript, error: completeError } = await supabase.rpc("complete_transcription_job", {
        p_job_id: jobId,
        p_segments: segments,
      });
      if (completeError || !transcript) throw new Error("TRANSCRIPT_COMMIT_FAILED");
      const { data: speakerJob } = await supabase
        .from("processing_jobs")
        .select("id")
        .eq("transcript_id", transcript.id)
        .eq("kind", "speaker_identification")
        .maybeSingle();
      if (speakerJob) await processSpeakerIdentificationJob(speakerJob.id, supabase);
      return;
    } catch (error) {
      const { data: failedJob } = await supabase.rpc("fail_transcription_job", {
        p_job_id: jobId,
        p_error_code: boundedErrorCode(error),
      });
      if (!failedJob || failedJob.status === "failed") return;
      await new Promise((resolve) => setTimeout(resolve, claim.attempt * 750));
    }
  }
}
