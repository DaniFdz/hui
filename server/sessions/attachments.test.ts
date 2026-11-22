/** Keeps the gateway's caps on the numbers the browser holds: both sides read the same portable fixture, so a limit
 * changed on one of them fails here instead of at a prompt or an upload. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { MAX_UPLOAD_FILE_BYTES } from "../files.ts";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT, MAX_ATTACHMENTS_TOTAL_BYTES } from "./attachments.ts";

const fixture: {
  maxCount: number;
  maxItemBytes: number;
  maxTotalBytes: number;
  filesPaneMaxBytes: number;
} = JSON.parse(readFileSync(new URL("./attachments.fixture.json", import.meta.url), "utf8"));

test("attachment caps match the fixture the browser reads", () => {
  assert.equal(MAX_ATTACHMENT_COUNT, fixture.maxCount);
  assert.equal(MAX_ATTACHMENT_BYTES, fixture.maxItemBytes);
  assert.equal(MAX_ATTACHMENTS_TOTAL_BYTES, fixture.maxTotalBytes);
});

/** The browser mirrors the Files pane's cap in `src/lib/attachments.ts`, which R6 in `docs/map.md` keeps from reading
 * a value out of `src/api/`, and `src/lib/attachments.test.ts` holds that mirror to this same fixture: one number
 * decides all three copies. */
test("the Files pane's upload cap matches the fixture the browser reads", () => {
  assert.equal(MAX_UPLOAD_FILE_BYTES, fixture.filesPaneMaxBytes);
});
