import assert from "node:assert/strict";
import { test } from "node:test";

import { chatGptLoginSummary } from "./settings-calls.ts";

test("Settings says which ChatGPT account calls use, or where to sign in", () => {
  const now = Date.parse("2026-10-06T14:00:00Z");
  assert.equal(chatGptLoginSummary(undefined, now), "Checking the ChatGPT login…");
  assert.equal(chatGptLoginSummary({ signedIn: true, account: { name: "Account 2", email: "dani@example.com" } }, now),
    "Calls use Account 2 (dani@example.com), the first ChatGPT account not waiting for its quota.");
  assert.equal(chatGptLoginSummary({ signedIn: true, account: { name: "Main" } }, now), "Calls use Main, the first ChatGPT account not waiting for its quota.");
  assert.match(chatGptLoginSummary({ signedIn: true, waitingUntil: Date.parse("2026-10-27T00:00:00Z") }, now), /^Every ChatGPT account is waiting for its quota until /u);
  assert.equal(chatGptLoginSummary({ signedIn: false }, now), "No ChatGPT login yet. Sign in under Providers above: OpenAI Codex, with your ChatGPT Plus or Pro account.");
});
