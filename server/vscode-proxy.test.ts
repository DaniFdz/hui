import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { waitFor } from "./test-support/wait-for.ts";
import { VscodeService } from "./vscode.ts";
import {
  attachVscodeTransport, downstreamHeaders, isVscodeProxyPath, patchWorkbenchHtml, proxyVscodeHttp, serveVscodeEnter,
  upstreamHeaders, vscodeCookieSecrets, vscodeThemeDefaults,
} from "./vscode-proxy.ts";

const FAKE = fileURLToPath(new URL("./test-support/fake-vscode-server.mjs", import.meta.url));
const DARK = { background: "#101114", panel: "#17181c", elevated: "#202127", text: "#e6e6e6", border: "#2a2b31", accent: "#ff5c5c" };
const LIGHT = { background: "#fbfaf8", panel: "#f3f1ec", elevated: "#ffffff", text: "#403c35" };

test("only paths under the base path are proxied, never HUI's enter route", () => {
  assert.equal(isVscodeProxyPath("/__hui/vscode/"), true);
  assert.equal(isVscodeProxyPath("/__hui/vscode"), true);
  assert.equal(isVscodeProxyPath("/__hui/vscode/oss-dev/static/out/vs/code/browser/workbench/workbench.js"), true);
  assert.equal(isVscodeProxyPath("/__hui/vscode/enter"), false);
  assert.equal(isVscodeProxyPath("/__hui/vscode-server"), false);
  assert.equal(isVscodeProxyPath("/__hui/vscodex/"), false);
  assert.equal(isVscodeProxyPath("/__hui/sessions"), false);
});

test("upstream headers keep Host, drop HUI's cookie and forwarding headers, and carry the real token", () => {
  const headers = upstreamHeaders({
    host: "gateway.tail:7777", accept: "text/html", "accept-encoding": "gzip, br", "x-hui": "1", connection: "keep-alive",
    "x-forwarded-host": "evil.example", "x-forwarded-prefix": "/elsewhere", "x-original-host": "evil.example",
    cookie: "hui-vscode=secret1; vscode-tkn=forged; theme=dark; hui-vscode=secret2",
  }, "TOKEN");
  assert.deepEqual(headers, { host: "gateway.tail:7777", accept: "text/html", "accept-encoding": "gzip, br", cookie: "theme=dark; vscode-tkn=TOKEN" });
  assert.equal(upstreamHeaders({ "accept-encoding": "gzip" }, "T", { identity: true })["accept-encoding"], undefined);
  const upgrade = upstreamHeaders({ upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "k" }, "T", { upgrade: true });
  assert.equal(upgrade["connection"], "Upgrade");
  assert.equal(upgrade["upgrade"], "websocket");
  assert.equal(upgrade["sec-websocket-key"], "k");
  assert.deepEqual(vscodeCookieSecrets("a=1; hui-vscode=one;hui-vscode=two; hui-vscode="), ["one", "two"]);
});

test("VS Code's token cookie never reaches the browser; its other headers do", () => {
  assert.deepEqual(downstreamHeaders({
    "content-type": "text/html", connection: "keep-alive", "transfer-encoding": "chunked",
    "set-cookie": ["vscode-tkn=TOKEN; Max-Age=604800; SameSite=Lax", "vscode.nls.locale=en; Path=/"],
  }), { "content-type": "text/html", "set-cookie": ["vscode.nls.locale=en; Path=/"] });
  assert.deepEqual(downstreamHeaders({ "set-cookie": ["vscode-tkn=T"] }), {});
});

function workbench(settings: Record<string, unknown>): string {
  return `<html><head><meta id="vscode-workbench-web-configuration" data-settings="${JSON.stringify(settings).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></head></html>`;
}
function configOf(html: string): Record<string, any> {
  const raw = /data-settings="([^"]*)"/u.exec(html)?.[1] ?? "";
  return JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&")) as Record<string, any>;
}

test("the workbench page gains the token, quiet defaults and HUI's theme without losing its own settings", () => {
  const patched = configOf(patchWorkbenchHtml(workbench({
    remoteAuthority: "gateway:1", serverBasePath: "/__hui/vscode", enableWorkspaceTrust: true,
    configurationDefaults: { "editor.fontSize": 13, "a&b": "\"q\"" },
  }), { token: "TOKEN", theme: DARK }));
  assert.equal(patched["connectionToken"], "TOKEN");
  assert.equal(patched["remoteAuthority"], "gateway:1");
  assert.equal(patched["enableWorkspaceTrust"], false);
  const defaults = patched["configurationDefaults"];
  assert.equal(defaults["editor.fontSize"], 13);
  assert.equal(defaults["a&b"], "\"q\"", "escaping round-trips");
  assert.equal(defaults["security.workspace.trust.enabled"], false);
  assert.equal(defaults["workbench.startupEditor"], "none");
  assert.equal(defaults["workbench.colorTheme"], "Default Dark Modern");
  assert.equal(defaults["workbench.colorCustomizations"]["editor.background"], "#101114");
  assert.equal(defaults["workbench.colorCustomizations"]["focusBorder"], "#ff5c5c");
  assert.equal(vscodeThemeDefaults(LIGHT).colorTheme, "Default Light Modern");
  assert.equal(vscodeThemeDefaults(LIGHT).colorCustomizations["sideBar.border"], undefined, "no border color, no border override");
  const plain = configOf(patchWorkbenchHtml(workbench({ remoteAuthority: "g" }), { token: "T" }));
  assert.equal(plain["configurationDefaults"]["workbench.colorTheme"], undefined, "no theme, VS Code's own default");
  assert.equal(patchWorkbenchHtml("<html>no config</html>", { token: "T" }), "<html>no config</html>");
});

type Harness = { origin: string; vscode: VscodeService; server: Server; dir: string };

async function harness(t: TestContext): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "hui-vscode-proxy-"));
  const executable = join(dir, "openvscode-server");
  await writeFile(executable, `#!/bin/sh\n"${process.execPath}" "${FAKE}" "$@"\n`);
  await chmod(executable, 0o755);
  const vscode = new VscodeService({ dir: join(dir, "state"), settings: async () => ({ enabled: true, executable }), readyTimeoutMs: 15_000 });
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://h").pathname;
    if (path === "/__hui/vscode/enter") serveVscodeEnter(request, response, vscode);
    else if (isVscodeProxyPath(path)) proxyVscodeHttp(request, response, vscode);
    else response.writeHead(404).end();
  });
  const detach = attachVscodeTransport(server, vscode);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    detach();
    await vscode.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  return { origin: `http://127.0.0.1:${address.port}`, vscode, server, dir };
}

/** connect → enter: the cookie a frame ends up with. */
async function enter(h: Harness, theme = DARK): Promise<{ cookie: string; location: string; setCookie: string }> {
  const connection = await h.vscode.connect("/work/my repo", theme);
  const response = await fetch(h.origin + connection.url, { redirect: "manual" });
  assert.equal(response.status, 303);
  const setCookie = response.headers.get("set-cookie") ?? "";
  return { cookie: setCookie.split(";")[0] ?? "", location: response.headers.get("location") ?? "", setCookie };
}

test("the proxy refuses frames without a valid cookie and never starts VS Code for them", { timeout: 60_000 }, async (t) => {
  const h = await harness(t);
  for (const headers of [{}, { cookie: "hui-vscode=forged" }, { cookie: "vscode-tkn=guess" }] as Array<Record<string, string>>) {
    const response = await fetch(`${h.origin}/__hui/vscode/?folder=%2Fetc`, { headers });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /<meta name="hui-vscode-error" content="unauthorized"/u);
  }
  assert.equal((await h.vscode.status()).state, "stopped");
  const bad = await fetch(`${h.origin}/__hui/vscode/enter?ticket=nope`, { redirect: "manual" });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("set-cookie"), null);
  assert.match(await bad.text(), /content="expired"/u);

  const connection = await h.vscode.connect("/work", DARK);
  const crossSite = await fetch(h.origin + connection.url, { redirect: "manual", headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(crossSite.status, 403, "a ticket cannot be redeemed from another site");
});

test("enter sets a strict, HttpOnly cookie scoped to the proxy and redirects to the folder", { timeout: 60_000 }, async (t) => {
  const h = await harness(t);
  const { setCookie, location, cookie } = await enter(h);
  assert.match(setCookie, /^hui-vscode=[\w-]{43}; Path=\/__hui\/vscode; HttpOnly; SameSite=Strict$/u);
  assert.equal(location, "/__hui/vscode/?folder=%2Fwork%2Fmy%20repo");
  const reused = await fetch(`${h.origin}/__hui/vscode/enter?ticket=${cookie}`, { redirect: "manual" });
  assert.equal(reused.status, 403);
});

test("the workbench page arrives patched, and VS Code's token cookie stays on the gateway", { timeout: 60_000 }, async (t) => {
  const h = await harness(t);
  const { cookie, location } = await enter(h);
  const page = await fetch(h.origin + location, { headers: { cookie, accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.deepEqual(page.headers.getSetCookie(), ["vscode.other=1; Path=/"]);
  const html = await page.text();
  assert.match(html, /fake workbench for \/work\/my repo/u);
  const config = configOf(html);
  assert.equal(config["connectionToken"], await readFile(h.vscode.tokenFile, "utf8"));
  assert.equal(config["remoteAuthority"], new URL(h.origin).host, "VS Code sees the browser's Host, so its WebSocket comes back through HUI");
  assert.equal(config["configurationDefaults"]["workbench.colorCustomizations"]["sideBar.background"], DARK.panel);
});

test("requests keep their path, body and method; the browser's cookie and forwarding headers do not pass", { timeout: 60_000 }, async (t) => {
  const h = await harness(t);
  const { cookie } = await enter(h);
  const response = await fetch(`${h.origin}/__hui/vscode/echo/deep/path?x=1&y=two`, {
    method: "POST",
    body: "payload",
    headers: { cookie: `theme=1; ${cookie}; vscode-tkn=forged`, "x-forwarded-host": "evil.example", "x-forwarded-prefix": "/x" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  const echo = await response.json() as { method: string; url: string; body: string; headers: Record<string, string> };
  assert.equal(echo.method, "POST");
  assert.equal(echo.url, "/__hui/vscode/echo/deep/path?x=1&y=two");
  assert.equal(echo.body, "payload");
  assert.equal(echo.headers["cookie"], `theme=1; vscode-tkn=${await readFile(h.vscode.tokenFile, "utf8")}`);
  assert.equal(echo.headers["x-forwarded-host"], undefined);
  assert.equal(echo.headers["x-forwarded-prefix"], undefined);
  assert.equal(echo.headers["host"], new URL(h.origin).host);
  const crossSite = await fetch(`${h.origin}/__hui/vscode/echo`, { headers: { cookie, "sec-fetch-site": "cross-site" } });
  assert.equal(crossSite.status, 403, "a valid cookie does not help a cross-site request");
});

function openSocket(url: string, headers: Record<string, string>): Promise<{ socket: WebSocket; first: string } | { status: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("message", (data) => resolve({ socket, first: String(data) }));
    socket.once("unexpected-response", (_request, response: IncomingMessage) => { response.resume(); resolve({ status: response.statusCode ?? 0 }); });
    socket.once("error", reject);
  });
}

test("the WebSocket passes through for the cookie's holder from the same origin only", { timeout: 60_000 }, async (t) => {
  const h = await harness(t);
  const { cookie } = await enter(h);
  const ws = h.origin.replace("http:", "ws:") + "/__hui/vscode/?reconnectionToken=abc&skipWebSocketFrames=false";
  assert.deepEqual(await openSocket(ws, { origin: h.origin }), { status: 403 });
  assert.deepEqual(await openSocket(ws, { origin: "http://evil.example", cookie }), { status: 403 });
  assert.deepEqual(await openSocket(ws, { origin: h.origin, cookie: "hui-vscode=forged" }), { status: 403 });
  const opened = await openSocket(ws, { origin: h.origin, cookie });
  assert.ok("socket" in opened);
  const hello = JSON.parse(opened.first) as { url: string; cookie: string };
  assert.equal(hello.url, "/__hui/vscode/?reconnectionToken=abc&skipWebSocketFrames=false");
  assert.equal(hello.cookie, `vscode-tkn=${await readFile(h.vscode.tokenFile, "utf8")}`);
  const reply = once(opened.socket, "message");
  opened.socket.send("ping");
  assert.equal(String((await reply)[0]), "echo:ping");
  assert.equal((await h.vscode.status()).connections, 1, "an open socket holds the server");
  opened.socket.close();
  await waitFor("the socket to release the server", async () => (await h.vscode.status()).connections === 0);

  // A stopped server is not restarted by its frame reconnecting; only an open from HUI starts it.
  await h.vscode.stop();
  assert.deepEqual(await openSocket(ws, { origin: h.origin, cookie }), { status: 503 });
  const page = await fetch(`${h.origin}/__hui/vscode/echo`, { headers: { cookie } });
  assert.equal(page.status, 503);
  assert.match(await page.text(), /content="stopped"/u);
  assert.equal((await h.vscode.status()).state, "stopped");
});
