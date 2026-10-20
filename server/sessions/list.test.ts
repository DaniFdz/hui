import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { createSessionListHub } from "./list.ts";

type Session = { id: string; title: string };
type Group = { label: string; sessions: Session[] };
type Frame = { revision: number; groups?: unknown[]; upserts: Session[] };
const golden: { lists: Group[][]; frames: Frame[] } = JSON.parse(readFileSync(new URL("./list.fixture.json", import.meta.url), "utf8"));

test("screens share one list: a full list on join, then only what changed, as the golden frames", async () => {
  let next: Group[] = [];
  const hub = createSessionListHub<Session>(async () => next, 60_000);
  const phone: Frame[] = [];
  const stopPhone = hub.subscribe((update) => phone.push(update));
  for (const list of golden.lists) {
    next = list;
    await hub.refresh();
    await hub.refresh(); // Unchanged: nothing is sent.
  }
  const first = phone[0]?.revision ?? 0;
  assert.ok(first > Date.now() - 60_000, "revisions keep rising across gateway restarts");
  assert.deepEqual(phone.map((frame) => ({ ...frame, revision: frame.revision - first })), golden.frames);

  // A late joiner gets the current list, not a replay.
  const mac: Frame[] = [];
  const stopMac = hub.subscribe((update) => mac.push(update));
  await hub.refresh();
  const last = golden.frames.at(-1)!;
  assert.deepEqual(mac, [{ revision: first + last.revision, groups: last.groups, upserts: golden.lists.at(-1)!.flatMap((group) => group.sessions) }]);
  // A screen that already holds the current list, from a GET or before a reconnect, is not sent it again.
  const reconnected: Frame[] = [];
  const stopReconnected = hub.subscribe((update) => reconnected.push(update), first + last.revision);
  const stale: Frame[] = [];
  const stopStale = hub.subscribe((update) => stale.push(update), first + last.revision - 1);
  await hub.refresh();
  assert.deepEqual(reconnected, []);
  assert.deepEqual(stale.map((frame) => frame.revision), [first + last.revision]);
  stopPhone();
  stopMac();
  stopReconnected();
  stopStale();
});

test("a screen that joins after every screen left gets the list as it is now", async () => {
  let next: Group[] = [{ label: "work", sessions: [{ id: "a", title: "A" }] }];
  const hub = createSessionListHub<Session>(async () => next, 60_000);
  const stopFirst = hub.subscribe(() => {});
  await hub.refresh();
  stopFirst();

  next = [{ label: "work", sessions: [{ id: "a", title: "A" }, { id: "b", title: "B" }] }];
  const frames: Frame[] = [];
  const stop = hub.subscribe((update) => frames.push(update));
  await hub.refresh();
  assert.deepEqual(frames.map((frame) => frame.upserts.map(({ id }) => id)), [["a", "b"]]);
  stop();
});
