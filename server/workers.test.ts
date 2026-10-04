/**
 * Remote workers end to end on one machine: the "remote" is a separate home
 * directory reached through `env … sh -s`, so nothing is shared with the
 * gateway except what the protocol carries. The host, its runtimes and a
 * deterministic Anthropic-compatible provider all run for real.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "hui-workers-"));
const agentDir = join(root, "gateway", "agent");
const remoteHome = join(root, "remote");
const project = join(remoteHome, "project");
const KEY = "fixture-secret-key";
// The gateway's home too: nothing is read from the real user's files.
process.env["HOME"] = join(root, "gateway", "home");
process.env["PI_CODING_AGENT_DIR"] = agentDir;
process.env["XDG_CONFIG_HOME"] = join(root, "gateway", "config");
process.env["PI_OFFLINE"] = "1";

const { workers } = await import("./workers.ts");
const { remoteRuntime } = await import("./runtimes/remote.ts");
const piRuntime = remoteRuntime("pi");
const { workerRelease } = await import("./worker/release.ts");
type Session = Awaited<ReturnType<typeof piRuntime.start>>;

let provider: ChildProcess;
let baseUrl = "";
let workerId = "";

async function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function settled(session: Session): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = session.subscribe((event) => {
      if (event.type === "settled") { stop(); resolve(); }
      if (event.type === "error") { stop(); reject(new Error(event.message)); }
    });
  });
}

/** Everything under the remote home that is not installed code. */
async function remoteFiles(dir = remoteHome): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "releases") continue;
    if (entry.isDirectory()) out.push(...await remoteFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

before(async () => {
  await mkdir(join(agentDir, "skills", "gateway-skill"), { recursive: true });
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await mkdir(join(root, "gateway", "package", "skills", "package-skill"), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(join(agentDir, "skills", "gateway-skill", "SKILL.md"), "---\nname: gateway-skill\ndescription: Lives only on the gateway.\n---\nBody\n");
  await writeFile(join(root, "gateway", "package", "package.json"), JSON.stringify({ name: "local-package", version: "1.0.0", pi: { skills: ["./skills"] } }));
  await writeFile(join(root, "gateway", "package", "skills", "package-skill", "SKILL.md"), "---\nname: package-skill\ndescription: From a local PI package.\n---\nBody\n");
  await writeFile(join(agentDir, "extensions", "question.ts"), await readFile(join(repo, "e2e", "question-extension.ts"), "utf8"));
  await writeFile(join(agentDir, "extensions", "oauth-provider.ts"), `export default function (pi) {
  pi.registerProvider("fx-oauth", {
    baseUrl: process.env.HUI_TEST_BASE_URL, api: "anthropic-messages",
    models: [{ id: "fixture", name: "OAuth fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    oauth: {
      name: "Fixture OAuth",
      login: async () => { throw new Error("no login in tests"); },
      // The fixture's token endpoint: the rotated access token comes from the
      // environment, so no file on the remote ever holds it.
      refreshToken: async (credential) => ({ refresh: credential.refresh + "-rotated", access: process.env.HUI_TEST_ACCESS, expires: Date.now() + 3_600_000, refreshedOn: process.env.HOME }),
      getApiKey: (credential) => credential.access,
    },
  });
}
`);
  provider = spawn(process.execPath, [join(repo, "e2e/pi-provider-fixture.mjs")], {
    env: { ...process.env, HUI_E2E_PROVIDER_PORT: "0", HUI_E2E_WORKSPACE: project, HUI_E2E_PROVIDER_LOG: join(root, "provider.jsonl"), HUI_E2E_PROVIDER_KEY: KEY },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [ready] = await once(provider.stdout!, "data");
  baseUrl = String(ready).match(/http:\/\/127\.0\.0\.1:\d+/u)![0];
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fx: {
    baseUrl, api: "anthropic-messages",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  // The key exists only in the gateway's PI login.
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({
    fx: { type: "api_key", key: KEY },
    "fx-oauth": { type: "oauth", refresh: "refresh-1", access: "expired-token", expires: 0 },
  }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fx", defaultModel: "fixture", packages: [join(root, "gateway", "package")] }));

  // Pre-install this checkout as the remote release (the container E2E covers
  // the real npm install) so the suite needs no network.
  const release = await workerRelease();
  const dir = join(remoteHome, ".local", "share", "hui-worker", "releases", release.id);
  for (const file of release.files) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.data, { mode: file.mode });
  }
  await symlink(join(repo, "node_modules"), join(dir, "node_modules"));
  await writeFile(join(dir, ".ready"), "");
  // A lock left by a host that died, whose pid now belongs to an unrelated
  // live process (as after a container restart), must not block a new host.
  await mkdir(join(remoteHome, ".local", "share", "hui-worker", "state"), { recursive: true });
  await writeFile(join(remoteHome, ".local", "share", "hui-worker", "state", "host.pid"), String(process.pid));

  const command = ["env", "-u", "PI_CODING_AGENT_DIR", "-u", "XDG_CONFIG_HOME", "-u", "PI_OFFLINE", `HOME=${remoteHome}`, "SHELL=/bin/sh", `HUI_TEST_BASE_URL=${baseUrl}`, `HUI_TEST_ACCESS=${KEY}`];
  workerId = (await workers.create({ name: "test remote", command: command.map((word) => `'${word}'`).join(" ") })).id;
});

after(async () => {
  workers.disconnectAll();
  provider?.kill();
  // The host is durable by design; stop the one this suite started.
  try { execFileSync("pkill", ["-f", remoteHome]); } catch { /* already gone */ }
  await rm(root, { recursive: true, force: true });
});

test("a remote session runs with gateway credentials and mirrored resources, leaving no secret on the remote", async () => {
  const session = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-basic" });
  try {
    assert.equal(session.resumesInterruptedRuns, false);
    assert.ok(session.sessionFile?.startsWith(remoteHome), String(session.sessionFile));
    const inspection = await session.inspect!();
    assert.match(inspection.prompt, /gateway-skill/u);
    assert.match(inspection.prompt, /package-skill/u);
    assert.ok(!inspection.tools.some((tool) => tool.name === "browser"), "the gateway's browser is not offered remotely");
    const done = settled(session);
    await session.prompt("hello from the gateway");
    await done;
    assert.deepEqual(session.transcript().filter((entry) => entry.kind === "message").map((entry) => entry.kind === "message" && entry.text), ["hello from the gateway", "Fixture response."]);
    for (const file of await remoteFiles()) {
      assert.ok(!(await readFile(file, "utf8")).includes(KEY), `${file} holds the provider key`);
    }
    const view = (await workers.list()).find((worker) => worker.id === workerId)!;
    assert.equal(view.state, "connected");
    assert.ok(view.sync && view.sync.files > 0 && view.sync.errors.length === 0, JSON.stringify(view.sync));
  } finally {
    session.dispose();
  }
});

test("reloading a remote session picks up resources just changed on the gateway", async () => {
  const session = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-reload" });
  try {
    assert.doesNotMatch((await session.inspect!()).prompt, /fresh-skill/u);
    await mkdir(join(agentDir, "skills", "fresh-skill"), { recursive: true });
    await writeFile(join(agentDir, "skills", "fresh-skill", "SKILL.md"), "---\nname: fresh-skill\ndescription: Written after the session started.\n---\nBody\n");
    await session.reload!();
    assert.match((await session.inspect!()).prompt, /fresh-skill/u);
  } finally {
    session.dispose();
    await rm(join(agentDir, "skills", "fresh-skill"), { recursive: true, force: true });
  }
});

test("an OAuth refresh runs on the remote while the gateway holds the lock, and is stored only on the gateway", async () => {
  const session = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-oauth", model: "fx-oauth/fixture" });
  try {
    const done = settled(session);
    await session.prompt("hello with oauth");
    await done;
    assert.equal(session.transcript().at(-1)?.kind === "message" && (session.transcript().at(-1) as { text: string }).text, "Fixture response.");
    const stored = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"))["fx-oauth"];
    assert.equal(stored.refresh, "refresh-1-rotated");
    assert.equal(stored.access, KEY);
    assert.equal(stored.refreshedOn, remoteHome, "the refresh callback ran on the remote");
    assert.ok(!existsSync(join(remoteHome, ".pi", "agent", "auth.json")));
  } finally {
    session.dispose();
  }
});

test("a run keeps going without the gateway and is reattached, not recovered", async () => {
  const first = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-durable" });
  await first.prompt("E2E_REPLAY please");
  await fetch(`${baseUrl.replace(/\/v1$/u, "")}/control/wait-replay-ready`);
  const sessionFile = first.sessionFile!;
  workers.disconnectAll();
  // The gateway is gone; the provider finishes the answer on the remote.
  await fetch(`${baseUrl.replace(/\/v1$/u, "")}/control/release-replay`, { method: "POST" });
  await waitFor(async () => (await readFile(sessionFile, "utf8").catch(() => "")).includes("replay suffix") || undefined, "the remote to persist the answer");
  first.dispose();
  const second = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-durable", sessionFile });
  try {
    assert.equal(second.resumesInterruptedRuns, true);
    assert.equal(second.sessionFile, sessionFile);
    const answer = second.transcript().filter((entry) => entry.kind === "message").at(-1);
    assert.equal(answer?.kind === "message" && answer.text, "Replay prefix — replay suffix");
  } finally {
    second.dispose();
  }
});

test("closing a session stops its remote process, so reopening starts a fresh one", async () => {
  const first = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-close" });
  first.dispose();
  const second = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-close", sessionFile: first.sessionFile! });
  try {
    assert.equal(second.resumesInterruptedRuns, false);
    const done = settled(second);
    await second.prompt("still answering after a reopen");
    await done;
    assert.equal(second.transcript().at(-1)?.kind === "message" && (second.transcript().at(-1) as { text: string }).text, "Fixture response.");
  } finally {
    second.dispose();
  }
});

test("deleting a session stops its remote process even when no gateway is attached", async () => {
  const first = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-forget" });
  workers.disconnectAll();
  first.dispose();
  await workers.connect(workerId);
  await workers.forget(workerId, ["remote-forget"]);
  const second = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-forget" });
  try {
    assert.equal(second.resumesInterruptedRuns, false);
  } finally {
    second.dispose();
  }
});

test("a question asked while no gateway is attached is shown again on reattach", async () => {
  const first = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-question" });
  const asked = new Promise<string>((resolve) => first.subscribe((event) => { if (event.type === "question") resolve(event.question.id); }));
  await first.prompt("/hui-e2e-question select");
  const questionId = await asked;
  workers.disconnectAll();
  first.dispose();
  const second = await piRuntime.start({ cwd: project, worker: workerId, huiSessionId: "remote-question", sessionFile: first.sessionFile! });
  try {
    assert.equal(second.resumesInterruptedRuns, true);
    const pending = await waitFor(() => second.pendingQuestions!().find((question) => question.id === questionId), "the replayed question");
    assert.equal(pending.title, "HUI E2E choice");
    const answered = new Promise<string>((resolve) => second.subscribe((event) => { if (event.type === "notice") resolve(event.message); }));
    await second.respondQuestion!(questionId, { value: "Second option" });
    assert.equal(await answered, "Question answered: Second option");
  } finally {
    second.dispose();
  }
});

test("a bot runs on its host, also while no gateway is connected", async () => {
  const reported: { key: string; status?: string; summary?: string }[] = [];
  const stop = workers.onBots((_id, bots) => { for (const bot of bots) reported.push({ key: bot.key, status: bot.runs[0]?.status, summary: bot.runs[0]?.summary }); });
  try {
    const bot = await workers.saveBot(workerId, "bot-1", { name: "Watcher", cwd: project, instructions: "You are the watcher bot.", prompt: "Check in." });
    assert.equal(bot.nextRunAt, null);
    await workers.runBot(workerId, "bot-1");
    await waitFor(() => reported.find((entry) => entry.key === "bot-1" && entry.status === "completed"), "the manual bot run");
    assert.equal(reported.find((entry) => entry.status === "completed")?.summary, "Fixture response.");

    // Offline, the remote's own PI login is the only credential.
    await mkdir(join(remoteHome, ".pi", "agent"), { recursive: true });
    await writeFile(join(remoteHome, ".pi", "agent", "auth.json"), JSON.stringify({ fx: { type: "api_key", key: KEY } }));
    await workers.saveBot(workerId, "bot-1", { name: "Watcher", cwd: project, instructions: "You are the watcher bot.", prompt: "Check in again.", schedule: { kind: "at", at: new Date(Date.now() + 1500).toISOString() } });
    workers.disconnectAll();
    await waitFor(async () => {
      const raw = JSON.parse(await readFile(join(remoteHome, ".local", "share", "hui-worker", "state", "bots.json"), "utf8")) as { bots: { runs: { status: string; source: string }[] }[] };
      return raw.bots[0]?.runs.length === 2 && raw.bots[0].runs[0]!.status !== "running" ? raw.bots[0].runs[0] : undefined;
    }, "the scheduled offline run");
    const connection = await workers.connect(workerId);
    const [listed] = connection.bots ?? [];
    assert.equal(listed?.runs[0]?.status, "completed", JSON.stringify(listed?.runs[0]));
    assert.equal(listed?.runs[0]?.source, "scheduled");
    // Both runs continued one conversation.
    const transcript = await readFile((listed as unknown as { sessionFile: string }).sessionFile, "utf8");
    assert.ok(transcript.includes("Check in.") && transcript.includes("Check in again."));
    // The instructions reached the model as part of the system prompt.
    const requests = (await readFile(join(root, "provider.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { system?: unknown; messages?: unknown });
    assert.ok(requests.some((body) => JSON.stringify(body.system).includes("You are the watcher bot.") && JSON.stringify(body.messages).includes("Check in again.")));
    await workers.deleteBot(workerId, "bot-1");
  } finally {
    stop();
    await rm(join(remoteHome, ".pi"), { recursive: true, force: true });
  }
});
