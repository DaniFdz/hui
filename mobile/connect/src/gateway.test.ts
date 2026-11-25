/** The Connect page's checks: which addresses it accepts, what counts as a HUI gateway, and the development notice. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { DEVELOPMENT_GATEWAY, normalizeGateway, normalizeGatewayName, readSnapshot, settingsWithName, versionNotice } from "./gateway.ts";

const CASES = readFileSync(new URL("../../gateway-addresses.txt", import.meta.url), "utf8")
  .split("\n")
  .map((line) => line.trimEnd())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line): [string, string | null] => {
    const [raw = "", expected = ""] = line.split(" -> ");
    return [raw.trim(), expected === "" ? null : expected];
  });

test.each(CASES)("a gateway address keeps its origin and path, or is refused: %s", (raw, expected) => {
  assert.equal(normalizeGateway(raw), expected);
});

test.each([[""], ["my-machine"], ["ftp://host"], ["javascript:alert(1)"], ["https://user:secret@host"]])(
  "a value that is not a gateway address is refused: %s",
  (raw) => {
    assert.equal(normalizeGateway(raw), null);
  },
);

test("a gateway's update snapshot is recognised by what it carries", () => {
  assert.deepEqual(readSnapshot({ currentVersion: "0.1.6", check: null, job: null }), { currentVersion: "0.1.6" });
  assert.deepEqual(readSnapshot({ currentVersion: null, check: null, job: null }), { currentVersion: null });
  for (const body of [null, "text", 42, [], {}, { currentVersion: "1" }, { job: null }, { currentVersion: 7, job: null }]) {
    assert.equal(readSnapshot(body), null, JSON.stringify(body) ?? "null");
  }
});

test("only a gateway with no release version gets the development notice", () => {
  assert.equal(versionNotice({ currentVersion: null }), DEVELOPMENT_GATEWAY);
  assert.equal(versionNotice({ currentVersion: "0.1.6" }), null);
});

test("a gateway name is trimmed and bounded as the gateway bounds it", () => {
  assert.equal(normalizeGatewayName("  Studio Mac  "), "Studio Mac");
  assert.equal(normalizeGatewayName("   "), "");
  assert.equal(normalizeGatewayName("x".repeat(80)), "x".repeat(60));
});

test("saving a name keeps every other gateway setting", () => {
  const settings = { name: "Old", browser: { theme: "dark" }, vscode: { path: "/code" } };
  assert.deepEqual(settingsWithName(settings, "  Studio  "), {
    name: "Studio",
    browser: { theme: "dark" },
    vscode: { path: "/code" },
  });
  assert.deepEqual(settings, { name: "Old", browser: { theme: "dark" }, vscode: { path: "/code" } }, "the read document is not mutated");
  for (const invalid of [null, "settings", 42, []]) {
    assert.equal(settingsWithName(invalid, "Studio"), null, JSON.stringify(invalid));
  }
});
