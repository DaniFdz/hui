import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { resolveBrowserExecutable } from "../browser/executable.ts";
import { BrowserCookieImportReport, BrowserError, BrowserPreview, BrowserStatus, BrowserViewConnection } from "../api/browser.ts";
import { expectSchema } from "../test-support/api-schema.ts";

const detected = await resolveBrowserExecutable("");

test("browser routes are guarded and the agent bridge drives conversation-scoped tabs", { timeout: 90_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-routes-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  await mkdir(join(dir, "hui"));
  const now = new Date().toISOString();
  await writeFile(join(dir, "hui", "sessions.json"), JSON.stringify({ version: 1, sessions: [
    { id: "alpha", title: "Alpha", tool: "pi", cwd: dir, createdAt: now, updatedAt: now },
    { id: "beta", title: "Beta", tool: "pi", cwd: dir, createdAt: now, updatedAt: now },
  ], groups: [] }));
  const { middleware } = await import("../hui.ts");
  const { stopBackend } = await import("../backend.ts");
  const { agentToolEnvironment } = await import("../agent-tools/bridge.ts");
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const pages = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Route page</title><h1>Route page</h1>");
  }).listen(0, "127.0.0.1");
  await once(pages, "listening");
  const address = server.address();
  const pagesAddress = pages.address();
  assert.ok(address && typeof address !== "string" && pagesAddress && typeof pagesAddress !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.onTestFinished(async () => {
    await stopBackend();
    server.closeAllConnections();
    pages.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(origin + path, { ...init, headers: { "x-hui": "1", "content-type": "application/json", ...init.headers } });
    const body = await response.json() as Record<string, any>;
    if (path.includes("/browser")) {
      expectSchema(response.status >= 400 ? BrowserError : path.endsWith("/connect") ? BrowserViewConnection : path.endsWith("/preview") ? BrowserPreview : BrowserStatus, body as unknown);
    }
    return { status: response.status, body };
  };
  const tool = async (session: string, params: Record<string, unknown>) => {
    const env = await agentToolEnvironment(session);
    const response = await fetch(`${env["HUI_AGENT_BRIDGE_URL"]}/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${env["HUI_AGENT_BRIDGE_TOKEN"]}`, "content-type": "application/json" },
      body: JSON.stringify({ callerSessionId: session, action: "browser", params }),
    });
    return { status: response.status, body: await response.json() as { ok: boolean; result?: { text: string; details: Record<string, any> }; error?: string } };
  };
  const saveBrowser = (browser: Record<string, unknown>) => api("/__hui/settings", { method: "PUT", body: JSON.stringify({ browser }) });

  assert.equal((await fetch(`${origin}/__hui/browser`)).status, 403);
  const initial = await api("/__hui/browser");
  assert.equal(initial.status, 200);
  assert.equal(initial.body["enabled"], true);
  assert.equal(initial.body["headless"], true);
  assert.equal(initial.body["state"], "stopped");
  assert.equal(initial.body["profileDir"], join(dir, "hui", "browser", "profile"));
  assert.deepEqual(initial.body["tabs"], []);
  assert.equal((await api("/__hui/browser", { method: "PUT", body: "{}" })).status, 405);
  const invalid = await api("/__hui/browser", { method: "POST", body: JSON.stringify({ action: "explode" }) });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body["error"], /start or stop/u);
  assert.equal((await api("/__hui/browser/tabs/t1/preview")).status, 404);
  assert.equal((await fetch(`${origin}/__hui/sessions/alpha/browser/connect`, { method: "POST" })).status, 403);
  assert.equal((await api("/__hui/sessions/alpha/browser/connect")).status, 405);
  assert.equal((await api("/__hui/sessions/ghost/browser/connect", { method: "POST", body: "{}" })).status, 404);
  const viewTicket = await api("/__hui/sessions/alpha/browser/connect", { method: "POST", body: "{}" });
  assert.equal(viewTicket.status, 200);
  assert.match(viewTicket.body["url"], /^\/__hui\/browser-stream\?ticket=[\w-]{43}$/u);

  const status = await tool("alpha", { action: "status" });
  assert.equal(status.status, 200);
  assert.match(status.body.result?.text ?? "", /stopped; open starts it headless/u);
  const ghost = await tool("ghost", { action: "status" });
  assert.equal(ghost.status, 400);
  assert.match(ghost.body.error ?? "", /Conversation no longer exists/u);

  await saveBrowser({ enabled: false });
  assert.equal((await api("/__hui/browser")).body["enabled"], false);
  assert.match((await tool("alpha", { action: "status" })).body.error ?? "", /turned off in HUI Settings → Tools → Browser/u);
  assert.equal((await api("/__hui/browser", { method: "POST", body: JSON.stringify({ action: "start" }) })).status, 409);
  await saveBrowser({ enabled: true });

  // Importing a login the operator exported: the file is read by absolute path, and the answer is counts and domains.
  const cookies = async (init: RequestInit = {}) => {
    const response = await fetch(`${origin}/__hui/browser/cookies`, { ...init, headers: { "x-hui": "1", "content-type": "application/json", ...init.headers } });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Record<string, any> };
  };
  const importFile = (path: unknown) => cookies({ method: "POST", body: JSON.stringify({ path }) });
  const cookieDir = join(dir, "cookies");
  await mkdir(cookieDir, { recursive: true });
  const missingFile = join(cookieDir, "missing.json");
  const oversizedFile = join(cookieDir, "oversized.json");
  await writeFile(oversizedFile, "x".repeat(4 * 1024 * 1024 + 1));
  // Exactly at the bound is read and handed to the parser, so the size gate is a limit and not a cutoff.
  const boundaryFile = join(cookieDir, "boundary.json");
  await writeFile(boundaryFile, "x".repeat(4 * 1024 * 1024));
  // A FIFO with no writer: the import must refuse it by its type instead of waiting for a writer to open it.
  const fifoFile = join(cookieDir, "fifo");
  let hasFifo = true;
  try {
    execFileSync("mkfifo", [fifoFile]);
  } catch {
    hasFifo = false;
    console.log("mkfifo is unavailable; skipped the FIFO path check.");
  }
  const pathRefusals: Array<[string, unknown, string]> = [
    ["a relative path", "cookies/login.json", "Give an absolute path to the cookie file."],
    ["a dash", "-", "Give an absolute path to the cookie file."],
    ["a path with a NUL", `${cookieDir}/\u0000.json`, "Give an absolute path to the cookie file."],
    ["a path that is not a string", 42, "Give an absolute path to the cookie file."],
    ["a directory", cookieDir, "No readable file at that path."],
    ["a missing file", missingFile, "No readable file at that path."],
    ["a file one byte over 4 MiB", oversizedFile, "That file is larger than 4 MiB."],
    ["a file of exactly 4 MiB", boundaryFile, "That file is not valid JSON."],
  ];
  if (hasFifo) pathRefusals.push(["a FIFO with no writer", fifoFile, "No readable file at that path."]);
  for (const [label, path, message] of pathRefusals) {
    const refused = await importFile(path);
    assert.equal(refused.status, 400, label);
    assert.equal(refused.body["error"], message, label);
  }
  assert.equal((await cookies()).status, 405, "a cookie import is a POST");
  // A body that is not JSON is refused without repeating any of it — a cookie value sits in the same file as the path.
  const fragment = `fragment-${crypto.randomUUID()}`;
  const malformed = await cookies({ method: "POST", body: `{"path":"${missingFile}","value":"${fragment}"` });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body["error"], "Give an absolute path to the cookie file.", "a body without a path gets the path sentence");
  assert.equal(malformed.text.includes(fragment), false, "a refused body is never repeated back");

  assert.equal((await api("/__hui/browser")).body["state"], "stopped", "the browser is stopped, so an import waits");
  const login = join(cookieDir, "login.json");
  const liveSeconds = Math.floor(Date.now() / 1_000) + 3_600;
  await writeFile(login, JSON.stringify({
    cookies: [
      { name: "sid", value: "abc123", domain: ".example.com", path: "/", expires: liveSeconds, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "stale", value: "gone", domain: ".example.com", path: "/", expires: Math.floor(Date.now() / 1_000) - 60 },
    ],
    origins: [{ origin: "https://example.com", localStorage: [{ name: "token", value: "never imported" }] }],
  }));
  const imported = await importFile(login);
  assert.equal(imported.status, 200, imported.text);
  expectSchema(BrowserCookieImportReport, imported.body);
  assert.deepEqual(imported.body, {
    imported: 1,
    expired: 1,
    domains: [".example.com"],
    applied: "next-start",
    message: "imported 1 cookie for 1 domain (1 expired dropped)\ndomains: .example.com\nThey apply when the managed browser next starts.",
  });
  const pendingPath = join(dir, "hui", "browser", "pending-import.json");
  assert.equal((await stat(pendingPath)).mode & 0o777, 0o600, "the file holds live cookies: only the operator reads it");
  const parkedOf = async () => (JSON.parse(await readFile(pendingPath, "utf8")) as { cookies: Array<{ domain: string; name: string }> }).cookies;
  assert.deepEqual((await parkedOf()).map((cookie) => `${cookie.domain} ${cookie.name}`), [".example.com sid"], "only the cookie still valid waits");

  // No cookie's name or value can reach the answer: the value is built to be unmistakable.
  const secretValue = `value-${crypto.randomUUID()}`;
  const secretName = `name-${crypto.randomUUID()}`;
  const otherSite = join(cookieDir, "other.json");
  await writeFile(otherSite, JSON.stringify([{ name: secretName, value: secretValue, domain: ".other.example", path: "/", expires: -1 }]));
  const second = await importFile(otherSite);
  assert.equal(second.status, 200, second.text);
  assert.equal(second.text.includes(secretValue), false, "a response never carries a cookie's value");
  assert.equal(second.text.includes(secretName), false, "a response never carries a cookie's name");
  assert.equal(String(second.body["message"]).includes(secretValue), false);
  assert.equal(String(second.body["message"]).includes(secretName), false);
  assert.deepEqual(second.body["domains"], [".other.example"]);
  assert.deepEqual((await parkedOf()).map((cookie) => cookie.domain).sort(), [".example.com", ".other.example"], "a second import adds to what already waits");

  if (!detected.executable) {
    console.log("No Chromium-family browser is installed; skipped the live tab checks.");
    return;
  }
  const opened = await tool("alpha", { action: "open", url: `http://127.0.0.1:${pagesAddress.port}/` });
  assert.equal(opened.status, 200, opened.body.error ?? "open failed");
  assert.match(opened.body.result?.text ?? "", /^Opened tab t1\.\nTab t1 · Route page/u);
  assert.deepEqual(opened.body.result?.details["tab"], { id: "t1", title: "Route page", url: `http://127.0.0.1:${pagesAddress.port}/` });
  const running = await api("/__hui/browser");
  assert.equal(running.body["state"], "running");
  assert.equal(running.body["mode"], "headless");
  assert.deepEqual(running.body["tabs"], [{ id: "t1", ownerSessionId: "alpha", ownerTitle: "Alpha", title: "Route page", url: `http://127.0.0.1:${pagesAddress.port}/` }]);
  const preview = await api("/__hui/browser/tabs/t1/preview");
  assert.equal(preview.status, 200);
  assert.match(preview.body["image"], /^data:image\/jpeg;base64,\/9j\//u);
  assert.match((await tool("beta", { action: "tabs" })).body.result?.text ?? "", /No tabs are open/u);

  // Deleting a conversation closes its tabs, and the last tab takes the process with it.
  assert.equal((await api("/__hui/sessions/alpha", { method: "DELETE" })).status, 200);
  assert.deepEqual((await api("/__hui/browser")).body["tabs"], []);
  const deadline = Date.now() + 10_000;
  while ((await api("/__hui/browser")).body["state"] !== "stopped") {
    assert.ok(Date.now() < deadline, "the browser stops once no tab is left");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // A Settings start runs without tabs; a new mode stops it.
  const start = () => api("/__hui/browser", { method: "POST", body: JSON.stringify({ action: "start" }) });
  assert.equal((await start()).body["state"], "running");
  await saveBrowser({ enabled: true, headless: false });
  assert.equal((await api("/__hui/browser")).body["state"], "stopped");
  await saveBrowser({ enabled: true, headless: true });
  const started = await start();
  assert.equal(started.status, 200, String(started.body["error"]));
  assert.equal(started.body["state"], "running");
  // A browser that runs takes an import now, and the answer does not tell the operator to wait for a start.
  const runningFile = join(cookieDir, "running.json");
  await writeFile(runningFile, JSON.stringify([{ name: "live", value: "now", domain: ".running.example", path: "/", expires: -1 }]));
  const appliedNow = await importFile(runningFile);
  assert.equal(appliedNow.status, 200, appliedNow.text);
  assert.equal(appliedNow.body["applied"], "now");
  assert.equal(appliedNow.body["message"], "imported 1 cookie for 1 domain (0 expired dropped)\ndomains: .running.example");
  const stopped = await api("/__hui/browser", { method: "POST", body: JSON.stringify({ action: "stop" }) });
  assert.equal(stopped.body["state"], "stopped");
});
