import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";

import { waitFor } from "../test-support/wait-for.ts";
import { ExtensionHost } from "./host.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "hui-extension-host-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "hello");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "extension.json"), JSON.stringify({ apiVersion: 1, name: "Hello", description: "", main: "index.mjs", mode: "process" }));
  await writeFile(join(directory, "index.mjs"), `
export const routes = [
  { method: "GET", path: "ping", handle: async () => ({ body: { ok: true } }) },
  { method: "POST", path: "echo", handle: async ({ body }) => ({ body: { echo: body } }) },
  { method: "GET", path: "stream", stream: true, handle: async () => ({ events: (async function* () { yield { n: 0 }; yield { n: 1 }; })() }) },
  { method: "GET", path: "crash", handle: async () => { process.exit(1); } },
  { method: "GET", path: "hang", handle: async () => await new Promise(() => {}) },
];
`);
  return { root, directory };
}

test("a process host starts, answers calls and streams, and restarts after a crash", { timeout: 30_000 }, async (t) => {
  const { directory } = await fixture(t);
  const host = new ExtensionHost({ id: "hello", directory, callTimeoutMs: 1_000 });
  t.onTestFinished(() => host.stop());
  assert.deepEqual(await host.start(), { ok: true });
  assert.deepEqual(host.info.routes.map((route) => [route.method, route.path, route.stream]), [
    ["GET", "ping", false],
    ["POST", "echo", false],
    ["GET", "stream", true],
    ["GET", "crash", false],
    ["GET", "hang", false],
  ]);
  assert.deepEqual(await host.call("GET", "ping", undefined), { status: 200, body: { ok: true } });
  assert.deepEqual(await host.call("POST", "echo", { text: "hi" }), { status: 200, body: { echo: { text: "hi" } } });
  const events: unknown[] = [];
  for await (const event of host.stream("GET", "stream", undefined, new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [{ n: 0 }, { n: 1 }]);
  await assert.rejects(host.call("GET", "hang", undefined), /did not answer in time/u);
  assert.equal(host.info.restarts, 0);

  void host.call("GET", "crash", undefined).catch(() => undefined);
  await waitFor("the crash to be counted", async () => host.info.restarts >= 1, { timeoutMs: 5_000, state: () => host.info.restarts });
  await waitFor("the host to restart", async () => host.info.state === "ready", { timeoutMs: 5_000, state: () => host.info.state });
  assert.equal(host.info.restarts, 1);
  assert.deepEqual(await host.call("GET", "ping", undefined), { status: 200, body: { ok: true } });
});

test("three crashes in five minutes leave the host failed until it is stopped", { timeout: 30_000 }, async (t) => {
  const { directory } = await fixture(t);
  const host = new ExtensionHost({ id: "hello", directory, callTimeoutMs: 1_000 });
  t.onTestFinished(() => host.stop());
  await host.start();
  for (let crash = 0; crash < 3; crash += 1) {
    await waitFor("a ready host before the crash", async () => host.info.state === "ready", { timeoutMs: 8_000, state: () => host.info.state });
    void host.call("GET", "crash", undefined).catch(() => undefined);
    if (crash < 2) {
      await waitFor("the restart", async () => host.info.state === "restarting", { timeoutMs: 8_000, state: () => host.info.state });
    } else {
      await waitFor("the failed state", async () => host.info.state === "failed", { timeoutMs: 8_000, state: () => host.info.state });
    }
  }
  assert.equal(host.info.state, "failed");
  assert.match(host.info.error ?? "", /crashed 3 times/u);
  await assert.rejects(host.call("GET", "ping", undefined), /restarting/u);
  await host.stop();
  assert.equal(host.info.state, "stopped");
});
