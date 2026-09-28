import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkoutIdentity, cleanup, doctor, fixtureEnvironment } from "./visual-verification.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repo, "e2e/visual-verification.mjs");
const branch = execFileSync("git", ["-C", repo, "branch", "--show-current"], { encoding: "utf8" }).trim() || "HEAD";

test("fixture environment isolates config and drops credential/startup injection variables without changing HOME", () => {
  const env = fixtureEnvironment("/tmp/fixture", {
    HOME: "/operator/home", PATH: "/usr/bin", OPENAI_API_KEY: "secret", GH_TOKEN: "secret",
    NODE_OPTIONS: "--import unsafe.mjs", HTTPS_PROXY: "https://secret@proxy", BASH_ENV: "unsafe.sh",
    HUI_PI_BACKEND: "operator", PI_CODING_AGENT_DIR: "/operator/pi", XDG_CONFIG_HOME: "/operator/config",
  });
  assert.equal(env.HOME, "/operator/home");
  assert.equal(env.PI_CODING_AGENT_DIR, "/tmp/fixture/agent");
  assert.equal(env.PI_CODING_AGENT_SESSION_DIR, "/tmp/fixture/sessions");
  assert.equal(env.XDG_CONFIG_HOME, "/tmp/fixture/config");
  assert.equal(env.GH_CONFIG_DIR, "/tmp/fixture/github");
  assert.equal(env.HUI_PI_BACKEND, "sdk");
  for (const key of ["OPENAI_API_KEY", "GH_TOKEN", "NODE_OPTIONS", "HTTPS_PROXY", "BASH_ENV"]) assert.equal(env[key], undefined);
});

test("provenance distinguishes tracked and untracked content, branch, and commit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hui-provenance-test-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--initial-branch=fixture");
  await writeFile(join(dir, "tracked.txt"), "original\n");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  const initial = await checkoutIdentity(dir);
  assert.equal(initial.branch, "fixture");
  assert.equal(initial.dirty, false);
  await writeFile(join(dir, "tracked.txt"), "first change\n");
  const first = await checkoutIdentity(dir);
  await writeFile(join(dir, "tracked.txt"), "second change\n");
  const second = await checkoutIdentity(dir);
  assert.equal(first.status, second.status);
  assert.notEqual(first.fingerprint, second.fingerprint);
  await writeFile(join(dir, "untracked.txt"), "one\n");
  const untracked = await checkoutIdentity(dir);
  await writeFile(join(dir, "untracked.txt"), "two\n");
  assert.notEqual(untracked.fingerprint, (await checkoutIdentity(dir)).fingerprint);
  git("switch", "-c", "other");
  assert.equal((await checkoutIdentity(dir)).branch, "other");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "change");
  assert.notEqual((await checkoutIdentity(dir)).head, initial.head);
  git("checkout", "--detach");
  const detached = await checkoutIdentity(dir);
  assert.equal(detached.branch, "HEAD");
  assert.equal(detached.detached, true);
});

test("wrong branch fails before launch", () => {
  assert.throws(() => execFileSync(process.execPath, [cli, "launch", "--branch", `${branch}-not-this-branch`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), (error) => {
    assert.match(error.stderr, /Wrong branch/u);
    return true;
  });
});

function startFixture() {
  const child = spawn(process.execPath, [cli, "launch", "--branch", branch], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const ready = new Promise((resolveReady, reject) => {
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
      if (output.includes("\n")) {
        try { resolveReady(JSON.parse(output.split("\n")[0])); } catch (error) { reject(error); }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Fixture exited ${code}: ${stderr}`)));
  });
  return { child, ready };
}

const status = (url) => new Promise((resolveStatus, reject) => {
  get(url, (response) => { response.resume(); resolveStatus(response.statusCode); }).once("error", reject);
});

async function huiApi(url, path, body) {
  const response = await new Promise((resolveResponse, reject) => {
    const req = request(`${url}/__hui/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-hui": "1", "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    }, resolveResponse);
    req.once("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  let text = "";
  for await (const chunk of response) text += chunk;
  assert.equal(response.statusCode, 200, `${path}: ${text}`);
  return JSON.parse(text);
}

async function waitIdle(url, id) {
  const response = await new Promise((resolveResponse, reject) => {
    get(`${url}/__hui/sessions/${id}/events`, {
      headers: { "x-hui": "1" }, signal: AbortSignal.timeout(20_000),
    }, resolveResponse).once("error", reject);
  });
  assert.equal(response.statusCode, 200);
  response.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of response) {
    buffer += chunk;
    while (buffer.includes("\n\n")) {
      const end = buffer.indexOf("\n\n");
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data) continue;
      const event = JSON.parse(data);
      assert.notEqual(event.status, "error", `SDK session failed: ${data}`);
      if (event.status === "idle") return;
    }
  }
  assert.fail("Session event stream closed before idle.");
}

test("real fixtures use distinct ports/state; doctor rejects wrong ports/provenance; cleanup closes only its instance", { timeout: 60_000 }, async (context) => {
  const fixtures = [startFixture(), startFixture()];
  context.after(async () => {
    for (const { child } of fixtures) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    }
  });
  const [a, b] = await Promise.all(fixtures.map(({ ready }) => ready));
  assert.notEqual(a.url, b.url);
  assert.notEqual(a.providerUrl, b.providerUrl);
  assert.notEqual(a.workspace, b.workspace);
  assert.equal(a.token, undefined, "stdout must not disclose the control token");
  assert.equal((await doctor(a.receipt)).ok, true);
  assert.equal((await doctor(b.receipt)).ok, true);
  assert.equal(a.browserUrl, a.url.replace("127.0.0.1", "localhost"));
  assert.equal(await status(`${a.url}/__verification`), 403);
  assert.equal(await status(`${a.url}/__hui/settings`), 403);
  const saved = JSON.parse(await readFile(a.receipt, "utf8"));
  const wrong = join(a.artifacts, "wrong-receipt.json");
  await writeFile(wrong, JSON.stringify({ ...saved, url: b.url }));
  await assert.rejects(doctor(wrong), /ownership check failed/u);
  await assert.rejects(cleanup(wrong), /ownership check failed/u);
  assert.equal((await doctor(b.receipt)).ok, true, "refused cleanup must not stop the other server");
  await writeFile(wrong, JSON.stringify({ ...saved, checkout: { ...saved.checkout, head: "incorrect-head" } }));
  await assert.rejects(doctor(wrong), /Checkout changed/u);
  const driftDir = await mkdtemp(join(repo, ".visual-verification-drift-"));
  const driftFile = join(driftDir, "fixture.txt");
  try {
    await writeFile(driftFile, "Source changed after launch.\n", { flag: "wx" });
    await assert.rejects(doctor(a.receipt), /Checkout changed/u);
  } finally {
    await unlink(driftFile);
    await rmdir(driftDir);
  }
  assert.equal((await doctor(a.receipt)).ok, true);
  // Health alone cannot prove the configured SDK/provider URL works. Exercise
  // the real HUI -> PI SDK -> local provider -> real read tool round trip.
  const { session } = await huiApi(a.url, "sessions", { cwd: a.workspace, title: "Verification transport regression", tool: "pi" });
  await waitIdle(a.url, session.id);
  await huiApi(a.url, `sessions/${session.id}/prompt`, { text: "E2E_RICH" });
  await waitIdle(a.url, session.id);
  const { transcript } = await huiApi(a.url, `sessions/${session.id}/open`, {});
  const read = transcript.find((entry) => entry.kind === "tool" && entry.name === "read");
  assert.ok(read, `Real read tool missing: ${JSON.stringify(transcript)}`);
  assert.notEqual(read.failed, true);
  assert.match(read.output, /Real SDK browser fixture/u);
  assert.ok(transcript.some((entry) => entry.kind === "message" && entry.role === "assistant" && entry.text.includes("Tool complete")));
  assert.equal((await huiApi(a.url, `sessions/${session.id}/tools`)).backend, "sdk");
  const requests = (await readFile(join(a.artifacts, "provider.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(requests.some((body) => JSON.stringify(body.messages).includes("E2E_RICH")));
  assert.ok(requests.some((body) => JSON.stringify(body.messages).includes("Real SDK browser fixture")));
  assert.equal((await cleanup(a.receipt)).portsClosed, true);
  assert.equal((await doctor(b.receipt)).ok, true, "cleaning one fixture must leave the other running");
  assert.equal((await cleanup(b.receipt)).portsClosed, true);
  assert.equal((await cleanup(a.receipt)).portsClosed, true, "cleanup is idempotent after clean exit");
  assert.ok(await readFile(join(a.artifacts, "doctor.json")), "cleanup preserves evidence");
});
