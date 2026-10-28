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

test("a screen asking for the list while a poller runs gets what it already holds, without another read", async () => {
  let reads = 0;
  let next: Group[] = [{ label: "work", sessions: [{ id: "a", title: "A" }] }];
  const hub = createSessionListHub<Session>(async () => {
    reads += 1;
    return next;
  }, 60_000);

  const stop = hub.subscribe(() => {});
  const first = await hub.snapshot();
  assert.equal(reads, 1);
  assert.deepEqual(first.groups, next);

  next = [{ label: "work", sessions: [{ id: "a", title: "A" }, { id: "b", title: "B" }] }];
  assert.deepEqual((await hub.snapshot()).groups, first.groups, "the poller's list, not a fresh read");
  assert.equal(reads, 1, "an unchanged poller state is not recomputed per request");

  stop();
  // With nobody polling, the next ask reads the registry again.
  const afterStop = await hub.snapshot();
  assert.equal(reads, 2);
  assert.deepEqual(afterStop.groups, next);
});

test("a change since the list was built is read again before it is answered", async () => {
  let reads = 0;
  let changed = false;
  let next: Group[] = [{ label: "work", sessions: [{ id: "a", title: "A" }] }];
  const hub = createSessionListHub<Session>(async () => {
    reads += 1;
    return next;
  }, 60_000, () => changed);

  const stop = hub.subscribe(() => {});
  await hub.snapshot();
  assert.equal(reads, 1);

  // A session was just created: the poller has not seen it yet, the screen must.
  changed = true;
  next = [{ label: "work", sessions: [{ id: "a", title: "A" }, { id: "b", title: "B" }] }];
  const answered = await hub.snapshot();
  assert.equal(reads, 2);
  assert.deepEqual(answered.groups.flatMap((group) => group.sessions.map(({ id }) => id)), ["a", "b"]);
  stop();
});
