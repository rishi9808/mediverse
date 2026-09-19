import assert from "node:assert/strict";
import test from "node:test";

import { processDueAudioDeletions } from "../lib/audio-retention.ts";

function mockClient(removalError = null) {
  const calls = [];
  let claimed = false;
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_audio_deletion_job") {
        if (claimed) return { data: { state: "empty" }, error: null };
        claimed = true;
        return {
          data: {
            state: "claimed",
            job_id: "job-1",
            audio_asset_id: "asset-1",
            bucket_id: "session-audio",
            object_path: "clinician/session/asset-1",
          },
          error: null,
        };
      }
      return { data: {}, error: null };
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          calls.push({ name: "storage.remove", bucket, paths });
          return { data: removalError ? null : [], error: removalError };
        },
      }),
    },
  };
  return { calls, client };
}

test("deletes the exact Storage object before completing the audit job", async () => {
  const { calls, client } = mockClient();
  const result = await processDueAudioDeletions(client, 2);

  assert.deepEqual(result, { claimed: 1, deleted: 1, alreadyMissing: 0, failed: 0 });
  assert.equal(calls[1].name, "storage.remove");
  assert.deepEqual(calls[1].paths, ["clinician/session/asset-1"]);
  assert.equal(calls[2].name, "complete_audio_deletion_job");
});

test("treats an already-missing exact object as idempotent completion", async () => {
  const { calls, client } = mockClient({ message: "Object not found", statusCode: 404 });
  const result = await processDueAudioDeletions(client, 2);

  assert.deepEqual(result, { claimed: 1, deleted: 0, alreadyMissing: 1, failed: 0 });
  assert.equal(calls[2].name, "complete_audio_deletion_job");
});

test("records a sanitized failure and leaves metadata undeleted when Storage removal fails", async () => {
  const { calls, client } = mockClient({ message: "provider detail", statusCode: 500 });
  const result = await processDueAudioDeletions(client, 2);

  assert.deepEqual(result, { claimed: 1, deleted: 0, alreadyMissing: 0, failed: 1 });
  assert.equal(calls[2].name, "fail_audio_deletion_job");
  assert.equal(calls[2].args.p_error_code, "STORAGE_REMOVE_FAILED");
  assert.equal(calls.some((call) => call.name === "complete_audio_deletion_job"), false);
});
