import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type DeletionClaim = {
  state: "empty" | "claimed";
  job_id?: string;
  audio_asset_id?: string;
  bucket_id?: string;
  object_path?: string;
};

type RetentionClient = Pick<ReturnType<typeof createClient<Database>>, "rpc" | "storage">;

export type AudioRetentionRun = {
  claimed: number;
  deleted: number;
  alreadyMissing: number;
  failed: number;
};

function isMissingObjectError(error: { message?: string; statusCode?: string | number } | null) {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return String(error.statusCode) === "404" || message.includes("not found") || message.includes("does not exist");
}

export function createAudioRetentionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("A Supabase URL and server-only secret key are required for audio retention.");
  }

  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function processDueAudioDeletions(
  supabase: RetentionClient,
  limit = 20,
): Promise<AudioRetentionRun> {
  const result: AudioRetentionRun = { claimed: 0, deleted: 0, alreadyMissing: 0, failed: 0 };

  for (let index = 0; index < limit; index += 1) {
    const { data, error: claimError } = await supabase.rpc("claim_audio_deletion_job");
    if (claimError) throw new Error("AUDIO_DELETION_CLAIM_FAILED");

    const claim = data as DeletionClaim | null;
    if (!claim || claim.state === "empty") break;
    if (!claim.job_id || !claim.audio_asset_id || !claim.bucket_id || !claim.object_path) {
      throw new Error("AUDIO_DELETION_CLAIM_INVALID");
    }
    result.claimed += 1;

    const { error: removalError } = await supabase.storage
      .from(claim.bucket_id)
      .remove([claim.object_path]);
    const alreadyMissing = isMissingObjectError(removalError);

    if (!removalError || alreadyMissing) {
      const { error: completionError } = await supabase.rpc("complete_audio_deletion_job", {
        p_job_id: claim.job_id,
        p_audio_asset_id: claim.audio_asset_id,
      });
      if (completionError) throw new Error("AUDIO_DELETION_COMMIT_FAILED");
      if (alreadyMissing) result.alreadyMissing += 1;
      else result.deleted += 1;
      continue;
    }

    result.failed += 1;
    const { error: failureError } = await supabase.rpc("fail_audio_deletion_job", {
      p_job_id: claim.job_id,
      p_error_code: "STORAGE_REMOVE_FAILED",
    });
    if (failureError) throw new Error("AUDIO_DELETION_FAILURE_AUDIT_FAILED");
  }

  return result;
}
