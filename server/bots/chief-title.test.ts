/** A group chief's title carries its group after the middle dot; a normal title does not grant the chief's tools. A
 * session's chief is its group's, else the Chief of Staff of no group. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { chiefFor, isChiefTitle } from "./chief-title.ts";

test("a Chief of Staff title is the seeded one or a group chief's suffix", () => {
  assert.equal(isChiefTitle("Chief of Staff"), true);
  assert.equal(isChiefTitle("Chief of Staff · critical path"), true);
  assert.equal(isChiefTitle(" Critical Path Bot "), false);
  assert.equal(isChiefTitle("Chief of Staff Assistant"), false);
  assert.equal(isChiefTitle(undefined), false);
});

test("a session's chief is its group's chief, else the Chief of Staff of no group, never an archived bot or a helper", () => {
  const seeded = { id: "seeded", title: "Chief of Staff" };
  const payments = { id: "payments", title: "Chief of Staff · Payments", group: "Payments" };
  const helper = { id: "helper", title: "Release helper", group: "Releases" };
  const archived = { id: "archived", title: "Chief of Staff · Search", group: "Search", archived: true };
  const bots = [helper, archived, payments, seeded];
  assert.equal(chiefFor(bots, "Payments")?.id, "payments");
  assert.equal(chiefFor(bots, "")?.id, "seeded");
  assert.equal(chiefFor(bots, "Releases")?.id, "seeded");
  assert.equal(chiefFor(bots, "Search")?.id, "seeded");
  assert.equal(chiefFor([helper, payments], "Releases"), undefined);
});
