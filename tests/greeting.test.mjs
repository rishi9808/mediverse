import assert from "node:assert/strict";
import test from "node:test";

import { getIndiaTimeGreeting } from "../lib/greeting.ts";

test("uses Indian time for the dashboard greeting", () => {
  assert.equal(getIndiaTimeGreeting(new Date("2026-09-20T06:29:00Z")), "morning");
  assert.equal(getIndiaTimeGreeting(new Date("2026-09-20T06:30:00Z")), "afternoon");
  assert.equal(getIndiaTimeGreeting(new Date("2026-09-20T12:29:00Z")), "afternoon");
  assert.equal(getIndiaTimeGreeting(new Date("2026-09-20T12:30:00Z")), "evening");
});
