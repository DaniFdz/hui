/** A group chief's title carries its group after the middle dot; a normal title does not grant the chief's tools. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { isChiefTitle } from "./chief-title.ts";

test("a Chief of Staff title is the seeded one or a group chief's suffix", () => {
  assert.equal(isChiefTitle("Chief of Staff"), true);
  assert.equal(isChiefTitle("Chief of Staff · critical path"), true);
  assert.equal(isChiefTitle(" Critical Path Bot "), false);
  assert.equal(isChiefTitle("Chief of Staff Assistant"), false);
  assert.equal(isChiefTitle(undefined), false);
});
