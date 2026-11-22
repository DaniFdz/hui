import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { waitFor } from "../test-support/wait-for.ts";
import { LocalProviderService, readLocalProviderConfigs, validHealthUrl } from "./local-providers.ts";

type Dirs = { root: string; dir: string; agent: string };

async function dirs(t: TestContext): Promise<Dirs> {
  const root = await mkdtemp(join(tmpdir(), "hui-local-providers-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "hui");
  const agent = join(root, "agent");
  await mkdir(dir, { recursive: true });
  await mkdir(agent, { recursive: true });
  return { root, dir, agent };
}

async function writePi(agent: string, providers: Record<string, unknown>): Promise<void> {
  await writeFile(join(agent, "models.json"), JSON.stringify({ providers }));
}

type Fixture = { url: string; release: () => void; close: () => Promise<void>; server: Server };
/** A health endpoint that answers 503 until released, then 200. */
async function health(t: TestContext): Promise<Fixture> {
  let ready = false;
  const server = createServer((_request, response) => {
    response.writeHead(ready ? 200 : 503);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    release: () => { ready = true; },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const status = async (service: LocalProviderService, id: string) =>
  (await service.snapshot()).providers.find((provider) => provider.id === id);

test("the snapshot lists PI custom providers with their reachability, and leaves HUI-managed ones to provider cards", async (t) => {
  const { dir, agent } = await dirs(t);
  const endpoint = await health(t);
  endpoint.release();
  await writePi(agent, {
    ollama: { name: "Living room", baseUrl: endpoint.url, models: [{ id: "qwen" }, { id: "llama" }] },
    managed: { baseUrl: endpoint.url, models: [{ id: "other" }] },
  });
  await writeFile(join(dir, "models.json"), JSON.stringify({ managed: { models: ["other"] } }));
  const service = new LocalProviderService({ dir, agentDir: agent });
  const snapshot = await service.snapshot();
  assert.deepEqual(snapshot.providers.map((provider) => provider.id), ["ollama"]);
  const ollama = snapshot.providers[0]!;
  assert.equal(ollama.name, "Living room");
  assert.equal(ollama.models, 2);
  assert.equal(ollama.inPi, true);
  assert.equal(ollama.hasEndpoint, true);
  assert.equal(ollama.configured, false);
  assert.equal(ollama.status, "online");
  assert.deepEqual(ollama.startCommand, undefined);
});

test("a provider with no base URL or health URL is unknown rather than offline", async (t) => {
  const { dir, agent } = await dirs(t);
  await writePi(agent, { studio: { name: "Studio", models: [{ id: "m" }] } });
  const service = new LocalProviderService({ dir, agentDir: agent });
  const studio = (await service.snapshot()).providers[0]!;
  assert.equal(studio.status, "unknown");
  assert.equal(studio.hasEndpoint, false);
  assert.match(studio.message ?? "", /health URL/u);
});

test("a start command round-trips through a private file, and validation keeps bad input out", async (t) => {
  const { dir, agent } = await dirs(t);
  await writePi(agent, { studio: { name: "Studio", baseUrl: "http://127.0.0.1:9", models: [{ id: "m" }] } });
  const service = new LocalProviderService({ dir, agentDir: agent });
  const saved = await service.save("studio", {
    startCommand: "wakeonlan aa:bb:cc:dd:ee:ff\nssh studio 'systemctl start studio'",
    healthUrl: "http://192.168.1.5:8080/health",
    readyTimeoutMs: 90_000,
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.readyTimeoutMs, 90_000);
  assert.equal(saved.healthUrl, "http://192.168.1.5:8080/health");
  const file = join(dir, "local-providers.json");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readLocalProviderConfigs(dir), {
    studio: { startCommand: "wakeonlan aa:bb:cc:dd:ee:ff\nssh studio 'systemctl start studio'", healthUrl: "http://192.168.1.5:8080/health", readyTimeoutMs: 90_000 },
  });

  await assert.rejects(service.save("studio", { startCommand: " " }), /Enter a start command/u);
  await assert.rejects(service.save("studio", { startCommand: "true", healthUrl: "http://user:pass@host/" }), /without a username or password/u);
  await assert.rejects(service.save("studio", { startCommand: "true", healthUrl: "ftp://host/" }), /http:\/\/ or https:\/\//u);
  await assert.rejects(service.save("studio", { startCommand: "true", readyTimeoutMs: 9_999 }), /ready timeout/u);
  await assert.rejects(service.save("studio", { startCommand: "true", extra: true }), /Unknown field/u);
  await assert.rejects(service.save("missing", { startCommand: "true" }), /PI's models.json/u);
  await assert.rejects(service.save("Bad Id", { startCommand: "true" }), /Unknown local provider/u);
  assert.equal(validHealthUrl("http://127.0.0.1:11434/v1"), true);
  assert.equal(validHealthUrl("https://example.test/health"), true);
  assert.equal(validHealthUrl("http://user:pass@example.test/"), false);
});

test("a malformed configuration file is reported instead of silently losing every command", async (t) => {
  const { dir } = await dirs(t);
  await writeFile(join(dir, "local-providers.json"), "{not json");
  await assert.rejects(readLocalProviderConfigs(dir), /could not be read/u);
  await writeFile(join(dir, "local-providers.json"), JSON.stringify({ studio: { startCommand: true } }));
  await assert.rejects(readLocalProviderConfigs(dir), /Invalid local provider studio/u);
});

test("Start runs one command, reports Starting, and the request waits until the health endpoint answers", async (t) => {
  const { root, dir, agent } = await dirs(t);
  const endpoint = await health(t);
  const marker = join(root, "command-ran");
  const log = join(root, "commands.log");
  await writePi(agent, { studio: { name: "Studio", baseUrl: endpoint.url, models: [{ id: "m" }] } });
  const service = new LocalProviderService({ dir, agentDir: agent });
  await service.save("studio", { startCommand: `printf x >> '${log}'\ntouch '${marker}'`, readyTimeoutMs: 30_000 });

  const first = await service.start("studio");
  assert.equal(first.status, "starting");
  const second = await service.start("studio");
  assert.equal(second.status, "starting", "a second Start while one runs returns the running one");
  await waitFor("the command to run", () => existsSync(marker));
  assert.equal((await status(service, "studio"))?.status, "starting", "the command finished while the server was still booting");
  assert.equal(await readFile(log, "utf8"), "x", "the start command ran exactly once");

  const waiting = service.waitWhileStarting("studio");
  endpoint.release();
  await waiting;
  const online = await waitFor("the provider to be online", async () => {
    const view = await status(service, "studio");
    return view?.status === "online" ? view : undefined;
  });
  assert.equal(online.checkedAt === undefined, false);
});

test("an already answering server is not started again", async (t) => {
  const { root, dir, agent } = await dirs(t);
  const endpoint = await health(t);
  endpoint.release();
  const marker = join(root, "command-ran");
  await writePi(agent, { studio: { name: "Studio", baseUrl: endpoint.url, models: [{ id: "m" }] } });
  const service = new LocalProviderService({ dir, agentDir: agent });
  await service.save("studio", { startCommand: `touch '${marker}'`, readyTimeoutMs: 10_000 });
  await service.start("studio");
  await waitFor("the provider to be online", async () => (await status(service, "studio"))?.status === "online");
  assert.equal(existsSync(marker), false);
});

test("a start without a health endpoint finishes as unknown, and a failing command fails the waiting request", async (t) => {
  const { root, dir, agent } = await dirs(t);
  const endpoint = await health(t);
  const release = join(root, "fail-now");
  await writePi(agent, {
    studio: { name: "Studio", models: [{ id: "m" }] },
    broken: { name: "Broken", baseUrl: endpoint.url, models: [{ id: "m" }] },
  });
  const service = new LocalProviderService({ dir, agentDir: agent });
  await service.save("studio", { startCommand: "true", readyTimeoutMs: 10_000 });
  await service.start("studio");
  const unknown = await waitFor("the command to finish", async () => {
    const view = await status(service, "studio");
    return view?.status === "unknown" ? view : undefined;
  });
  assert.match(unknown.message ?? "", /Set a health URL/u);

  await service.save("broken", { startCommand: `while [ ! -e '${release}' ]; do sleep 0.05; done; echo boom >&2; exit 3`, readyTimeoutMs: 10_000 });
  await service.start("broken");
  const waiting = assert.rejects(service.waitWhileStarting("broken"), /exited with code 3.*boom/su);
  await writeFile(release, "");
  await waiting;
  assert.equal((await status(service, "broken"))?.status, "failed");
});

test("a request waiting for a start stops when that request is cancelled, and the start still finishes", async (t) => {
  const { root, dir, agent } = await dirs(t);
  const endpoint = await health(t);
  const marker = join(root, "command-ran");
  await writePi(agent, { studio: { name: "Studio", baseUrl: endpoint.url, models: [{ id: "m" }] } });
  const service = new LocalProviderService({ dir, agentDir: agent });
  await service.save("studio", { startCommand: `touch '${marker}'`, readyTimeoutMs: 10_000 });
  await service.start("studio");
  await waitFor("the command to run", () => existsSync(marker));
  const stop = new AbortController();
  const waiting = service.waitWhileStarting("studio", stop.signal);
  stop.abort(new Error("Stopped by the operator"));
  await assert.rejects(waiting, /Stopped by the operator/u);
  endpoint.release();
  await waitFor("the start to finish", async () => (await status(service, "studio"))?.status === "online");
});

test("a start that never becomes ready fails at its timeout", { timeout: 30_000 }, async (t) => {
  const { dir, agent } = await dirs(t);
  const endpoint = await health(t);
  await writePi(agent, { studio: { name: "Studio", baseUrl: endpoint.url, models: [{ id: "m" }] } });
  const service = new LocalProviderService({ dir, agentDir: agent });
  await service.save("studio", { startCommand: "sleep 30", readyTimeoutMs: 10_000 });
  await service.start("studio");
  await assert.rejects(service.waitWhileStarting("studio"), /did not answer within 10 s/u);
  const failed = await waitFor("the failed state", async () => {
    const view = await status(service, "studio");
    return view?.status === "failed" ? view : undefined;
  });
  assert.match(failed.message ?? "", /did not answer within 10 s/u);
});

test("a missing or malformed PI models.json lists no custom providers, and removing a command is idempotent in effect", async (t) => {
  const { dir, agent } = await dirs(t);
  const service = new LocalProviderService({ dir, agentDir: agent });
  assert.deepEqual((await service.snapshot()).providers, []);
  await writeFile(join(agent, "models.json"), "{not json");
  assert.deepEqual((await service.snapshot()).providers, []);

  await writePi(agent, { studio: { name: "Studio", models: [{ id: "m" }] } });
  await service.save("studio", { startCommand: "true" });
  await service.remove("studio");
  assert.equal((await service.snapshot()).providers[0]?.configured, false);
  await assert.rejects(service.remove("studio"), /No start command/u);
});
