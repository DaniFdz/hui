/**
 * Settings → Tools → Browser's cookie import: the row is an action, not a setting, so it saves nothing and the 4-second
 * status poll must leave its answer alone. The two pure helpers are what the row has of its own: the path a submission
 * sends and the report as the lines the gateway wrote it in.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { COOKIE_PATH_SENTENCE, cookieImportPath, cookieReportLines } from "./browser.ts";

const source = readFileSync(new URL("./browser.ts", import.meta.url), "utf8");

/** One method's own text, from its declaration to the next one, so a rule is checked against its owner alone. */
function method(start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} is in the module`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${end} follows it`);
  return source.slice(from, to);
}

test("an empty cookie field is refused with the route's own sentence, and a typed path is trimmed", () => {
  assert.deepEqual(cookieImportPath(""), { error: "Give an absolute path to the cookie file." });
  assert.deepEqual(cookieImportPath("  \n\t "), { error: COOKIE_PATH_SENTENCE }, "whitespace is no path either");
  assert.equal(COOKIE_PATH_SENTENCE, "Give an absolute path to the cookie file.", "the sentence the route answers with");
  assert.deepEqual(cookieImportPath("  /home/you/cookies.json \n"), { path: "/home/you/cookies.json" });
});

test("the import report keeps the gateway's lines, in its order", () => {
  assert.deepEqual(cookieReportLines("imported 2 cookies for 2 domains (0 expired dropped)\ndomains: .example.com, .example.org"), [
    "imported 2 cookies for 2 domains (0 expired dropped)",
    "domains: .example.com, .example.org",
  ]);
  assert.deepEqual(
    cookieReportLines("imported 1 cookie for 1 domain (3 expired dropped)\ndomains: .example.com\nThey apply when the managed browser next starts."),
    ["imported 1 cookie for 1 domain (3 expired dropped)", "domains: .example.com", "They apply when the managed browser next starts."],
  );
  assert.deepEqual(cookieReportLines(""), [], "no report draws nothing");
});

test("an import writes no setting and the status poll leaves its report alone", () => {
  const import_ = method("async #importCookies(event: SubmitEvent) {", "#renderCookieImport() {");
  assert.doesNotMatch(import_, /#save\(|onChange/u, "the path is an action, not a setting");
  const refresh = method("async #refresh(keepError = false) {", "/** Capture a tab when it first appears");
  assert.doesNotMatch(refresh, /#cookieReport|#cookieError|#importing/u, "the 4-second poll never clears what an import answered");
});
