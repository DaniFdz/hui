/**
 * The per-worker mirror documents: what a machine keeps of each worker's
 * browser state, where it keeps it, and what it hands its own browser.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { BrowserMirrorStore, BrowserStateFile } from "./mirror.ts";
import { EMPTY_BROWSER_STATE, type BrowserState } from "./state.ts";

const state = (value: string, at: number, origin = "https://example.test"): BrowserState => ({
  cookies: [{ name: "session", value, domain: "example.test", path: "/", at }],
  origins: [{ origin, at, localStorage: [{ key: "token", value, at }], indexedDB: [], skipped: [] }],
});

async function store(t: { onTestFinished: (fn: () => Promise<void>) => void }): Promise<BrowserMirrorStore> {
  const dir = await mkdtemp(join(tmpdir(), "hui-mirror-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return new BrowserMirrorStore(dir);
}

test("each worker keeps its own document, merged by newest value and private to the operator", async (t) => {
  const mirror = await store(t);
  assert.deepEqual(await mirror.read("devbox"), EMPTY_BROWSER_STATE, "nothing mirrored yet");
  assert.equal((await mirror.merge("devbox", state("from-devbox", 10))).cookies[0]!.value, "from-devbox");
  await mirror.merge("other", state("from-other", 20));

  assert.deepEqual((await mirror.read("devbox")).cookies.map((cookie) => cookie.value), ["from-devbox"], "a second worker's login stays its own");
  assert.deepEqual((await mirror.read("other")).cookies.map((cookie) => cookie.value), ["from-other"]);
  assert.deepEqual(await mirror.workers(), ["devbox", "other"]);

  // The newest value wins within one document, and nothing is deleted.
  await mirror.merge("devbox", state("newer", 30));
  assert.deepEqual((await mirror.read("devbox")).origins[0]!.localStorage.map((entry) => entry.value), ["newer"]);

  // What this machine's browser seeds from is every document together.
  const everything = await mirror.everything();
  assert.deepEqual(everything.cookies.map((cookie) => cookie.value), ["newer"], "one value per cookie: the newest capture wins");
  assert.equal((await stat(join(mirror.dir, "devbox.json"))).mode & 0o777, 0o600, "a document holds live cookies");

  await mirror.forget("devbox");
  assert.deepEqual(await mirror.workers(), ["other"], "a removed worker's cookies go with it");
  assert.throws(() => mirror.file("../etc/passwd"), /Not a worker id/u, "a document is only ever named by a worker id");
});

test("a document read from disk or the wire keeps only what it can hold", async (t) => {
  const mirror = await store(t);
  const file = mirror.file("devbox");
  assert.deepEqual(await new BrowserStateFile(file.path).read(), EMPTY_BROWSER_STATE, "a missing file is an empty mirror");
  await file.merge({
    cookies: [{ name: "session", value: "v", domain: "example.test", path: "/", at: 1 }, { name: "", value: "v", domain: "x", path: "/", at: 1 }],
    origins: [
      { origin: "https://example.test", at: 1, localStorage: [{ key: "k", value: "v", at: 1 }], indexedDB: [], skipped: [] },
      { origin: "file:///etc/passwd", at: 1, localStorage: [{ key: "k", value: "v", at: 1 }], indexedDB: [], skipped: [] },
    ],
  });
  const stored = await file.read();
  assert.deepEqual(stored.cookies.map((cookie) => cookie.name), ["session"], "a nameless cookie is not one");
  assert.deepEqual(stored.origins.map((origin) => origin.origin), ["https://example.test"], "only http(s) origins are carried");
});
