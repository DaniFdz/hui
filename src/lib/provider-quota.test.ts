/** What a provider account's limits line and account order say, as pure values: the label PI's quota payload
 * supports, nothing it does not report, and the priority order a drag commits. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { quotaMetaLine, quotaStatusLabel, reorderAccountIds } from "./provider-quota.ts";

test("the limits line names what the connection reports, and nothing it does not", () => {
  assert.equal(quotaStatusLabel({ status: "available", access: "limited" }), "Limit reached");
  assert.equal(quotaStatusLabel({ status: "unavailable", access: "available" }), "Available", "an access answer wins over the read status");
  assert.equal(quotaStatusLabel({ status: "available" }), "Usage reported");
  assert.equal(quotaStatusLabel({ status: "unsupported" }), "Not supported");
  assert.equal(quotaStatusLabel({ status: "unavailable" }), "Unavailable");
});

test("the limits line is the status, the reported plan and the checked time, in that order", () => {
  const checked = "9/27/2026, 3:04:12 PM";
  assert.deepEqual(quotaMetaLine({ status: "unsupported" }, checked).split(" · "), ["Not supported", `Checked ${checked}`]);
  assert.deepEqual(quotaMetaLine({ status: "available", plan: "plus" }, checked).split(" · "), ["Usage reported", "Plan plus", `Checked ${checked}`]);
  assert.deepEqual(quotaMetaLine({ status: "unavailable", access: "limited", plan: "pro" }, checked).split(" · "), ["Limit reached", "Plan pro", `Checked ${checked}`]);
  assert.doesNotMatch(quotaMetaLine({ status: "unavailable" }, checked), /Plan|Not reported/u, "a missing plan says nothing, not that it is missing");
});

test("a dropped account lands where it was dragged, and the others keep their order", () => {
  assert.deepEqual(reorderAccountIds(["a", "b", "c"], "a", 2), ["b", "c", "a"], "the first account dragged to the end");
  assert.deepEqual(reorderAccountIds(["a", "b", "c"], "c", 0), ["c", "a", "b"], "the last account dragged to the front");
  assert.deepEqual(reorderAccountIds(["a", "b", "c"], "b", 1), ["a", "b", "c"], "a drop where it already is keeps the order");
  assert.deepEqual(reorderAccountIds(["a", "b", "c", "d"], "b", 2), ["a", "c", "b", "d"]);
});

test("a drop past either end commits a real order instead of losing the account", () => {
  assert.deepEqual(reorderAccountIds(["a", "b", "c"], "a", 99), ["b", "c", "a"]);
  assert.deepEqual(reorderAccountIds(["a", "b", "c"], "c", -3), ["c", "a", "b"]);
  const order = ["a", "b"];
  assert.equal(reorderAccountIds(order, "missing", 1), order, "an id the list does not hold is not a reorder");
  assert.deepEqual(order, ["a", "b"], "the helper never mutates the order it is given");
});
