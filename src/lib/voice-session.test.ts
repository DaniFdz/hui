import assert from "node:assert/strict";
import { test } from "node:test";
import { chatBusy } from "./voice-session.ts";

test("only an idle chat takes what a call says as a prompt", () => {
  for (const status of ["running", "waiting", "starting"] as const) assert.equal(chatBusy(status), true, status);
  for (const status of ["idle", "error", "reconnecting", "disconnected"] as const) assert.equal(chatBusy(status), false, status);
});
