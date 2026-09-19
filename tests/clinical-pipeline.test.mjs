import assert from "node:assert/strict";
import test from "node:test";

import { generateInitialClinicalDraft } from "../lib/clinical-pipeline.ts";

const segments = [
  {
    id: "segment-1",
    speaker_key: "speaker_0",
    speaker_role: "unknown",
    start_ms: 0,
    end_ms: 1_000,
    content: "What felt most difficult this week?",
  },
  {
    id: "segment-2",
    speaker_key: "speaker_1",
    speaker_role: "unknown",
    start_ms: 1_000,
    end_ms: 2_000,
    content: "I felt tense before work.",
  },
];

test("initial clinical generation produces speaker roles and SOAP in one provider request", async () => {
  let calls = 0;
  const result = await generateInitialClinicalDraft(segments, async (schemaName, schema, _system, input) => {
    calls += 1;
    assert.equal(schemaName, "speaker_roles_and_evidence_linked_soap");
    assert.match(input, /segment-1/);
    assert.match(input, /segment-2/);
    assert.deepEqual(schema.properties.assignments.items.properties.speaker_key.enum, ["speaker_0", "speaker_1"]);
    assert.deepEqual(schema.properties.soap.properties.subjective.items.properties.segment_ids.items.enum, ["segment-1", "segment-2"]);
    return {
      assignments: [
        { speaker_key: "speaker_0", role: "clinician" },
        { speaker_key: "speaker_1", role: "patient" },
      ],
      soap: {
        subjective: [{ text: "Reports tension before work.", segment_ids: ["segment-2"] }],
        objective: [],
        assessment: [],
        plan: [],
      },
    };
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.assignments, { speaker_0: "clinician", speaker_1: "patient" });
  assert.equal(result.soap.subjective[0].origin, "transcript");
});

test("initial clinical generation rejects SOAP evidence outside the transcript", async () => {
  await assert.rejects(
    generateInitialClinicalDraft(segments, async () => ({
      assignments: [
        { speaker_key: "speaker_0", role: "clinician" },
        { speaker_key: "speaker_1", role: "patient" },
      ],
      soap: {
        subjective: [{ text: "Unsupported statement.", segment_ids: ["unknown-segment"] }],
        objective: [],
        assessment: [],
        plan: [],
      },
    })),
    /INVALID_SOAP_EVIDENCE/,
  );
});
