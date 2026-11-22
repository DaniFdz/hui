import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionRefFallbackText, sessionRefUpdate } from "./session-ref.ts";

const ID = "195c3659-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "195c3659-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const shown = { id: ID, title: "Fix the drawer", status: "Running" };

test("a chip with nothing drawn yet, or one naming another session, is rebuilt", () => {
  assert.equal(sessionRefUpdate(undefined, shown), "rebuild", "the first resolve draws the chip");
  assert.equal(sessionRefUpdate(shown, { ...shown, id: OTHER }), "rebuild", "another session is another chip");
});

test("a title or status change is written into the chip already drawn", () => {
  assert.equal(sessionRefUpdate(shown, { ...shown, title: "Fix the zipper" }), "in-place");
  assert.equal(sessionRefUpdate(shown, { ...shown, status: "Idle" }), "in-place", "a status flip keeps the focused anchor");
  assert.equal(sessionRefUpdate(shown, { ...shown, title: "Fix the zipper", status: "Idle" }), "in-place");
});

test("a chip that already says what the registry says is left alone", () => {
  assert.equal(sessionRefUpdate(shown, { ...shown }), "none");
});

test("an unresolved reference reads exactly the text that was typed", () => {
  assert.equal(sessionRefFallbackText("195c3659"), "session:195c3659");
});
