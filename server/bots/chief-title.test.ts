/** A group chief's title carries its group after the middle dot; a normal title does not grant the chief's tools. An
 * Autonomous session's chief is its group's, else the Chief of Staff of no group, unless a chief already watches it. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { chiefToWatch, isChiefTitle } from "./chief-title.ts";

test("a Chief of Staff title is the seeded one or a group chief's suffix", () => {
  assert.equal(isChiefTitle("Chief of Staff"), true);
  assert.equal(isChiefTitle("Chief of Staff · critical path"), true);
  assert.equal(isChiefTitle(" Critical Path Bot "), false);
  assert.equal(isChiefTitle("Chief of Staff Assistant"), false);
  assert.equal(isChiefTitle(undefined), false);
});

test("an Autonomous session's new chief is its group's, else the Chief of Staff of no group, and none while a chief watches it", () => {
  const seeded = { id: "seeded", title: "Chief of Staff", sessionId: "seeded-chat" };
  const payments = { id: "payments", title: "Chief of Staff · Payments", group: "Payments", sessionId: "payments-chat" };
  const helper = { id: "helper", title: "Release helper", group: "Releases", sessionId: "helper-chat" };
  const archived = { id: "archived", title: "Chief of Staff · Search", group: "Search", archived: true, sessionId: "search-chat" };
  const bots = [helper, archived, payments, seeded];
  const unwatched = [{ id: "seeded-chat" }, { id: "payments-chat" }, { id: "helper-chat", watches: ["task"] }];
  assert.equal(chiefToWatch(bots, unwatched, { id: "task", group: "Payments" })?.id, "payments");
  assert.equal(chiefToWatch(bots, unwatched, { id: "task", group: "" })?.id, "seeded");
  assert.equal(chiefToWatch(bots, unwatched, { id: "task", group: "Releases" })?.id, "seeded");
  assert.equal(chiefToWatch(bots, unwatched, { id: "task", group: "Search" })?.id, "seeded");
  assert.equal(chiefToWatch([helper, payments], unwatched, { id: "task", group: "Releases" }), undefined);
  assert.equal(chiefToWatch(bots, [{ id: "seeded-chat", watches: ["task"] }], { id: "task", group: "Payments" }), undefined);
});
