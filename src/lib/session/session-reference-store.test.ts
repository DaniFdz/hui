import assert from "node:assert/strict";
import { test } from "vitest";
import type { SessionGroup, SessionView } from "../../api/sessions.ts";
import {
  lookupSessionReference,
  parseSessionQuery,
  publishSessionReferences,
  sessionReferenceDetail,
  sessionReferenceLabel,
  subscribeSessionReferences,
} from "./session-reference-store.ts";

const ID = "195c3659-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "195c3659-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = (id: string, extra: Partial<SessionView> = {}) => ({ id, title: id, status: "idle", stage: "investigation", ...extra }) as SessionView;
const group = (...sessions: SessionView[]) => ({ label: "ungrouped", sessions }) as unknown as SessionGroup;

test("a reference names a full id or a hex prefix of at least eight characters", () => {
  assert.equal(parseSessionQuery(ID), ID);
  assert.equal(parseSessionQuery("195c3659"), "195c3659");
  assert.equal(parseSessionQuery(ID.toUpperCase()), ID, "a typed id is read in either case");
  assert.equal(parseSessionQuery("195C3659"), "195c3659");
  assert.equal(parseSessionQuery("195c365"), undefined, "seven characters is too short to be a session");
  assert.equal(parseSessionQuery("195c365g"), undefined, "a query is hexadecimal");
  assert.equal(parseSessionQuery(""), undefined, "a bare session: names nothing");
  assert.equal(parseSessionQuery("195c3659-aaaa"), undefined, "a partly dashed id is not a prefix");
});

test("a full id and a unique prefix resolve to the session the registry holds", () => {
  publishSessionReferences([group(session(ID, { title: "Fix the drawer" }))]);
  const byId = lookupSessionReference(ID);
  const byPrefix = lookupSessionReference("195c3659");
  assert.equal(byId?.id, ID);
  assert.equal(byPrefix, byId, "the same session, read once");
});

test("a prefix two sessions share is ambiguous, and so is one no session has", () => {
  publishSessionReferences([group(session(ID), session(OTHER))]);
  assert.equal(lookupSessionReference("195c3659"), undefined, "the prefix names both, so it names neither");
  assert.equal(lookupSessionReference(ID)?.id, ID, "a full id still resolves");
  assert.equal(lookupSessionReference("ffffffff"), undefined);
});

test("a registry id in another case resolves from any case of the query", () => {
  const shouted = ID.toUpperCase();
  publishSessionReferences([group(session(shouted, { title: "Fix the drawer" }))]);
  assert.equal(lookupSessionReference(ID)?.id, shouted, "the lowercase query names it, and the reference keeps the registry's id");
  assert.equal(lookupSessionReference(shouted)?.id, shouted);
  assert.equal(lookupSessionReference("195C3659")?.id, shouted, "so does a prefix in either case");
  assert.equal(lookupSessionReference("195c3659")?.title, "Fix the drawer");
});

test("a resolved reference carries the title, status, stage and pull requests the registry holds", () => {
  const pullRequests = [{ number: 7, repository: "hui", url: "https://example.com/7" }, { number: 8, repository: "hui", url: "https://example.com/8" }];
  publishSessionReferences([group(session(ID, { title: "Fix the drawer", status: "running", stage: "implementation", worker: { id: "w", name: "devbox" }, pullRequests }))]);
  const reference = lookupSessionReference("195c3659");
  assert.deepEqual(reference, {
    id: ID,
    title: "Fix the drawer",
    status: "running",
    worker: { id: "w", name: "devbox" },
    stage: "implementation",
    pullRequestCount: 2,
  });
  assert.equal(sessionReferenceLabel(reference!), "Open session Fix the drawer (Running)");
  assert.equal(sessionReferenceDetail(reference!), "Fix the drawer · Running · Implementation · 2 pull requests");
});

test("a reference with no stage and no pull request says only what it has", () => {
  publishSessionReferences([group(session(ID, { title: "Fix the drawer", stage: undefined }))]);
  const reference = lookupSessionReference(ID);
  assert.equal(reference?.stage, undefined);
  assert.equal(sessionReferenceDetail(reference!), "Fix the drawer · Idle");
  assert.equal(sessionReferenceDetail({ ...reference!, pullRequestCount: 1 }), "Fix the drawer · Idle · 1 pull request");
});

test("listeners hear about a registry only once it publishes, once per publish, and never after they unsubscribe", () => {
  const told: string[] = [];
  const stopFirst = subscribeSessionReferences(() => told.push("first"));
  const stopSecond = subscribeSessionReferences(() => told.push("second"));
  assert.deepEqual(told, [], "nothing has published yet");

  publishSessionReferences([group(session(ID))]);
  assert.deepEqual(told, ["first", "second"]);

  told.length = 0;
  stopFirst();
  publishSessionReferences([group(session(OTHER))]);
  assert.deepEqual(told, ["second"], "an unsubscribed listener is not told again");

  stopSecond();
  told.length = 0;
  publishSessionReferences([group()]);
  assert.deepEqual(told, []);
});

test("one published registry is indexed once, on the first lookup after it", () => {
  let reads = 0;
  const counted = [{
    label: "ungrouped",
    get sessions() {
      reads += 1;
      return [session(ID)];
    },
  }] as unknown as SessionGroup[];
  publishSessionReferences(counted);
  assert.equal(reads, 0, "publishing scans nothing");

  const first = lookupSessionReference(ID);
  assert.equal(reads, 1, "the first lookup builds the index");
  assert.ok(first);
  assert.equal(lookupSessionReference("195c3659"), first, "a second lookup reuses the references it built");
  assert.equal(lookupSessionReference(ID), first);
  assert.equal(reads, 1, "and never reads the registry again until it is published again");

  publishSessionReferences(counted);
  lookupSessionReference(ID);
  assert.equal(reads, 2, "a new list builds a new index");
});
