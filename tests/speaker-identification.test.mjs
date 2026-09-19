import assert from "node:assert/strict";
import test from "node:test";

import { buildSpeakerIdentificationInput } from "../lib/speaker-identification.ts";

test("speaker identification uses bounded excerpts spread across a long transcript", () => {
  const longText = "x".repeat(5_000);
  const segments = Array.from({ length: 200 }, (_, index) => ({
    id: `segment-${index}`,
    speaker_key: index % 2 === 0 ? "speaker_0" : "speaker_1",
    start_ms: index * 30_000,
    end_ms: (index + 1) * 30_000,
    content: `${index === 0 ? "FIRST_ZERO" : ""}${index === 1 ? "FIRST_ONE" : ""}${index === 198 ? "LAST_ZERO" : ""}${index === 199 ? "LAST_ONE" : ""}${longText}`,
  }));

  const input = buildSpeakerIdentificationInput(segments);
  const excerpts = input.split("\n").map((line) => JSON.parse(line));

  assert.equal(excerpts.length, 16);
  assert.ok(input.length < 15_000);
  assert.deepEqual(new Set(excerpts.map((excerpt) => excerpt.speaker_key)), new Set(["speaker_0", "speaker_1"]));
  assert.ok(input.includes("FIRST_ZERO"));
  assert.ok(input.includes("FIRST_ONE"));
  assert.ok(input.includes("LAST_ZERO"));
  assert.ok(input.includes("LAST_ONE"));
});

test("speaker identification keeps every excerpt for a short transcript", () => {
  const segments = [
    { id: "one", speaker_key: "speaker_0", start_ms: 0, end_ms: 1_000, content: "How have you felt this week?" },
    { id: "two", speaker_key: "speaker_1", start_ms: 1_000, end_ms: 2_000, content: "I felt less anxious." },
  ];

  const excerpts = buildSpeakerIdentificationInput(segments).split("\n");
  assert.equal(excerpts.length, segments.length);
  assert.match(excerpts[0], /How have you felt this week/);
  assert.match(excerpts[1], /I felt less anxious/);
});
