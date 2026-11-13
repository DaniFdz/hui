import assert from "node:assert/strict";
import { test } from "vitest";
import { buildHar, describeEntry, NetworkLog, redactedHeaders, redactedUrl } from "./network.ts";

test("credential headers and query values never reach the log or the HAR", () => {
  assert.deepEqual(redactedHeaders({ authorization: "Bearer secret", cookie: "sid=1", "content-type": "text/html" }), [
    { name: "authorization", value: "[redacted]" },
    { name: "cookie", value: "[redacted]" },
    { name: "content-type", value: "text/html" },
  ]);
  assert.equal(redactedUrl("https://example.com/cb?code=abc&token=t&page=2"), "https://example.com/cb?code=%5Bredacted%5D&token=%5Bredacted%5D&page=2");
  assert.equal(redactedUrl("not a url"), "not a url");
});

test("a request is one entry with its response, timing and failure; the log is bounded", () => {
  const log = new NetworkLog(2);
  log.start();
  log.record({ requestId: "1", url: "https://example.com/a", method: "GET", type: "Document", headers: { authorization: "x" }, at: 100 });
  log.record({ requestId: "1", status: 200, statusText: "OK", mimeType: "text/html", responseHeaders: { "set-cookie": "sid=1" }, at: 140 });
  log.record({ requestId: "1", bytes: 12, at: 150 });
  assert.deepEqual(log.entries().map((entry) => ({ id: entry.id, status: entry.status, bytes: entry.bytes, duration: entry.finishedAt! - entry.startedAt })), [
    { id: "n1", status: 200, bytes: 12, duration: 50 },
  ]);
  assert.equal(log.find("n1")?.requestHeaders[0]?.value, "[redacted]");
  log.record({ requestId: "2", url: "https://example.com/b", method: "POST", type: "Fetch", at: 200 });
  log.record({ requestId: "2", failure: "net::ERR_FAILED", at: 210 });
  log.record({ requestId: "3", url: "https://example.com/c", method: "GET", type: "Image", at: 300 });
  // Two entries kept: the oldest went.
  assert.deepEqual(log.entries().map((entry) => entry.url), ["https://example.com/b", "https://example.com/c"]);
  assert.equal(log.find("n2")?.failure, "net::ERR_FAILED");
  assert.match(describeEntry(log.find("n2")!), /^n2 · POST FAILED net::ERR_FAILED · Fetch · 10 ms\n  https:\/\/example\.com\/b$/u);
  log.stop();
  assert.equal(log.recording, false);
});

test("the HAR is a redacted 1.2 document with one page", () => {
  const log = new NetworkLog();
  log.start();
  log.record({ requestId: "1", url: "https://example.com/a?token=t", method: "GET", type: "Document", headers: { cookie: "sid=1" }, at: 1_000 });
  log.record({ requestId: "1", status: 200, statusText: "OK", mimeType: "text/html", responseHeaders: { "set-cookie": "sid=1" }, at: 1_050 });
  log.record({ requestId: "1", bytes: 9, at: 1_060 });
  const har = buildHar(log.entries(), { creator: "HUI", version: "1.0.0" }) as { log: { version: string; pages: unknown[]; entries: Array<Record<string, any>> } };
  assert.equal(har.log.version, "1.2");
  assert.equal(har.log.pages.length, 1);
  const entry = har.log.entries[0]!;
  assert.equal(entry.request.url, "https://example.com/a?token=%5Bredacted%5D");
  assert.deepEqual(entry.request.headers, [{ name: "cookie", value: "[redacted]" }]);
  assert.deepEqual(entry.response.headers, [{ name: "set-cookie", value: "[redacted]" }]);
  assert.equal(entry.response.status, 200);
  assert.equal(entry.time, 60);
  assert.equal(JSON.stringify(har).includes("sid=1"), false);
});
