import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { processSpeakerIdentificationJob } from "@/lib/clinical-ai";
import type { Database, Json } from "@/lib/database.types";
import { transcribeAudio } from "@/lib/transcription-provider";

const MAX_ATTEMPTS = 3;

type ClaimedJob = {
  state: "claimed";
  attempt: number;
  bucket_id: string;
  object_path: string;
  mime_type: string;
  duration_ms: number;
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

function boundedErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "TRANSCRIPTION_TIMEOUT";
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

      const result = await transcribeAudio({
        audio,
        mimeType: claim.mime_type,
        durationMs: claim.duration_ms,
      });
      const { data: transcript, error: completeError } = await supabase.rpc("complete_transcription_job", {
        p_job_id: jobId,
        p_segments: result.segments,
        p_provider: result.provider,
        p_model: result.model,
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
