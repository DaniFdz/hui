import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const BUILD = "build-test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(production: boolean) {
  vi.resetModules();
  if (production) vi.stubGlobal("__HUI_BUILD_ID__", BUILD);
  return import("./offline.ts");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("development has no build and never registers or checks", async () => {
  const register = vi.fn(async (_url: string) => ({}));
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("isSecureContext", true);
  const { assertCurrentBuild, prepareOffline } = await load(false);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  prepareOffline();
  assert.equal(register.mock.calls.length, 0);
  await assertCurrentBuild();
  assert.equal(fetch.mock.calls.length, 0);
});

test("a production page installs the worker under its own build and confirms a matching gateway build", async () => {
  const register = vi.fn(async (_url: string) => ({}));
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("isSecureContext", true);
  const { assertCurrentBuild, prepareOffline } = await load(true);
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ build: BUILD }));
  vi.stubGlobal("fetch", fetch);
  prepareOffline();
  assert.equal(register.mock.calls[0]?.[0], `/offline-worker.js?build=${BUILD}`);
  await assertCurrentBuild();
  assert.equal(fetch.mock.calls[0]?.[0], "/offline-build.json");
  assert.equal((fetch.mock.calls[0]?.[1] as RequestInit).cache, "no-store");
});

test("another build or invalid marker requires a reload, while connection failures and refusals stay distinct", async () => {
  const { OutdatedBuildError, assertCurrentBuild } = await load(true);
  const reject = async (fetch: () => Promise<Response>, check: (error: unknown) => boolean) => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    await assert.rejects(assertCurrentBuild(), check);
  };
  await reject(async () => json({ build: "another-build" }), (error) => error instanceof OutdatedBuildError);
  await reject(async () => { throw new TypeError("Failed to fetch"); }, (error) => error instanceof TypeError && !(error instanceof OutdatedBuildError));
  await reject(async () => new Response("unavailable", { status: 503 }), (error) => error instanceof Error && !(error instanceof OutdatedBuildError));
  await reject(async () => json({ build: 42 }), (error) => error instanceof OutdatedBuildError);
  await reject(async () => new Response("not json", { status: 200 }), (error) => error instanceof OutdatedBuildError);
});

test("a caller's abort ends only its own build check", async () => {
  const { assertCurrentBuild } = await load(true);
  const states: string[] = [];
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    states.push(init?.signal?.aborted ? "already aborted" : "waiting");
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })));
  const first = new AbortController();
  const second = new AbortController();
  const one = assertCurrentBuild(first.signal);
  const two = assertCurrentBuild(second.signal);
  first.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(one, (error) => error instanceof DOMException);
  second.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(two, (error) => error instanceof DOMException);
  assert.deepEqual(states, ["waiting", "waiting"]);
});

test("a stale build cannot write through a direct Files request, and a matching build can", async () => {
  const { OutdatedBuildError } = await load(true);
  const { saveFile } = await import("./files.ts");
  const calls: string[] = [];
  let build = "newer-build";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return String(input) === "/offline-build.json" ? json({ build }) : json({ path: "note.txt" });
  }));
  await assert.rejects(saveFile("s1", "note.txt", "draft", "etag"), (error) => error instanceof OutdatedBuildError);
  assert.deepEqual(calls, ["/offline-build.json"], "a stale page reaches no write route");
  build = BUILD;
  await saveFile("s1", "note.txt", "draft", "etag");
  assert.deepEqual(calls.slice(1), ["/offline-build.json", "/__hui/sessions/s1/files/file?path=note.txt"]);
});

test("an insecure or unsupported browser never registers the worker", async () => {
  const register = vi.fn(async (_url: string) => ({}));
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("isSecureContext", false);
  const { prepareOffline } = await load(true);
  prepareOffline();
  assert.equal(register.mock.calls.length, 0);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {});
  prepareOffline();
  assert.equal(register.mock.calls.length, 0);
});
