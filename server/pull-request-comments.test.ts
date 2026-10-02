import assert from "node:assert/strict";
import { test } from "node:test";

import {
  newReviewComments,
  parseReviewComments,
  recordCommentsSent,
  reviewCommentsMessage,
  sendReviewComments,
  sentAtFor,
  type ReviewComment,
} from "./pull-request-comments.ts";

const comment = (login: string, createdAt: string, body = `${login} says`) => ({
  author: { login }, body, createdAt, url: `https://github.com/acme/web/pull/1#discussion_${createdAt}`,
});
const thread = (patch: Record<string, unknown>, comments: unknown[]) => ({
  isResolved: false, isOutdated: false, path: "src/app.ts", line: 12, ...patch, comments: { nodes: comments },
});

test("new comments: unresolved, current threads last answered by someone else, and reviews with a body", () => {
  const parsed = parseReviewComments({
    reviewThreads: { nodes: [
      thread({}, [comment("alice", "2026-09-01T10:00:00Z"), comment("me", "2026-09-01T11:00:00Z"), comment("bob", "2026-09-01T12:00:00Z")]),
      thread({ isResolved: true }, [comment("alice", "2026-09-02T10:00:00Z")]),
      thread({ isOutdated: true }, [comment("alice", "2026-09-02T11:00:00Z")]),
      // The operator answered last: nothing to address.
      thread({ path: "b.ts" }, [comment("alice", "2026-09-02T12:00:00Z"), comment("ME", "2026-09-02T13:00:00Z")]),
      thread({ path: "c.ts", line: null, originalLine: 7 }, [comment("carol", "2026-08-30T09:00:00Z")]),
    ] },
    reviews: { nodes: [
      { author: { login: "dave" }, body: "Please split this.", state: "CHANGES_REQUESTED", submittedAt: "2026-09-03T00:00:00Z", url: "https://github.com/acme/web/pull/1#review-1" },
      { author: { login: "dave" }, body: "   ", state: "COMMENTED", submittedAt: "2026-09-03T01:00:00Z", url: "u" },
      { author: { login: "dave" }, body: "LGTM", state: "APPROVED", submittedAt: "2026-09-03T02:00:00Z", url: "u" },
      { author: { login: "me" }, body: "Self note", state: "COMMENTED", submittedAt: "2026-09-03T03:00:00Z", url: "u" },
    ] },
  }, "me");
  assert.deepEqual(parsed.map((item) => [item.author, item.createdAt, item.path, item.line]), [
    ["carol", "2026-08-30T09:00:00Z", "c.ts", 7],
    ["alice", "2026-09-01T10:00:00Z", "src/app.ts", 12],
    ["bob", "2026-09-01T12:00:00Z", "src/app.ts", 12],
    ["dave", "2026-09-03T00:00:00Z", undefined, undefined],
  ]);
  assert.equal(parsed[3]!.state, "CHANGES_REQUESTED");
  assert.equal(parseReviewComments({}, "me").length, 0);
});

test("only comments created after the last send count", () => {
  const items = parseReviewComments({ reviewThreads: { nodes: [
    thread({}, [comment("alice", "2026-09-01T10:00:00Z"), comment("bob", "2026-09-01T12:00:00Z")]),
  ] } }, "me");
  assert.equal(newReviewComments(items).length, 2);
  assert.equal(newReviewComments(items, "2026-09-01T10:00:00Z").length, 1, "the boundary comment was already sent");
  assert.equal(newReviewComments(items, "2026-09-01T12:00:00.000Z").length, 0);
});

test("sent times are per pull request and case-insensitive; newer sends replace older ones", () => {
  const url = "https://github.com/Acme/Web/pull/1";
  assert.equal(sentAtFor({}, url), undefined);
  const once = recordCommentsSent({}, url, "2026-09-01T00:00:00Z");
  assert.deepEqual(once, [{ url: "https://github.com/acme/web/pull/1", sentAt: "2026-09-01T00:00:00Z" }]);
  const twice = recordCommentsSent({ pullRequestComments: once }, url.toLowerCase(), "2026-09-02T00:00:00Z");
  assert.deepEqual(twice, [{ url: "https://github.com/acme/web/pull/1", sentAt: "2026-09-02T00:00:00Z" }]);
  assert.equal(sentAtFor({ pullRequestComments: twice }, url), "2026-09-02T00:00:00Z");
});

const pr = { repository: "acme/web", number: 1, url: "https://github.com/acme/web/pull/1", title: "Checkout" };
const item = (index: number, body: string): ReviewComment => ({
  author: "alice", body, createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(), url: `https://github.com/acme/web/pull/1#discussion_r${index}`, path: "src/a.ts", line: index,
});

test("the message lists comments oldest first with the instruction", () => {
  const { text, included, omitted } = reviewCommentsMessage(pr, [item(2, "Second"), item(1, "First\nline two")]);
  assert.equal(omitted, 0);
  assert.deepEqual(included.map((entry) => entry.body), ["First\nline two", "Second"]);
  assert.match(text, /acme\/web#1/);
  assert.match(text, /address each comment, reply on or resolve each thread per the repository's rules, push, and report what you changed/i);
  assert.ok(text.indexOf("First") < text.indexOf("Second"));
  assert.match(text, /@alice on src\/a\.ts:1/);
  assert.match(text, /> First\n {3}> line two/);
  assert.match(text, /#discussion_r1/);
});

test("the message stays under 20 KB, drops the newest comments and says so", () => {
  const many = Array.from({ length: 30 }, (_, index) => item(index, "x".repeat(3_000)));
  const { text, included, omitted } = reviewCommentsMessage(pr, many);
  assert.ok(Buffer.byteLength(text) <= 20_000, `${Buffer.byteLength(text)} bytes`);
  assert.ok(included.length > 0 && included.length < 30);
  assert.equal(included.length + omitted, 30);
  assert.deepEqual(included, many.slice(0, included.length), "the oldest are kept");
  assert.match(text, new RegExp(`${omitted} newer comments? (?:was|were) not included`));
});

test("sending persists the newest included time only after delivery is accepted", async () => {
  const comments = [item(1, "a"), item(2, "b")];
  const persisted: string[] = [];
  const result = await sendReviewComments({
    pr, sentAt: comments[0]!.createdAt,
    fetch: async () => comments,
    deliver: async (text) => { assert.match(text, /> b/); assert.doesNotMatch(text, /> a/); return "queued"; },
    persist: async (sentAt) => { persisted.push(sentAt); },
  });
  assert.deepEqual(result, { sent: 1, omitted: 0, delivery: "queued" });
  assert.deepEqual(persisted, [comments[1]!.createdAt]);

  await assert.rejects(sendReviewComments({
    pr, fetch: async () => comments,
    deliver: async () => { throw new Error("pi refused the message."); },
    persist: async (sentAt) => { persisted.push(sentAt); },
  }), /pi refused/);
  assert.equal(persisted.length, 1, "a failed delivery persists nothing");

  let delivered = false;
  await assert.rejects(sendReviewComments({
    pr, sentAt: comments[1]!.createdAt, fetch: async () => comments,
    deliver: async () => { delivered = true; return "prompt"; },
    persist: async () => { throw new Error("unreachable"); },
  }), /No new review comments/);
  assert.equal(delivered, false);
});
