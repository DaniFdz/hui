import assert from "node:assert/strict";
import test from "node:test";
import { applySessionListUpdate, type SessionListGroup, type SessionListUpdate } from "../shared/session-list.ts";
import { createSessionListHub } from "./session-list.ts";

type Session = { id: string; title: string };
const list = (...groups: [string, ...Session[]][]): SessionListGroup<Session>[] =>
  groups.map(([label, ...sessions]) => ({ label, sessions }));

test("screens share one list: a full list on join, then only what changed", async () => {
  const a = { id: "a", title: "A" };
  const b = { id: "b", title: "B" };
  let next = list(["work", a, b]);
  const hub = createSessionListHub<Session>(async () => next, 60_000);
  const phone: SessionListUpdate<Session>[] = [];
  const stopPhone = hub.subscribe((update) => phone.push(update));
  await hub.refresh();

  next = list(["work", a, { ...b, title: "B2" }]);
  await hub.refresh();
  await hub.refresh(); // Unchanged: nothing is sent.
  const first = phone[0]?.revision ?? 0;
  assert.ok(first > Date.now() - 60_000, "revisions keep rising across gateway restarts");
  assert.deepEqual(phone.map(({ revision, groups, upserts }) => ({ revision: revision - first, groups: Boolean(groups), ids: upserts.map(({ id }) => id) })), [
    { revision: 0, groups: true, ids: ["a", "b"] },
    { revision: 1, groups: false, ids: ["b"] },
  ]);

  // A late joiner gets the current list immediately, not a replay.
  const mac: SessionListUpdate<Session>[] = [];
  const stopMac = hub.subscribe((update) => mac.push(update));
  next = list(["done", b], ["work"]);
  const latest = await hub.refresh();

  for (const updates of [phone, mac]) {
    const applied = updates.reduce<SessionListGroup<Session>[]>((groups, update) => applySessionListUpdate(groups, update), []);
    assert.deepEqual(applied, latest.groups);
  }
  assert.equal(mac[0]?.revision, first + 1);
  assert.equal(latest.revision, first + 2);
  stopPhone();
  stopMac();
});
