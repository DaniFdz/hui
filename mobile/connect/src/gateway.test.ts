/** The Connect page's checks: which addresses it accepts, what counts as a HUI gateway, and the development notice. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { DEVELOPMENT_GATEWAY, normalizeGateway, readSnapshot, versionNotice } from "./gateway.ts";

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
