import assert from "node:assert/strict";
import { test } from "vitest";
import { chatRows } from "./chat-rows.ts";

test("message rows carry the text they show, whether it is Markdown and their footer's Copy label", () => {
  const rows = chatRows([
    { kind: "message", id: "u", role: "user", text: "Mine" },
    { kind: "message", id: "a", role: "assistant", text: "**Reply**" },
    { kind: "message", id: "b", role: "user", text: "[from @grace] Report" },
    { kind: "message", id: "r", role: "user", text: "[routine: Inbox] Summarize" },
    { kind: "message", id: "p", role: "user", text: "Sending", pending: true },
  ]);
  assert.deepEqual(rows.map((row) => row.kind === "messages" ? [row.messages[0]!.shown, row.messages[0]!.markdown, row.footer?.copyLabel ?? null] : row.kind), [
    ["Mine", false, "Copy prompt"],
    ["**Reply**", true, "Copy response"],
    ["Report", true, "Copy message"],
    ["Summarize", false, "Copy message"],
    ["Sending", false, null],
  ]);
});
