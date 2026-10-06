import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import { SECRET_FILE_TTL_MS, SECRET_REQUEST_TIMEOUT_MS, SecretRequests } from "./secret-requests.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "hui-secret-test-"));
  const changes: string[] = [];
  const requests = new SecretRequests({ root, onChange: (id) => changes.push(id) });
  t.after(async () => {
    requests.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return { root, requests, changes };
}

const ask = { label: " GitHub token ", reason: "Push the release tag." };

test("a provided secret reaches the agent as a private file path, never as its value", async (t) => {
  const { requests, changes } = await fixture(t);
  const result = requests.request("s1", ask);
  const [question] = requests.questions("s1");
  assert.deepEqual(question, { id: question?.id, method: "secret", title: "GitHub token", message: "Push the release tag." });
  assert.deepEqual(requests.questions("s2"), []);
  assert.equal(requests.answer("s2", question!.id, { value: "stolen" }), false, "another session cannot answer it");
  assert.equal(requests.answer("s1", question!.id, { value: " ghp_value with spaces " }), true);

  const provided = await result;
  assert(provided.status === "provided");
  assert.equal(provided.label, "GitHub token");
  assert.equal(await readFile(provided.path, "utf8"), " ghp_value with spaces ", "the value is stored exactly as typed");
  assert.equal((await stat(provided.path)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(provided.path))).mode & 0o777, 0o700);
  assert(!JSON.stringify(provided).includes("ghp_value"), "the result names the file, not the value");
  assert.deepEqual(requests.questions("s1"), []);
  assert.deepEqual(changes, ["s1", "s1"], "shown, then gone");

  requests.dispose();
  assert(!existsSync(dirname(provided.path)), "a gateway stop deletes delivered files");
});

test("a delivered file is deleted when its time is up", async (t) => {
  const { requests } = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = requests.request("s1", ask);
  requests.answer("s1", requests.questions("s1")[0]!.id, { value: "token" });
  const provided = await result;
  assert(provided.status === "provided");
  t.mock.timers.tick(SECRET_FILE_TTL_MS - 1);
  assert(existsSync(provided.path));
  t.mock.timers.tick(1);
  assert(!existsSync(dirname(provided.path)));
});

test("cancel, Stop and expiry end a request without writing anything", async (t) => {
  const { root, requests } = await fixture(t);
  const cancelled = requests.request("s1", ask);
  assert.equal(requests.answer("s1", requests.questions("s1")[0]!.id, { cancelled: true }), true);
  assert.deepEqual(await cancelled, { status: "cancelled", label: "GitHub token" });

  const stop = new AbortController();
  const stopped = requests.request("s1", ask, stop.signal);
  assert.equal(requests.questions("s1").length, 1);
  stop.abort();
  assert.deepEqual(await stopped, { status: "cancelled", label: "GitHub token" });
  assert.deepEqual(await requests.request("s1", ask, AbortSignal.abort()), { status: "cancelled", label: "GitHub token" });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expiring = requests.request("s1", ask);
  t.mock.timers.tick(SECRET_REQUEST_TIMEOUT_MS);
  assert.deepEqual(await expiring, { status: "expired", label: "GitHub token" });

  const pending = requests.request("s1", ask);
  requests.dispose();
  assert.deepEqual(await pending, { status: "cancelled", label: "GitHub token" }, "a gateway stop cancels what is pending");
  assert.deepEqual(requests.questions("s1"), []);
  assert.deepEqual(await readdir(root), []);
});

test("requests and answers are validated", async (t) => {
  const { requests } = await fixture(t);
  await assert.rejects(requests.request("s1", { label: "", reason: "why" }), /label must be non-empty text/u);
  await assert.rejects(requests.request("s1", { label: "Token", reason: "x".repeat(501) }), /reason must be at most 500 characters/u);
  void requests.request("s1", ask);
  const id = requests.questions("s1")[0]!.id;
  assert.throws(() => requests.answer("s1", id, { value: "" }), /Enter the secret/u);
  assert.throws(() => requests.answer("s1", id, { value: 42 }), /Enter the secret/u);
  assert.equal(requests.questions("s1").length, 1, "a rejected answer leaves the request pending");
  assert.equal(requests.answer("s1", "unknown", { value: "x" }), false);
});

test("a gateway start removes what a crashed gateway left, and only that", async (t) => {
  const { root, requests } = await fixture(t);
  const crashed = join(root, "hui-secret-2147483646-AbC123");
  const running = join(root, `hui-secret-${process.ppid}-AbC123`);
  const unrelated = join(root, "hui-secret-notes");
  for (const dir of [crashed, running, unrelated]) await mkdir(dir);
  await writeFile(join(crashed, "secret"), "left behind", { mode: 0o600 });
  await requests.sweep();
  assert.deepEqual((await readdir(root)).sort(), [basename(running), basename(unrelated)].sort());
});
