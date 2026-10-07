import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fieldAt, hashHookToken, HOOK_ROUTE, HookBodyError, isHookPath, isTailnetOrLoopback, matchesWebhook, newHookToken, readHookBody, sameHash, webhookEvent, type HookBody } from "./bot-triggers-webhook.ts";

function request(body: string | Buffer, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([typeof body === "string" ? Buffer.from(body) : body]) as unknown as IncomingMessage;
  stream.headers = headers;
  return stream;
}

const json = (value: unknown): HookBody => ({ kind: "json", value, bytes: 1, type: "application/json" });
const text = (value: string): HookBody => ({ kind: "text", value, bytes: value.length, type: "text/plain" });

test("only this machine and Tailscale's addresses may call a webhook", () => {
  for (const address of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "100.64.0.1", "100.101.102.103", "100.127.255.254", "::ffff:100.100.1.2", "fd7a:115c:a1e0::1", "fd7a:115c:a1e0:ab12:4843:cd96:6258:b240"]) {
    assert.equal(isTailnetOrLoopback(address), true, address);
  }
  for (const address of [undefined, "", "10.0.0.5", "192.168.1.20", "100.63.255.255", "100.128.0.1", "8.8.8.8", "::ffff:8.8.8.8", "fd7a:115c:a1e1::1", "2001:db8::1", "localhost"]) {
    assert.equal(isTailnetOrLoopback(address), false, String(address));
  }
});

test("a token is 32 random bytes in base64url, stored only as its SHA-256 and compared in constant time", () => {
  const first = newHookToken();
  const second = newHookToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first.token, second.token);
  assert.equal(first.hash, hashHookToken(first.token));
  assert.match(first.hash, /^[0-9a-f]{64}$/u);
  assert.equal(first.hint, first.token.slice(0, 4));
  assert.equal(sameHash(first.hash, hashHookToken(first.token)), true);
  assert.equal(sameHash(first.hash, second.hash), false);
  assert.equal(sameHash(first.hash, "zz"), false, "not a digest");
  assert.equal(HOOK_ROUTE.exec(`/__hui/hooks/${first.token}`)?.[1], first.token);
  assert.equal(HOOK_ROUTE.test("/__hui/hooks/short"), false);
  assert.equal(HOOK_ROUTE.test(`/__hui/hooks/${first.token}/x`), false);
  assert.equal(isHookPath("/__hui/hooks/anything"), true);
  assert.equal(isHookPath("/__hui/bots"), false);
});

test("a filter matches a JSON field that equals or contains a value, or the whole body", () => {
  const body = json({ action: "opened", pull_request: { state: "open", labels: ["ci", "bug"], number: 12, draft: false }, commits: [{ id: "abc" }] });
  assert.equal(matchesWebhook(undefined, body), true, "no filter: every call");
  assert.equal(matchesWebhook({ field: "action", op: "equals", value: "opened" }, body), true);
  assert.equal(matchesWebhook({ field: "action", op: "equals", value: "open" }, body), false);
  assert.equal(matchesWebhook({ field: "action", op: "contains", value: "pen" }, body), true);
  assert.equal(matchesWebhook({ field: "pull_request.labels", op: "contains", value: "bug" }, body), true, "a list contains an element");
  assert.equal(matchesWebhook({ field: "pull_request.number", op: "equals", value: "12" }, body), true, "numbers compare as text");
  assert.equal(matchesWebhook({ field: "pull_request.draft", op: "equals", value: "false" }, body), true);
  assert.equal(matchesWebhook({ field: "commits.0.id", op: "equals", value: "abc" }, body), true, "list indexes");
  assert.equal(matchesWebhook({ field: "pull_request.missing", op: "equals", value: "x" }, body), false);
  assert.equal(matchesWebhook({ field: "pull_request", op: "equals", value: "x" }, body), false, "an object equals nothing");
  assert.equal(matchesWebhook({ field: "", op: "contains", value: "\"state\":\"open\"" }, body), true, "the whole body");
  assert.equal(matchesWebhook({ field: "", op: "contains", value: "deploy failed" }, text("prod: deploy failed at 10:00")), true);
  assert.equal(matchesWebhook({ field: "", op: "equals", value: "ping" }, text(" ping\n")), true);
  assert.equal(matchesWebhook({ field: "action", op: "equals", value: "ping" }, text("ping")), false, "a text body has no fields");
  assert.equal(fieldAt({ a: { b: [1, { c: 2 }] } }, "a.b.1.c"), 2);
  assert.equal(fieldAt({ a: 1 }, "constructor"), undefined, "only the body's own keys");
});

test("a body is read up to 64 KiB, as JSON when its type says so and as text otherwise", async () => {
  assert.deepEqual(await readHookBody(request("{\"a\":1}", { "content-type": "application/json; charset=utf-8" })), { kind: "json", value: { a: 1 }, bytes: 7, type: "application/json" });
  assert.deepEqual(await readHookBody(request("{\"a\":1}", { "content-type": "application/vnd.github+json" })), { kind: "json", value: { a: 1 }, bytes: 7, type: "application/vnd.github+json" });
  assert.deepEqual(await readHookBody(request("hello", {})), { kind: "text", value: "hello", bytes: 5, type: "text/plain" });
  await assert.rejects(readHookBody(request("{nope", { "content-type": "application/json" })), (error: unknown) => error instanceof HookBodyError && error.status === 400);
  await assert.rejects(readHookBody(request("x".repeat(65 * 1024))), (error: unknown) => error instanceof HookBodyError && error.status === 413, "a body that turns out too large");
  await assert.rejects(readHookBody(request("{}", { "content-length": String(1024 * 1024) })), (error: unknown) => error instanceof HookBodyError && error.status === 413, "a declared length over the cap is refused before reading");
  assert.equal((await readHookBody(request("x".repeat(64 * 1024)))).bytes, 64 * 1024, "exactly the cap passes");
});

test("a call's summary comes from a field it carries, and its body is shown pretty-printed and cut", () => {
  assert.deepEqual(webhookEvent(json({ status: "failed", title: "Deploy 42 failed" })).summary, "webhook call (title: Deploy 42 failed)");
  assert.deepEqual(webhookEvent(json([1, 2])).summary, "webhook call");
  assert.equal(webhookEvent(text("\n\nBuild broke on main\nmore")).summary, "webhook call (Build broke on main)");
  const big = webhookEvent(json({ data: "x".repeat(5_000) }));
  assert.ok(big.details.length < 1_600);
  assert.match(big.details, /^A application\/json body of 1 bytes:\n\{\n {2}"data": "x+/u);
  assert.match(big.details, /more characters\)$/u);
});
