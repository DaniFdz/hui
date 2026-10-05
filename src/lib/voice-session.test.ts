import assert from "node:assert/strict";
import { test } from "node:test";
import { callMessages, chatBusy } from "./voice-session.ts";

test("only an idle chat takes what a call says as a prompt", () => {
  for (const status of ["running", "waiting", "starting"] as const) assert.equal(chatBusy(status), true, status);
  for (const status of ["idle", "error", "reconnecting", "disconnected"] as const) assert.equal(chatBusy(status), false, status);
});

test("a call reads only the chat's settled messages from its snapshot", () => {
  assert.deepEqual(callMessages([
    { kind: "message", role: "user", text: "[voice] Hello" },
    { kind: "thinking", text: "hm" },
    { kind: "message", role: "assistant", text: "Hi there." },
    { kind: "message", role: "user", text: "queued", pending: true },
    { kind: "message", role: "user", text: "refused", failed: true },
  ]), [{ role: "user", text: "[voice] Hello" }, { role: "assistant", text: "Hi there." }]);
});
