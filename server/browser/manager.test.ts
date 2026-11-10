import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import type { BrowserSettings } from "../hui-settings.ts";
import { resolveBrowserExecutable } from "./executable.ts";
import { browserLaunchArguments, BrowserToolError, ManagedBrowser, normalizeBrowserUrl, type BrowserViewFrame } from "./manager.ts";
import type { BrowserViewAction, BrowserViewState } from "../api/browser.ts";

/** The page's own text, without the boundary markers a tool result wraps it in. */
const pageText = (text: string): string => {
  const match = /--- HUI_PAGE_CONTENT nonce=[0-9a-f]+ origin=\S* ---\n([\s\S]*?)\n--- END_HUI_PAGE_CONTENT nonce=[0-9a-f]+ ---/u.exec(text);
  return (match?.[1] ?? text).trimEnd();
};

const noBrowser = { platform: "linux" as const, env: { PATH: "/nowhere" }, home: "/home/nobody", isExecutable: async () => false, readdir: async () => [] as string[] };

test("URLs are normalized for agents and dangerous schemes are refused", () => {
  assert.equal(normalizeBrowserUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeBrowserUrl("localhost:5173/app"), "http://localhost:5173/app");
  assert.equal(normalizeBrowserUrl("127.0.0.1"), "http://127.0.0.1/");
  assert.equal(normalizeBrowserUrl("192.168.1.20:8080"), "http://192.168.1.20:8080/");
  assert.equal(normalizeBrowserUrl(" https://example.com "), "https://example.com/");
  assert.equal(normalizeBrowserUrl("file:///tmp/report.html"), "file:///tmp/report.html");
  assert.equal(normalizeBrowserUrl("about:blank"), "about:blank");
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "chrome://settings", "", 42]) {
    assert.throws(() => normalizeBrowserUrl(url), BrowserToolError);
  }
});

test("launch arguments use the DevTools pipe, a dedicated profile and no debugging port", () => {
  const headless = browserLaunchArguments({ profileDir: "/p", headless: true, width: 1280, height: 800 });
  assert.ok(headless.includes("--remote-debugging-pipe"));
  assert.ok(headless.includes("--user-data-dir=/p"));
  assert.ok(headless.includes("--headless=new"));
  assert.ok(headless.includes("--use-mock-keychain") && headless.includes("--password-store=basic"));
  assert.ok(!headless.some((argument) => argument.startsWith("--remote-debugging-port")));
  assert.equal(headless.at(-1), "about:blank");
  const windowed = browserLaunchArguments({ profileDir: "/p", headless: false, width: 1280, height: 800, noSandbox: true });
  assert.ok(!windowed.includes("--headless=new"));
  assert.ok(windowed.includes("--no-sandbox"));
});

test("settings gate every call and a missing browser is reported, not guessed", async () => {
  let settings: BrowserSettings = { enabled: false, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: "/nonexistent/profile", readSettings: async () => settings, probe: noBrowser });
  await assert.rejects(browser.tool("alpha", { action: "status" }, { cwd: "/" }), /turned off/u);
  await assert.rejects(browser.start(), /Turn on the browser tool/u);
  settings = { ...settings, enabled: true };
  await assert.rejects(browser.tool("alpha", { action: "explode" }, { cwd: "/" }), /action must be one of/u);
  await assert.rejects(browser.tool("alpha", { action: "snapshot" }, { cwd: "/" }), /No tab is open in this conversation/u);
  await assert.rejects(browser.tool("alpha", { action: "snapshot", tabId: "x1" }, { cwd: "/" }), /tabId must be/u);
  await assert.rejects(browser.tool("alpha", { action: "open", url: "example.com" }, { cwd: "/" }), /No Chromium-family browser[\s\S]*Settings → Tools → Browser/u);
  const status = await browser.status();
  assert.equal(status.state, "stopped");
  assert.equal(status.executable, null);
  assert.match(status.executableError, /No Chromium-family browser/u);
  assert.match(status.lastError, /No Chromium-family browser/u);
  assert.match((await browser.tool("alpha", { action: "status" }, { cwd: "/" })).text, /stopped; open starts it headless/u);
  assert.equal((await browser.tool("alpha", { action: "tabs" }, { cwd: "/" })).text, "No tabs are open in this conversation. Call open with a URL.");
  await browser.applySettings(settings);
  assert.match((await browser.status()).lastError, /No Chromium-family browser/u, "unchanged settings keep the failure");
  settings = { ...settings, executablePath: "relative/chrome" };
  await browser.applySettings(settings);
  const changed = await browser.status();
  assert.equal(changed.lastError, "", "a failure from an earlier configuration is not shown as current");
  assert.match(changed.executableError, /absolute path/u);
});

const PAGES: Record<string, string> = {
  "/form": `<!doctype html><title>Browser form</title>
    <h1>Browser form</h1>
    <label for="name">Name</label><input id="name">
    <button id="greet" onclick="const n = document.getElementById('name').value; document.getElementById('out').textContent = 'Hello, ' + n + '!'; console.log('greeted ' + n)">Greet</button>
    <button onclick="alert('Saved')">Alert</button>
    <button onclick="document.getElementById('out').textContent = confirm('Delete?') ? 'confirmed' : 'cancelled'">Confirm</button>
    <button onclick="window.open('/popup')">Popup</button>
    <select aria-label="Color" onchange="document.getElementById('out').textContent = 'color ' + this.value"><option value="r">Red</option><option value="b">Blue</option></select>
    <button id="disabled" disabled>Disabled</button>
    <button id="hidegreet" onclick="document.getElementById('greet').style.display = 'none'">Hide greet</button>
    <a href="/next">Next page</a>
    <p id="out"></p><p id="width"></p>
    <script>
      const width = () => { document.getElementById('width').textContent = 'width ' + innerWidth; };
      addEventListener('resize', width); width();
      setTimeout(() => { const late = document.createElement('p'); late.textContent = 'Late content'; document.body.append(late); }, 200);
    </script>`,
  "/toggle": `<!doctype html><title>Toggle</title>
    <p id="banner">Banner</p><button id="hide" onclick="document.getElementById('banner').style.display = 'none'">Hide</button>`,
  "/replace": `<!doctype html><title>Replace</title>
    <button id="target" onclick="document.getElementById('out').textContent = 'old target clicked'">Target</button>
    <button id="swap" onclick="const old = document.getElementById('target'); const next = old.cloneNode(true); next.onclick = () => { document.getElementById('out').textContent = 'new target clicked'; }; old.replaceWith(next)">Swap</button>
    <p id="out">idle</p>`,
  "/twins": `<!doctype html><title>Twins</title>
    <button id="target" onclick="document.getElementById('out').textContent = 'single target clicked'">Target</button>
    <button id="swap" onclick="const old = document.getElementById('target'); const next = old.cloneNode(true); next.textContent = 'Target'; old.replaceWith(next, next.cloneNode(true))">Swap</button>
    <p id="out">idle</p>`,
    "/next": "<!doctype html><title>Next</title><h1>Second page</h1><script>console.error('boom from next')</script>",
  "/popup": "<!doctype html><title>Popup</title><h1>Popup page</h1>",
  "/scroll": `<!doctype html><title>Tall page</title>
    <h1>Tall page</h1><div style="height:4000px"></div><p id="y">0</p>
    <script>addEventListener('scroll', () => { document.getElementById('y').textContent = String(Math.round(scrollY)); });</script>`,
  "/secret": `<!doctype html><title>Sign in</title>
    <h1>Sign in</h1>
    <form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'password=' + document.getElementById('pw').value">
      <label for="pw">Password</label><input id="pw" type="password">
      <button type="submit">Sign in</button>
    </form>
    <p id="out">idle</p>`,
  "/handoff": `<!doctype html><title>Handoff page</title>
    <style>body{margin:0} #go{position:absolute;left:0;top:0;width:200px;height:60px}</style>
    <button id="go" onclick="document.getElementById('out').textContent = 'clicked'">Go</button>
    <input id="field" autofocus style="position:absolute;left:0;top:100px" oninput="document.getElementById('out').textContent = 'typed ' + this.value">
    <p id="out">idle</p>`,
  "/overlay": `<!doctype html><title>Pseudo overlay</title>
    <style>
      .surface { position: relative; }
      .surface::after { content: ""; position: absolute; inset: 0; z-index: 1; }
      #clear::after { pointer-events: none; }
    </style>
    <div class="surface" id="clear"><button onclick="document.getElementById('out').textContent = 'sent'">Send</button></div>
    <div class="surface" id="opaque"><button onclick="document.getElementById('out').textContent = 'blocked'">Blocked</button></div>
    <p id="out">idle</p>`,
};

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const detected = await resolveBrowserExecutable("");

test("a real headless browser serves agent tabs end to end", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-test-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (owner: string, params: Record<string, unknown>) => browser.tool(owner, params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };

  assert.equal((await browser.status()).state, "stopped", "the browser starts lazily");
  const opened = await call("alpha", { action: "open", url: `${origin}/form` });
  assert.match(opened.text, /^Opened tab t1\.\nTab t1 · Browser form\n/u);
  assert.match(opened.text, /- heading "Browser form" \[level=1\]/u);
  assert.deepEqual(opened.details["tab"], { id: "t1", title: "Browser form", url: `${origin}/form` });
  const running = await browser.status((id) => (id === "alpha" ? "Alpha chat" : ""));
  assert.equal(running.state, "running");
  assert.equal(running.mode, "headless");
  assert.deepEqual(running.tabs, [{ id: "t1", ownerSessionId: "alpha", ownerTitle: "Alpha chat", title: "Browser form", url: `${origin}/form` }]);

  const name = refIn(opened.text, /textbox "Name" \[ref=(e\d+)\]/u);
  const greet = refIn(opened.text, /button "Greet" \[ref=(e\d+)\]/u);
  assert.match((await call("alpha", { action: "act", kind: "type", ref: name, text: "HUI agent" })).text, /Typed 9 characters/u);
  assert.match((await call("alpha", { action: "act", kind: "click", ref: greet })).text, /^Clicked e\d+ \(button "Greet"\)\./u);
  assert.match(pageText((await call("alpha", { action: "text", selector: "#out" })).text), /Hello, HUI agent!$/u);
  assert.match((await call("alpha", { action: "console" })).text, /\[log\] greeted HUI agent/u);
  assert.match((await call("alpha", { action: "act", kind: "wait", text: "Late content", timeoutMs: 5_000 })).text, /condition was met/u);
  await assert.rejects(call("alpha", { action: "act", kind: "wait", text: "Never shown", timeoutMs: 1_000 }), /Timed out after 1000 ms/u);

  // Dialogs never block the page: alerts are accepted, confirms dismissed unless asked.
  const alert = await call("alpha", { action: "act", kind: "click", ref: refIn(opened.text, /button "Alert" \[ref=(e\d+)\]/u) });
  assert.deepEqual(alert.details["dialogs"], ["alert \"Saved\" accepted"]);
  const confirmRef = refIn(opened.text, /button "Confirm" \[ref=(e\d+)\]/u);
  await call("alpha", { action: "act", kind: "click", ref: confirmRef });
  assert.match(pageText((await call("alpha", { action: "text", selector: "#out" })).text), /cancelled$/u);
  await call("alpha", { action: "act", kind: "click", ref: confirmRef, dialog: "accept" });
  assert.match(pageText((await call("alpha", { action: "text", selector: "#out" })).text), /confirmed$/u);
  await call("alpha", { action: "act", kind: "select", ref: refIn(opened.text, /combobox "Color" \[ref=(e\d+)\]/u), values: ["Blue"] });
  assert.match(pageText((await call("alpha", { action: "text", selector: "#out" })).text), /color b$/u);

  const shot = await call("alpha", { action: "screenshot", path: "shots/form.png" });
  assert.equal(shot.image?.mimeType, "image/png");
  assert.equal(shot.details["width"], 1280);
  assert.equal(shot.details["height"], 800);
  assert.equal((await readFile(join(dir, "shots", "form.png"))).subarray(1, 4).toString(), "PNG");
  await assert.rejects(call("alpha", { action: "screenshot", path: "form.jpg" }), /must end in \.png/u);
  await call("alpha", { action: "resize", width: 390, height: 844 });
  assert.match(pageText((await call("alpha", { action: "text", selector: "#width" })).text), /width 390$/u);
  await call("alpha", { action: "resize" });
  assert.match(pageText((await call("alpha", { action: "text", selector: "#width" })).text), /width 1280$/u);

  // Popups join the opener's conversation; other conversations see nothing.
  await call("alpha", { action: "act", kind: "click", ref: refIn(opened.text, /button "Popup" \[ref=(e\d+)\]/u) });
  const tabs = await eventually(() => call("alpha", { action: "tabs" }), (result) => /t2 · Popup/u.test(result.text));
  assert.match(tabs.text, /^t1 \(current\) · Browser form/u);
  assert.match(tabs.text, /\nt2 · Popup — http:\/\/127\.0\.0\.1:\d+\/popup$/u);
  assert.match((await call("beta", { action: "tabs" })).text, /No tabs are open/u);
  await assert.rejects(call("beta", { action: "snapshot", tabId: "t1" }), /Tab t1 is not open in this conversation/u);
  assert.match((await call("alpha", { action: "snapshot", tabId: "t2" })).text, /heading "Popup page"/u);
  assert.match((await call("alpha", { action: "close" })).text, /Closed tab t2\. The current tab is now t1\./u);

  // A navigation retires the old document's refs.
  const link = refIn(opened.text, /link "Next page" \[ref=(e\d+)\]/u);
  const navigated = await call("alpha", { action: "act", kind: "click", ref: link });
  assert.match(navigated.text, /The page navigated; refs from the previous page no longer apply/u);
  assert.match(navigated.text, /Tab t1 · Next/u);
  await assert.rejects(call("alpha", { action: "act", kind: "click", ref: greet }), /not in tab t1's latest snapshot/u);
  assert.match((await call("alpha", { action: "console", errorsOnly: true })).text, /\[error\] boom from next/u);
  assert.match((await call("alpha", { action: "back" })).text, /^Went back in tab t1\.\nTab t1 · Browser form/u);
  assert.match((await call("alpha", { action: "reload" })).text, /heading "Browser form"/u);
  const missing = await call("alpha", { action: "navigate", url: `${origin}/missing` });
  assert.match(missing.text, /Navigated tab t1/u);

  // A new mode stops the running process and its tabs.
  settings = { ...settings, headless: false };
  await browser.applySettings(settings);
  assert.equal(browser.running, false);
  assert.deepEqual((await browser.status()).tabs, []);
  if (process.platform === "linux" && !process.env["DISPLAY"] && !process.env["WAYLAND_DISPLAY"]) {
    await assert.rejects(call("alpha", { action: "open", url: `${origin}/form` }), /needs a display/u);
  }
  settings = { ...settings, headless: true };
  assert.match((await call("gamma", { action: "open", url: `${origin}/next` })).text, /Opened tab t\d+\.\nTab t\d+ · Next/u);
  settings = { ...settings, enabled: false };
  await assert.rejects(call("gamma", { action: "tabs" }), /turned off/u);
  await browser.applySettings(settings);
  assert.equal(browser.running, false);
  assert.equal((await browser.status()).state, "stopped");
});

test("a click passes through a transparent pseudo overlay but not an opaque one", {
  skip: !detected.executable,
  timeout: 60_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-overlay-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };

  // HUI paints decorative `::after` covers over its composers, and Chromium's
  // hit test reports that pseudo-element even when it is pointer-transparent.
  const opened = await call({ action: "open", url: `${origin}/overlay` });
  await call({ action: "act", kind: "click", ref: refIn(opened.text, /button "Send" \[ref=(e\d+)\]/u) });
  assert.match(pageText((await call({ action: "text", selector: "#out" })).text), /sent$/u);

  // The same overlay with pointer events enabled owns the hit point, so the
  // guard still refuses to click through it.
  await assert.rejects(
    call({ action: "act", kind: "click", ref: refIn(opened.text, /button "Blocked" \[ref=(e\d+)\]/u) }),
    /covered by div#opaque/u,
  );
  assert.match(pageText((await call({ action: "text", selector: "#out" })).text), /sent$/u);
});

test("stopped or idle conversations never leave a headless browser running", {
  skip: !detected.executable,
  timeout: 60_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-lifetime-"));
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browsers: ManagedBrowser[] = [];
  t.onTestFinished(async () => {
    for (const browser of browsers) await browser.stop();
    await rm(dir, { recursive: true, force: true });
  });
  const managed = (options: { idleTabMs?: number } = {}) => {
    const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings, ...options });
    browsers.push(browser);
    return browser;
  };
  const idle = async (browser: ManagedBrowser) => {
    const status = await eventually(() => browser.status(), (value) => value.state === "stopped");
    assert.equal(status.state, "stopped");
    assert.deepEqual(status.tabs, []);
  };

  // The operator stops a turn while its first open is still launching the browser.
  const browser = managed();
  const call = (owner: string, params: Record<string, unknown>) => browser.tool(owner, params, { cwd: dir });
  const interrupted = call("alpha", { action: "open" });
  browser.closeOwner("alpha");
  await assert.rejects(interrupted, /browser tabs were closed/u);
  await idle(browser);

  // Stopping one conversation keeps another's tab; closing the last one stops the browser.
  await call("alpha", { action: "open" });
  await call("beta", { action: "open" });
  browser.closeOwner("alpha");
  assert.deepEqual((await browser.status()).tabs.map((tab) => tab.ownerSessionId), ["beta"]);
  assert.equal(browser.running, true);
  assert.match((await call("beta", { action: "close" })).text, /No tabs remain open/u);
  await idle(browser);

  // Tabs nobody uses close by themselves, and the browser with them.
  const unused = managed({ idleTabMs: 200 });
  await unused.tool("gamma", { action: "open" }, { cwd: dir });
  await idle(unused);
});

test("a browser killed behind the gateway's back is relaunched on the next open", {
  skip: !detected.executable || process.platform === "win32",
  timeout: 60_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-kill-"));
  const profileDir = join(dir, "profile");
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir, readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  await call({ action: "open" });
  assert.equal(browser.running, true);

  // An operator cleanup script (`pkill -f user-data-dir=...`) or a crash takes
  // the whole browser process down between calls; the open that follows must
  // relaunch it instead of writing to the dead pipe.
  execFileSync("pkill", ["-9", "-f", `user-data-dir=${profileDir}`]);
  const reopened = await call({ action: "open", url: "about:blank" });
  assert.match(reopened.text, /^Opened tab t\d+\./u);
  assert.equal(browser.running, true, "the next open relaunches the browser");
});

test("an action racing an external kill names the exit instead of a protocol error", {
  skip: !detected.executable || process.platform === "win32",
  timeout: 60_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-kill-action-"));
  const profileDir = join(dir, "profile");
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir, readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  await call({ action: "open", url: "about:blank" });

  // The next action can arrive before the gateway has processed the process
  // exit; it must report the restart it can recover from, not the raw pipe error.
  execFileSync("pkill", ["-9", "-f", `user-data-dir=${profileDir}`]);
  await assert.rejects(call({ action: "snapshot" }), (error: unknown) => {
    assert.ok(error instanceof BrowserToolError, `raw error escaped: ${String(error)}`);
    assert.ok(error.status < 500, `a server fault escaped: ${error.status}`);
    return true;
  });
});

test("another Chromium process owning the profile is reported instead of a connection error", {
  skip: !detected.executable || process.platform === "win32",
  timeout: 60_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-profile-in-use-"));
  const profileDir = join(dir, "profile");
  const executable = detected.executable;
  assert.ok(executable);
  // An operator tool (Google re-login) takes the shared profile exclusively.
  const squatter = spawn(executable.path, browserLaunchArguments({ profileDir, headless: true, width: 1280, height: 800 }), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  t.onTestFinished(() => { if (squatter.exitCode === null && squatter.signalCode === null) squatter.kill("SIGKILL"); });
  assert.equal(await eventually(async () => (await readdir(profileDir).catch((): string[] => [])).includes("SingletonLock"), Boolean), true, "the squatter holds the profile");

  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir, readSettings: async () => settings });
  t.onTestFinished(async () => {
    // Cleanups run last-registered first, so stop the squatter here too: it writes its profile until it exits.
    if (squatter.exitCode === null && squatter.signalCode === null) { squatter.kill("SIGKILL"); await once(squatter, "exit"); }
    await browser.stop();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  await assert.rejects(call({ action: "open" }), (error: Error) => {
    assert.match(error.message, /exited while starting/u);
    assert.match(error.message, /profile is in use/u, "the profile conflict is named, not the closed pipe");
    return true;
  });

  squatter.kill("SIGKILL");
  await once(squatter, "exit");
  assert.match((await call({ action: "open", url: "about:blank" })).text, /^Opened tab t\d+\./u);
});

test("the live view follows the agent's tab, streams frames only while watched and marks clicks", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-view-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (owner: string, params: Record<string, unknown>) => browser.tool(owner, params, { cwd: dir });
  const states: BrowserViewState[] = [];
  const frames: BrowserViewFrame[] = [];
  const actions: BrowserViewAction[] = [];
  const view = browser.watch("alpha", {
    state: (state) => states.push(state),
    frame: (frame) => frames.push(frame),
    action: (action) => actions.push(action),
  });
  const until = async (label: string, check: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) assert.fail(`Timed out waiting for ${label}.`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const latest = () => states.at(-1)!;

  // A copy: deepEqual would otherwise narrow the live array's type for later checks.
  assert.deepEqual([...states], [{ running: false, tabs: [], current: null, watching: null, following: true, handoff: null }], "watching never launches the browser");
  assert.equal(browser.running, false);

  const opened = await call("alpha", { action: "open", url: `${origin}/form` });
  await until("the agent's tab to be watched", () => latest().watching === "t1");
  assert.deepEqual(latest(), {
    running: true, mode: "headless", tabs: [{ id: "t1", title: "Browser form", url: `${origin}/form` }],
    current: "t1", watching: "t1", following: true, handoff: null,
  });
  await until("a first frame", () => frames.some((frame) => frame.tabId === "t1"));
  const first = frames.find((frame) => frame.tabId === "t1")!;
  assert.deepEqual([first.image[0], first.image[1]], [0xff, 0xd8], "frames are JPEG");
  assert.deepEqual([first.width, first.height], [1280, 800]);
  assert.equal(browser.activeScreencasts, 1);
  assert.equal(actions.at(-1)?.text, `Opened ${origin}/form`);

  const greet = /button "Greet" \[ref=(e\d+)\]/u.exec(opened.text)![1]!;
  const before = frames.length;
  await call("alpha", { action: "act", kind: "click", ref: greet });
  const click = actions.find((action) => action.text.startsWith("Clicked"))!;
  assert.match(click.text, /^Clicked e\d+ \(button "Greet"\)$/u);
  assert.ok(click.point && click.point.x > 0 && click.point.x < 1280 && click.point.y > 0 && click.point.y < 800, JSON.stringify(click.point));
  await until("a repaint after the click", () => frames.length > before);
  await call("alpha", { action: "snapshot" });
  assert.equal(actions.at(-1)?.text, "Read the page");

  // Another conversation's tab gets its own window: alpha keeps painting and
  // never sees beta's tabs.
  await call("beta", { action: "open", url: `${origin}/next` });
  assert.ok(states.every((state) => state.tabs.every((tab) => tab.id !== "t2")));
  const typed = frames.length;
  const name = /textbox "Name" \[ref=(e\d+)\]/u.exec(opened.text)![1]!;
  const started = Date.now();
  await call("alpha", { action: "act", kind: "type", ref: name, text: "Live" });
  assert.ok(Date.now() - started < 3_000, "input is not delayed by a hidden tab");
  await until("a repaint in the first conversation", () => frames.length > typed);
  assert.equal(actions.at(-1)?.text, "Typed 4 characters into e" + name.slice(1) + " (textbox \"Name\")");

  // A popup joins the conversation; following switches with the agent, and a
  // picked tab stays pinned until the operator follows again.
  const popupButton = /button "Popup" \[ref=(e\d+)\]/u.exec(opened.text)![1]!;
  await call("alpha", { action: "act", kind: "click", ref: popupButton });
  await until("the popup in the view state", () => latest().tabs.length === 2);
  const popup = latest().tabs[1]!.id;
  assert.equal(latest().watching, "t1", "a popup does not take the view from the agent's tab");
  await call("alpha", { action: "focus", tabId: popup });
  await until("the view to follow the agent", () => latest().watching === popup && latest().current === popup);
  await until("popup frames", () => frames.some((frame) => frame.tabId === popup));
  const pinnedAt = frames.length;
  view.select("t1");
  assert.deepEqual([latest().watching, latest().following, latest().current], ["t1", false, popup]);
  assert.equal(frames.at(-1)?.tabId, "t1", "switching tabs sends the last frame at once");
  assert.ok(frames.length > pinnedAt);
  view.select(null);
  assert.deepEqual([latest().watching, latest().following], [popup, true]);
  view.select("t2");
  assert.equal(latest().watching, popup, "another conversation's tab cannot be watched");

  view.close();
  assert.equal(browser.activeScreencasts, 0, "closing the last viewer stops the screencast");
  const other: BrowserViewState[] = [];
  const replayed: BrowserViewAction[] = [];
  const order: string[] = [];
  const second = browser.watch("alpha", {
    state: (state) => { other.push(state); order.push("state"); },
    frame: () => order.push("frame"),
    action: (action) => { replayed.push(action); order.push("action"); },
  });
  // A viewer that joins later learns the latest action at once, without a stale
  // click point, and before the page (a snapshot viewer leaves on its first frame).
  assert.deepEqual(replayed, [{ tabId: popup, text: actions.at(-1)!.text, at: actions.at(-1)!.at }]);
  assert.deepEqual(order, ["state", "action", "frame"]);
  assert.equal(actions.at(-1)!.text, `Switched to ${popup}`);
  browser.closeOwner("alpha");
  await until("the closed tabs to leave the view", () => other.at(-1)?.tabs.length === 0);
  assert.deepEqual(other.at(-1), { running: true, mode: "headless", tabs: [], current: null, watching: null, following: true, handoff: null });
  await browser.stop();
  await until("the stopped browser in the view", () => other.at(-1)?.running === false);
  second.close();
});


test("a handoff hands one tab to the operator and returns a fresh snapshot", {
  skip: !detected.executable,
  timeout: 120_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-handoff-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  assert.match((await call({ action: "open", url: `${origin}/handoff` })).text, /Opened tab t1/u);

  // A viewer learns the tab is waiting for it, and the agent may not touch the tab meanwhile.
  const states: BrowserViewState[] = [];
  const view = browser.watch("alpha", { state: (state) => states.push(state), frame: () => {}, action: () => {} });
  t.onTestFinished(() => view.close());
  const waiting = call({ action: "handoff", message: "Type your name, then click Go.", timeoutMs: 30_000 });
  const latest = () => Promise.resolve(states.at(-1));
  await eventually(latest, (state) => state?.handoff?.tabId === "t1");
  assert.equal(states.at(-1)?.handoff?.message, "Type your name, then click Go.");
  await assert.rejects(call({ action: "snapshot" }), /operator has taken over t1/u);
  await assert.rejects(call({ action: "act", kind: "click", ref: "e1" }), /operator has taken over t1/u);

  // Their click focuses the field, their keys type into it.
  browser.operator("alpha", { action: "pointer", tabId: "t1", kind: "down", x: 10, y: 110, button: "left" });
  browser.operator("alpha", { action: "pointer", tabId: "t1", kind: "up", x: 10, y: 110, button: "left" });
  for (const key of ["a", "b", "c"]) browser.operator("alpha", { action: "key", tabId: "t1", key });
  // Input for another conversation's view, or another tab, is ignored.
  browser.operator("beta", { action: "continue", tabId: "t1" });
  browser.operator("alpha", { action: "key", tabId: "t2", key: "x" });
  browser.operator("alpha", { action: "continue", tabId: "t1" });

  const finished = await waiting;
  assert.equal(finished.details["outcome"], "continued");
  assert.match(finished.text, /^The operator finished in tab t1\./u);
  assert.match(finished.text, /typed abc/u);
  assert.match(finished.text, /The snapshot above is current/u);
  await eventually(latest, (state) => state?.handoff === null);

  // Control is back: the agent acts on the refs the handoff returned.
  const go = /button "Go" \[ref=(e\d+)\]/u.exec(finished.text)?.[1];
  assert.ok(go, finished.text);
  assert.match((await call({ action: "act", kind: "click", ref: go })).text, /^Clicked e\d+ \(button "Go"\)\./u);
  assert.match(pageText((await call({ action: "text", selector: "#out" })).text), /clicked$/u);

  // Nobody comes: the wait ends by itself and says so, and the tab is usable again.
  const timedOut = await call({ action: "handoff", message: "Sign in.", timeoutMs: 5_000 });
  assert.equal(timedOut.details["outcome"], "timeout");
  assert.match(timedOut.text, /did not take over tab t1 within 5 seconds/u);
  assert.match((await call({ action: "snapshot" })).text, /heading|button|textbox/u);
});

test("the origin allowlist refuses other hosts, including one a link in an allowed page reaches", {
  skip: !detected.executable,
  timeout: 120_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-origins-"));
  const allowed = createServer((request, response) => {
    const path = request.url ?? "/";
    const body = path === "/offsite"
      ? `<!doctype html><title>Allowed page</title><h1>Allowed page</h1><a href="${blockedOrigin}/private">Elsewhere</a>`
      : PAGES[path];
    response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    response.end(body ?? "missing");
  }).listen(0, "127.0.0.1");
  const blocked = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Elsewhere</title><h1>Elsewhere</h1>");
  }).listen(0, "127.0.0.1");
  await Promise.all([once(allowed, "listening"), once(blocked, "listening")]);
  const allowedAddress = allowed.address();
  const blockedAddress = blocked.address();
  assert.ok(allowedAddress && typeof allowedAddress !== "string" && blockedAddress && typeof blockedAddress !== "string");
  const origin = `http://127.0.0.1:${allowedAddress.port}`;
  const blockedOrigin = `http://127.0.0.1:${blockedAddress.port}`;
  const settings: BrowserSettings = {
    enabled: true, headless: true, executablePath: "", mirrorState: false,
    allowedOrigins: [`127.0.0.1:${allowedAddress.port}`],
  };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    allowed.close();
    blocked.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };

  // The allowed host opens; another host, port or file is refused before a tab goes there.
  assert.match((await call({ action: "open", url: `${origin}/form` })).text, /Opened tab t1/u);
  await assert.rejects(call({ action: "open", url: `${blockedOrigin}/` }), /127\.0\.0\.1:\d+ is not in this browser's allowed origins \(127\.0\.0\.1:\d+\)/u);
  await assert.rejects(call({ action: "navigate", url: `${blockedOrigin}/private` }), /not in this browser's allowed origins/u);
  await assert.rejects(call({ action: "navigate", url: `file://${join(dir, "notes.html")}` }), /not in this browser's allowed origins/u);
  assert.match((await call({ action: "navigate", url: `${origin}/offsite` })).text, /heading "Allowed page"/u);

  // A link inside the allowed page is stopped at the boundary; the result says so once.
  const elsewhere = refIn((await call({ action: "snapshot" })).text, /link "Elsewhere" \[ref=(e\d+)\]/u);
  const blockedClick = await call({ action: "act", kind: "click", ref: elsewhere });
  assert.match(blockedClick.text, /This tab tried to reach http:\/\/127\.0\.0\.1:\d+\/private, which is not in the browser's allowed origins/u);
  assert.match(blockedClick.text, /URL: about:blank/u);
  assert.doesNotMatch((await call({ action: "snapshot" })).text, /tried to reach/u, "a block is reported once");
});

test("a popup or redirect that leaves the allowed origins is stopped and reported", {
  skip: !detected.executable,
  timeout: 120_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-origins-leave-"));
  const blocked = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Elsewhere</title><h1>Elsewhere</h1>");
  }).listen(0, "127.0.0.1");
  await once(blocked, "listening");
  const blockedAddress = blocked.address();
  assert.ok(blockedAddress && typeof blockedAddress !== "string");
  const blockedOrigin = `http://127.0.0.1:${blockedAddress.port}`;
  const allowed = createServer((request, response) => {
    const path = request.url ?? "/";
    if (path === "/redirect") {
      response.writeHead(302, { location: `${blockedOrigin}/private` });
      response.end();
      return;
    }
    const body = path === "/leave"
      ? `<!doctype html><title>Allowed page</title><h1>Allowed page</h1>
        <button id="popup" onclick="window.open('${blockedOrigin}/private')">Open elsewhere</button>
        <a href="/redirect">Redirect elsewhere</a>`
      : undefined;
    response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    response.end(body ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(allowed, "listening");
  const allowedAddress = allowed.address();
  assert.ok(allowedAddress && typeof allowedAddress !== "string");
  const origin = `http://127.0.0.1:${allowedAddress.port}`;
  const settings: BrowserSettings = {
    enabled: true, headless: true, executablePath: "", mirrorState: false,
    allowedOrigins: [`127.0.0.1:${allowedAddress.port}`],
  };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    allowed.close();
    blocked.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };

  const opened = await call({ action: "open", url: `${origin}/leave` });
  const popupButton = refIn(opened.text, /button "Open elsewhere" \[ref=(e\d+)\]/u);

  // A popup opened at another host is attached, then stopped and left blank.
  await call({ action: "act", kind: "click", ref: popupButton });
  const tabs = await eventually(() => call({ action: "tabs" }), (result) => /t2/u.test(result.text));
  assert.match(tabs.text, /t2 · .* — about:blank \(blocked: not in the allowed origins\)/u);
  const popup = /t2/u.exec(tabs.text)?.[0] ?? "t2";
  const popupResult = await call({ action: "navigate", url: `${origin}/leave`, tabId: popup });
  assert.match(popupResult.text, /This tab tried to reach http:\/\/127\.0\.0\.1:\d+\/private, which is not in the browser's allowed origins/u);
  assert.doesNotMatch((await call({ action: "navigate", url: `${origin}/leave`, tabId: popup })).text, /tried to reach/u, "a block is reported once");

  // A redirect from an allowed page to another host is stopped in the same way.
  await call({ action: "focus", tabId: "t1" });
  const redirect = refIn((await call({ action: "snapshot" })).text, /link "Redirect elsewhere" \[ref=(e\d+)\]/u);
  const redirected = await call({ action: "act", kind: "click", ref: redirect });
  assert.match(redirected.text, /This tab tried to reach http:\/\/127\.0\.0\.1:\d+\/private, which is not in the browser's allowed origins/u);
  // The blanking is its own navigation: wait for the tab to report the empty document.
  const cleared = await eventually(() => call({ action: "tabs" }), (result) => /t1 .* — about:blank$/mu.test(result.text));
  assert.match(cleared.text, /t1 .* — about:blank$/mu);
});

test("going back into a page the allowlist now refuses is refused", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-origins-history-"));
  const page = (title: string) => `<!doctype html><title>${title}</title><h1>${title}</h1>`;
  const first = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page("First host"));
  }).listen(0, "127.0.0.1");
  const second = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page("Second host"));
  }).listen(0, "127.0.0.1");
  await Promise.all([once(first, "listening"), once(second, "listening")]);
  const firstAddress = first.address();
  const secondAddress = second.address();
  assert.ok(firstAddress && typeof firstAddress !== "string" && secondAddress && typeof secondAddress !== "string");
  const allowed = `http://127.0.0.1:${firstAddress.port}`;
  const other = `http://127.0.0.1:${secondAddress.port}`;
  // Both hosts start allowed, then the operator narrows the list to the first.
  let settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [`127.0.0.1:${firstAddress.port}`, `127.0.0.1:${secondAddress.port}`] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    first.close();
    second.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  assert.match((await call({ action: "open", url: `${allowed}/` })).text, /Opened tab t1/u);
  assert.match((await call({ action: "navigate", url: `${other}/` })).text, /heading "Second host"/u);
  settings = { ...settings, allowedOrigins: [`127.0.0.1:${secondAddress.port}`] };
  // Back now points at the first host, which the list no longer allows.
  await assert.rejects(call({ action: "back" }), /127\.0\.0\.1:\d+ is not in this browser's allowed origins \(127\.0\.0\.1:\d+\)/u);
  assert.match((await call({ action: "tabs" })).text, /Second host/u, "the refused move leaves the tab where it was");
  // The page the list still allows goes on working after the refusal.
  assert.match((await call({ action: "navigate", url: `${other}/` })).text, /heading "Second host"/u);
});

test("a handoff ends when its conversation stops or the browser does", {
  skip: !detected.executable,
  timeout: 120_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-handoff-end-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const states: BrowserViewState[] = [];
  const view = browser.watch("alpha", { state: (state) => states.push(state), frame: () => {}, action: () => {} });
  t.onTestFinished(() => view.close());
  const waiting = () => eventually(() => Promise.resolve(states.at(-1)), (state) => Boolean(state?.handoff));
  const openTab = async () => {
    assert.match((await call({ action: "open", url: `${origin}/form` })).text, /Opened tab t\d+/u);
  };

  // Stop or removing the conversation settles the wait as closed, and its tab goes with it.
  await openTab();
  const stopping = call({ action: "handoff", message: "Sign in.", timeoutMs: 30_000 });
  await waiting();
  browser.closeOwner("alpha");
  const closed = await stopping;
  assert.equal(closed.details["outcome"], "closed");
  assert.match(closed.text, /^Tab t1 closed while the operator had it\. Open a new tab to continue\./u);
  assert.match((await call({ action: "tabs" })).text, /No tabs are open in this conversation/u);

  // The browser stopping under the wait settles it as stopped, and says how to start again.
  await openTab();
  const waitingAgain = call({ action: "handoff", message: "Sign in.", timeoutMs: 30_000 });
  await waiting();
  await browser.stop();
  const stopped = await waitingAgain;
  assert.equal(stopped.details["outcome"], "stopped");
  assert.match(stopped.text, /^The managed browser stopped while the operator had tab t\d+\. Call open to start it again\./u);
  assert.equal(browser.running, false);
});

test("the operator's wheel scrolls the handed-over tab, and input waits for no handoff otherwise", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-handoff-wheel-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const scrollY = async () => {
    const text = pageText((await call({ action: "text", selector: "#y" })).text);
    return Number(/(\d+)$/u.exec(text)?.[1] ?? NaN);
  };

  assert.match((await call({ action: "open", url: `${origin}/scroll` })).text, /Opened tab t1/u);
  assert.equal(await scrollY(), 0);

  const states: BrowserViewState[] = [];
  const view = browser.watch("alpha", { state: (state) => states.push(state), frame: () => {}, action: () => {} });
  t.onTestFinished(() => view.close());
  const handling = call({ action: "handoff", message: "Scroll down, then continue.", timeoutMs: 30_000 });
  await eventually(() => Promise.resolve(states.at(-1)), (state) => Boolean(state?.handoff));
  browser.operator("alpha", { action: "wheel", tabId: "t1", x: 200, y: 200, deltaX: 0, deltaY: 600 });
  browser.operator("alpha", { action: "continue", tabId: "t1" });
  await handling;
  const scrolled = await eventually(() => scrollY(), (value) => value > 0, 3_000);
  assert.ok(scrolled > 0, `the operator's wheel reached the page (scrollY ${scrolled})`);

  // Nothing waits now, so further operator input is ignored rather than scrolling the page.
  const settled = await scrollY();
  browser.operator("alpha", { action: "wheel", tabId: "t1", x: 200, y: 200, deltaX: 0, deltaY: 600 });
  browser.operator("alpha", { action: "key", tabId: "t1", key: "End" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await scrollY(), settled);
});

test("a stored site secret is typed only on its own origin and never comes back in the result", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-secret-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const stored = new Map<string, { name: string; origin: string; value: string; createdAt: string }>();
  const secrets = {
    find: async (name: string) => stored.get(name),
    list: async () => [...stored.values()].map(({ name, origin, createdAt }) => ({ name, origin, createdAt })),
  };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings, secrets });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  const opened = await call({ action: "open", url: `${origin}/secret` });
  const password = /textbox "Password" \[ref=(e\d+)\]/u.exec(opened.text)?.[1];
  assert.ok(password, opened.text);

  // A secret for another origin is refused, and the message never carries the value.
  stored.set("fixture", { name: "fixture", origin: "https://example.com", value: "s3cret-token", createdAt: "2026-11-08T00:00:00.000Z" });
  const refused = await call({ action: "secret", name: "fixture", ref: password }).then(() => undefined, (error: unknown) => error);
  assert.ok(refused instanceof BrowserToolError);
  assert.match(refused.message, /belongs to https:\/\/example\.com, and e\d+ \(textbox "Password"\) is on http:\/\/127\.0\.0\.1:\d+/u);
  assert.equal(refused.message.includes("s3cret-token"), false);

  // On its own origin the gateway types it, submits, and reports only that it did.
  stored.set("fixture", { name: "fixture", origin, value: "s3cret-token", createdAt: "2026-11-08T00:00:00.000Z" });
  const typed = await call({ action: "secret", name: "fixture", ref: password, submit: true });
  assert.match(typed.text, /Typed the site secret "fixture" into e\d+ \(textbox "Password"\) on http:\/\/127\.0\.0\.1:\d+ and pressed Enter/u);
  assert.doesNotMatch(typed.text, /s3cret-token/u);
  assert.doesNotMatch(JSON.stringify(typed.details), /s3cret-token/u);
  assert.match(pageText((await call({ action: "text", selector: "#out" })).text), /password=s3cret-token$/u);

  // An unknown name lists the stored names, which are not secret.
  await assert.rejects(call({ action: "secret", name: "nope", ref: password }), /No site secret named "nope"\. Stored names: fixture/u);
});


test("a steps call runs dependent interactions in one go and reports each one", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-steps-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const opened = await call({ action: "open", url: `${origin}/form` });
  const name = /textbox "Name" \[ref=(e\d+)\]/u.exec(opened.text)?.[1];
  const greet = /button "Greet" \[ref=(e\d+)\]/u.exec(opened.text)?.[1];
  assert.ok(name && greet, opened.text);

  // Type, click, then wait for what the click rendered: all one call.
  const steps = await call({
    action: "steps",
    steps: [
      { kind: "type", ref: name, text: "One call" },
      { kind: "click", ref: greet },
      { kind: "wait", text: "Hello, One call!" },
    ],
  });
  assert.match(steps.text, /^Ran 3 steps in tab t1\./u);
  assert.match(steps.text, /\n1\. type: Typed 8 characters/u);
  assert.match(steps.text, /\n2\. click: Clicked e\d+/u);
  assert.match(steps.text, /\n3\. wait: Waited \d+ ms until the condition was met/u);
  assert.match(pageText((await call({ action: "text", selector: "#out" })).text), /Hello, One call!$/u);

  // A failing step names itself and everything that already ran.
  const failed = await call({ action: "steps", steps: [{ kind: "type", ref: name, text: "x" }, { kind: "wait", text: "Never shown", timeoutMs: 1_000 }] }).then(() => undefined, (error: unknown) => error);
  assert.ok(failed instanceof BrowserToolError);
  assert.match(failed.message, /^Step 2 \(wait\) failed: Timed out after 1000 ms/u);
  assert.match(failed.message, /Steps that ran: 1\. type: Typed 1 character/u);

  // The sequence stays on one tab and is bounded.
  await assert.rejects(call({ action: "steps", steps: [] }), /steps must list 1 to 20 steps/u);
  await assert.rejects(call({ action: "steps", steps: Array.from({ length: 21 }, () => ({ kind: "scroll", deltaY: 10 })) }), /steps must list 1 to 20 steps/u);
  await assert.rejects(call({ action: "steps", steps: [{ kind: "explode" }] }), /Step 1 needs kind/u);
});

test("a navigation between steps retires the refs the earlier snapshot handed out", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-steps-nav-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const opened = await call({ action: "open", url: `${origin}/form` });
  const name = /textbox "Name" \[ref=(e\d+)\]/u.exec(opened.text)?.[1];
  const next = /link "Next page" \[ref=(e\d+)\]/u.exec(opened.text)?.[1];
  assert.ok(name && next, opened.text);

  // Step one navigates; step two still names a ref from the old document.
  const failed = await call({
    action: "steps",
    steps: [
      { kind: "click", ref: next },
      { kind: "type", ref: name, text: "too late" },
    ],
  }).then(() => undefined, (error: unknown) => error);
  assert.ok(failed instanceof BrowserToolError);
  assert.match(failed.message, /^Step 2 \(type\) failed: Ref e\d+ is not in tab t1's latest snapshot\./u);
  assert.match(failed.message, /Steps that ran: 1\. click: Clicked e\d+ \(link "Next page"\)\./u);
  assert.match((await call({ action: "tabs" })).text, /Next/u, "the navigation itself still happened");
});

test("page output is bounded by a fresh nonce, and get/is read one thing at a time", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-loop-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };
  const opened = await call({ action: "open", url: `${origin}/form` });
  const name = refIn(opened.text, /textbox "Name" \[ref=(e\d+)\]/u);
  const greet = refIn(opened.text, /button "Greet" \[ref=(e\d+)\]/u);
  const disabled = refIn(opened.text, /button "Disabled" \[ref=(e\d+)\]/u);
  const hideGreet = refIn(opened.text, /button "Hide greet" \[ref=(e\d+)\]/u);

  // A page-sourced result carries a nonce on both markers, and each result gets its own.
  const boundary = /--- HUI_PAGE_CONTENT nonce=([0-9a-f]{16}) origin=(http:\/\/127\.0\.0\.1:\d+) ---/u.exec(opened.text);
  assert.ok(boundary, opened.text);
  assert.match(opened.text, new RegExp(`--- END_HUI_PAGE_CONTENT nonce=${boundary[1]} ---$`, "u"));
  const second = await call({ action: "snapshot" });
  const secondNonce = /nonce=([0-9a-f]{16})/u.exec(second.text)?.[1];
  assert.ok(secondNonce);
  assert.notEqual(secondNonce, boundary[1], "each result mints its own nonce");
  assert.match(second.text, /--- HUI_PAGE_CONTENT nonce=[0-9a-f]{16} origin=http:\/\/127\.0\.0\.1:\d+ ---/u);

  // get reads one property without a snapshot.
  assert.match((await call({ action: "get", what: "title" })).text, /^Title: Browser form$/u);
  assert.match((await call({ action: "get", what: "url" })).text, new RegExp(`^URL: ${origin}/form$`, "u"));
  assert.match((await call({ action: "get", what: "count", selector: "#greet" })).text, /^1 element matches #greet\.$/u);
  assert.match((await call({ action: "get", what: "attr", ref: greet, attribute: "id" })).text, /^attr of e\d+ \(button "Greet"\): "greet"$/u);
  await assert.rejects(call({ action: "get", what: "nonsense", ref: greet }), /get needs what:/u);
  await assert.rejects(call({ action: "get", what: "attr", ref: greet }), /get attr needs attribute/u);
  await call({ action: "act", kind: "type", ref: name, text: "Loop" });
  assert.match((await call({ action: "get", what: "value", ref: name })).text, /^value of e\d+ \(textbox "Name"\): "Loop"$/u);
  assert.equal(pageText((await call({ action: "get", what: "text", selector: "h1" })).text), "Browser form");

  // is answers one state; a missing selector answers hidden/attached rather than failing.
  assert.match((await call({ action: "is", state: "visible", ref: greet })).text, /^e\d+ \(button "Greet"\) is visible\.$/u);
  assert.match((await call({ action: "is", state: "enabled", ref: greet })).text, /is enabled\.$/u);
  assert.match((await call({ action: "is", state: "focused", ref: name })).text, /is focused\.$/u);
  assert.match((await call({ action: "is", state: "attached", selector: "#nope" })).text, /is not attached/u);
  assert.match((await call({ action: "is", state: "hidden", selector: "#nope" })).text, /is hidden/u);

  // A click refuses a disabled or hidden target instead of reporting success.
  await assert.rejects(call({ action: "act", kind: "click", ref: disabled }), /is disabled; nothing was clicked/u);
  await call({ action: "act", kind: "click", ref: hideGreet });
  await assert.rejects(call({ action: "act", kind: "click", ref: greet }), /is not visible; scroll it into view/u);

  // A snapshot can be scoped to one element and cut at a depth.
  const scoped = await call({ action: "snapshot", selector: "h1" });
  assert.match(scoped.text, /Scoped to h1\./u);
  assert.match(pageText(scoped.text), /Browser form/u);
  assert.doesNotMatch(scoped.text, /textbox "Name"/u);
  const shallow = await call({ action: "snapshot", depth: 1 });
  assert.match(shallow.text, /\[deeper content omitted by depth\]/u);
  assert.match(shallow.text, /Deeper content was left out by depth/u);

  // A password field's value is never read back into the transcript.
  await call({ action: "open", url: `${origin}/secret` });
  const password = refIn((await call({ action: "snapshot" })).text, /textbox "Password" \[ref=(e\d+)\]/u);
  await assert.rejects(call({ action: "get", what: "value", ref: password }), /Refusing to read the value of e\d+ \(textbox "Password"\): it is a password field/u);

  // wait state follows an element appearing or disappearing.
  await call({ action: "navigate", url: `${origin}/toggle` });
  assert.match((await call({ action: "act", kind: "wait", selector: "#banner", state: "visible" })).text, /condition was met/u);
  await call({ action: "act", kind: "click", ref: refIn((await call({ action: "snapshot" })).text, /button "Hide" \[ref=(e\d+)\]/u) });
  assert.match((await call({ action: "act", kind: "wait", selector: "#banner", state: "hidden" })).text, /condition was met/u);
});

test("a replaced element keeps its ref when its role and name are unique", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-relink-"));
  const server = createServer((request, response) => {
    const page = PAGES[request.url ?? ""];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };

  const opened = await call({ action: "open", url: `${origin}/replace` });
  const target = refIn(opened.text, /button "Target" \[ref=(e\d+)\]/u);
  const swap = refIn(opened.text, /button "Swap" \[ref=(e\d+)\]/u);
  await call({ action: "act", kind: "click", ref: swap });
  const clicked = await call({ action: "act", kind: "click", ref: target });
  assert.match(clicked.text, /^Clicked e\d+ \(button "Target"\)\./u);
  assert.match(clicked.text, /re-bound to the one element with the same role and name/u);
  assert.match(pageText((await call({ action: "text", selector: "#out" })).text), /new target clicked/u);

  // Two elements with that role and name make the old ref ambiguous instead of a wrong click.
  const twins = await call({ action: "open", url: `${origin}/twins` });
  const twinTarget = refIn(twins.text, /button "Target" \[ref=(e\d+)\]/u);
  const twinSwap = refIn(twins.text, /button "Swap" \[ref=(e\d+)\]/u);
  await call({ action: "act", kind: "click", ref: twinSwap });
  await assert.rejects(call({ action: "act", kind: "click", ref: twinTarget }), /share its role and name, so the ref is ambiguous\. Take a new snapshot/u);
});

test("a form inside a frame is in the snapshot and works through its refs", {
  skip: !detected.executable,
  timeout: 120_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-frames-"));
  const inner = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Cross frame</title><label for="pw">Password</label><input id="pw" type="password"><button onclick="document.getElementById('out').textContent = 'cross clicked'">Cross button</button><p id="out">idle</p>`);
  }).listen(0, "127.0.0.1");
  await once(inner, "listening");
  const innerAddress = inner.address();
  assert.ok(innerAddress && typeof innerAddress !== "string");
  const crossOrigin = `http://127.0.0.1:${innerAddress.port}`;
  const sameFrame = `<!doctype html><title>Same frame</title><button onclick="document.getElementById('out').textContent = 'inner clicked'">Inner button</button><p id="out">idle</p>`;
  const host = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(request.url === "/same"
      ? sameFrame
      : `<!doctype html><title>Host</title><h1>Host</h1>
        <iframe src="/same" title="Same frame"></iframe>
        <iframe src="${crossOrigin}/cross" title="Cross frame"></iframe>`);
  }).listen(0, "127.0.0.1");
  await once(host, "listening");
  const hostAddress = host.address();
  assert.ok(hostAddress && typeof hostAddress !== "string");
  const hostOrigin = `http://127.0.0.1:${hostAddress.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const stored = new Map<string, { name: string; origin: string; value: string; createdAt: string }>();
  const secrets = {
    find: async (name: string) => stored.get(name),
    list: async () => [...stored.values()].map(({ name, origin, createdAt }) => ({ name, origin, createdAt })),
  };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings, secrets });
  t.onTestFinished(async () => {
    await browser.stop();
    host.close();
    inner.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });
  const refIn = (text: string, pattern: RegExp) => {
    const ref = pattern.exec(text)?.[1];
    assert.ok(ref, `missing ${pattern} in:\n${text}`);
    return ref;
  };
  const pageAt = (text: string, url: string) => text.includes(url);

  const opened = await call({ action: "open", url: `${hostOrigin}/` });
  // Both frames are inlined, one of them from another origin.
  assert.match(opened.text, /Iframe "Same frame"/u);
  assert.match(opened.text, /Iframe "Cross frame"/u);
  assert.match(opened.text, /button "Inner button" \[ref=(e\d+)\]/u);
  assert.match(opened.text, /textbox "Password" \[ref=(e\d+)\]/u);
  const innerButton = refIn(opened.text, /button "Inner button" \[ref=(e\d+)\]/u);
  const password = refIn(opened.text, /textbox "Password" \[ref=(e\d+)\]/u);

  // A click inside a same-origin frame lands on the frame's own button.
  const clicked = await call({ action: "act", kind: "click", ref: innerButton });
  assert.match(clicked.text, /Clicked e\d+ \(button "Inner button"\)/u);
  assert.match((await call({ action: "snapshot" })).text, /inner clicked/u);

  // The secret's origin is the frame's, not the host page's; the field is typed into in place.
  stored.set("cross", { name: "cross", origin: hostOrigin, value: "frame-secret", createdAt: "2026-11-09T00:00:00.000Z" });
  const refused = await call({ action: "secret", name: "cross", ref: password }).then(() => undefined, (error: unknown) => error);
  assert.ok(refused instanceof BrowserToolError);
  assert.match(refused.message, new RegExp(`belongs to ${hostOrigin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}, and e\\d+ \\(textbox "Password"\\) is on ${crossOrigin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  stored.set("cross", { name: "cross", origin: crossOrigin, value: "frame-secret", createdAt: "2026-11-09T00:00:00.000Z" });
  const typed = await call({ action: "secret", name: "cross", ref: password });
  assert.match(typed.text, new RegExp(`on ${crossOrigin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  assert.doesNotMatch(typed.text, /frame-secret/u);
  assert.equal(pageAt(typed.text, crossOrigin), true);

  // A click inside the cross-origin frame is shifted onto the page and lands on its button.
  const crossButton = refIn((await call({ action: "snapshot" })).text, /button "Cross button" \[ref=(e\d+)\]/u);
  const crossClicked = await call({ action: "act", kind: "click", ref: crossButton });
  assert.match(crossClicked.text, /Clicked e\d+ \(button "Cross button"\)/u);
  assert.match((await call({ action: "snapshot" })).text, /cross clicked/u);
});

test("network captures a tab's requests and writes a HAR with credentials redacted", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-network-"));
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === "/api") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ ok: true }));
    }
    if (path === "/page") {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end(`<!doctype html><title>Network page</title><h1>Network page</h1>
        <script>
          fetch("/api?token=page-secret", { headers: { authorization: "Bearer api-secret" } });
          fetch("/missing");
        </script>`);
    }
    response.writeHead(404, { "content-type": "text/html" });
    response.end("missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  await call({ action: "open", url: `${origin}/page` });
  assert.match((await call({ action: "network", operation: "start" })).text, /Capturing requests in tab t1/u);
  await call({ action: "reload" });
  const listed = await eventually(() => call({ action: "network", operation: "requests" }), (result) => /\/api/u.test(result.text) && /\/missing/u.test(result.text));
  assert.match(listed.text, /n\d+ · GET 200 OK · Fetch · \d+ ms/u);
  assert.match(listed.text, /GET 404 Not Found/u);
  assert.match(listed.text, /\/api\?token=%5Bredacted%5D/u);
  assert.doesNotMatch(listed.text, /api-secret|page-secret/u);

  // Filters narrow the list; a request detail carries redacted headers.
  assert.match((await call({ action: "network", operation: "requests", status: "404" })).text, /\/missing/u);
  assert.doesNotMatch((await call({ action: "network", operation: "requests", status: "404" })).text, /\/api/u);
  assert.match((await call({ action: "network", operation: "requests", filter: "api", type: "fetch" })).text, /n\d+ · GET 200 OK · Fetch/u);
  const id = /n\d+/u.exec((await call({ action: "network", operation: "requests", filter: "api" })).text)?.[0];
  assert.ok(id);
  const detail = await call({ action: "network", operation: "request", id });
  assert.match(detail.text, /authorization: \[redacted\]/u);
  assert.match(detail.text, /content-type: application\/json/u);
  await assert.rejects(call({ action: "network", operation: "request", id: "n9999" }), /No captured request n9999/u);

  // The HAR keeps the shape and drops the secret values.
  const written = await call({ action: "network", operation: "har", path: "artifacts/network.har" });
  assert.match(written.text, /Wrote \d+ requests to .*artifacts\/network\.har/u);
  const har = JSON.parse(await readFile(join(dir, "artifacts", "network.har"), "utf8")) as { log: { version: string; entries: Array<{ request: { headers: Array<{ name: string; value: string }>; url: string }; response: { status: number } }> } };
  assert.equal(har.log.version, "1.2");
  assert.ok(har.log.entries.length >= 3);
  assert.equal(JSON.stringify(har).includes("api-secret"), false);
  assert.equal(JSON.stringify(har).includes("page-secret"), false);
  assert.ok(har.log.entries.some((entry) => entry.request.headers.some((header) => header.name === "authorization" && header.value === "[redacted]")));

  await call({ action: "network", operation: "stop" });
  await call({ action: "network", operation: "clear" });
  assert.match((await call({ action: "network", operation: "requests" })).text, /No request matches/u);
  await assert.rejects(call({ action: "network", operation: "har", path: "notes.txt" }), /path must end in \.har/u);
});

test("a snapshot diff reports only what an action changed, with usable refs", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-diff-"));
  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] !== "/diff") {
      response.writeHead(404, { "content-type": "text/plain" });
      return response.end("missing");
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Diff page</title><h1>Diff page</h1>
      <p id="status">2 items</p>
      <button id="add">Add item</button>
      <button id="confirm" hidden>Confirm</button>
      <script>
        document.getElementById("add").onclick = () => {
          document.getElementById("status").textContent = "3 items";
          document.getElementById("confirm").hidden = false;
        };
        document.getElementById("confirm").onclick = () => {
          document.getElementById("status").textContent = "confirmed";
        };
      </script>`);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  // A tab with no snapshot yet has no baseline to compare against.
  const opened = await call({ action: "open", url: `${origin}/diff` });
  assert.match(opened.text, /Diff page/u);
  const first = await call({ action: "snapshot", diff: true });
  assert.match(first.text, /No previous snapshot in this tab, so this one is the baseline\./u);
  assert.match(first.text, /- button "Add item" \[ref=e\d+\]/u);

  const unchanged = await call({ action: "snapshot", diff: true });
  assert.match(unchanged.text, /Nothing changed in the page since the previous snapshot\./u);
  assert.match(unchanged.text, /\(No lines changed\.\)/u);

  // An action changes one line and reveals a button; only those are reported.
  const addRef = /button "Add item" \[ref=(e\d+)\]/u.exec(opened.text)?.[1];
  assert.ok(addRef);
  await call({ action: "act", ref: addRef, kind: "click" });
  const changed = await call({ action: "snapshot", diff: true });
  assert.match(changed.text, /Page changed since the previous snapshot: 3 lines added, 2 removed\./u);
  assert.match(changed.text, /- - paragraph: 2 items/u);
  assert.match(changed.text, /\+ - paragraph: 3 items/u);
  assert.doesNotMatch(changed.text, /\+ - heading "Diff page"/u);
  const confirmRef = /\+ - button "Confirm" \[ref=(e\d+)\]/u.exec(changed.text)?.[1];
  assert.ok(confirmRef, changed.text);

  // The ref a diff line carries acts, so the loop can continue from a diff.
  await call({ action: "act", ref: confirmRef, kind: "click" });
  const confirmed = await call({ action: "snapshot", diff: true });
  assert.match(confirmed.text, /\+ - paragraph: confirmed/u);
  assert.match(confirmed.text, /- - paragraph: 3 items/u);

  // Filtered snapshots are not comparable with a whole one.
  await assert.rejects(
    call({ action: "snapshot", diff: true, query: "button" }),
    /snapshot diff compares whole snapshots; drop query, selector, interactive and depth\./u,
  );

  // A new document makes the previous lines a poor comparison; say so.
  await call({ action: "reload" });
  const navigated = await call({ action: "snapshot", diff: true });
  assert.match(navigated.text, /The page navigated since the previous snapshot, so this one is the new baseline\./u);
  assert.match(navigated.text, /- heading "Diff page" \[level=1\]/u);
});

test("act upload puts local files into a page's file input, visible or hidden", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-upload-"));
  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] !== "/upload") {
      response.writeHead(404, { "content-type": "text/plain" });
      return response.end("missing");
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Upload page</title><h1>Upload page</h1>
      <input id="one" type="file" aria-label="One file">
      <input id="many" type="file" multiple aria-label="Many files">
      <input id="hidden" type="file" hidden>
      <p id="picked">nothing picked</p>
      <script>
        const picked = document.getElementById("picked");
        for (const id of ["one", "many", "hidden"]) {
          document.getElementById(id).addEventListener("change", (event) => {
            picked.textContent = id + ": " + [...event.target.files].map((file) => file.name).join(", ");
          });
        }
      </script>`);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await writeFile(join(dir, "notes.txt"), "first note\n");
  await writeFile(join(dir, "second.md"), "# second\n");
  await mkdir(join(dir, "folder"), { recursive: true });
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  const opened = await call({ action: "open", url: `http://127.0.0.1:${address.port}/upload` });
  const ref = (name: string) => new RegExp(`button "${name}" \\[ref=(e\\d+)\\]`, "u").exec(opened.text)?.[1];
  const one = ref("One file");
  const many = ref("Many files");
  assert.ok(one && many, opened.text);

  // One file into a single-file input: the page's own change handler runs.
  const single = await call({ action: "act", kind: "upload", ref: one, files: ["notes.txt"] });
  assert.match(single.text, /Uploaded notes\.txt to e\d+ \(button "One file"\) \(1 file\)\./u);
  assert.match((await call({ action: "get", what: "text", selector: "#picked" })).text, /one: notes\.txt/u);

  // Several files need a multiple input.
  await assert.rejects(
    call({ action: "act", kind: "upload", ref: one, files: ["notes.txt", "second.md"] }),
    /button "One file"\) accepts one file, but 2 were given\./u,
  );
  const multiple = await call({ action: "act", kind: "upload", ref: many, files: ["notes.txt", "second.md"] });
  assert.match(multiple.text, /Uploaded notes\.txt, second\.md to e\d+ \(button "Many files"\) \(2 files\)\./u);
  assert.match((await call({ action: "get", what: "text", selector: "#picked" })).text, /many: notes\.txt, second\.md/u);

  // A hidden input is reachable by selector, which is how pages style their pickers.
  const hidden = await call({ action: "act", kind: "upload", selector: "#hidden", files: [join(dir, "second.md")] });
  assert.match(hidden.text, /Uploaded second\.md to #hidden \(1 file\)\./u);
  assert.match((await call({ action: "get", what: "text", selector: "#picked" })).text, /hidden: second\.md/u);

  // Refusals name the reason instead of letting the browser fail obscurely.
  await assert.rejects(call({ action: "act", kind: "upload", ref: many, files: ["missing.txt"] }), /.*missing\.txt is not a file that can be uploaded\./u);
  await assert.rejects(call({ action: "act", kind: "upload", ref: many, files: ["folder"] }), /.*folder is not a file that can be uploaded\./u);
  await assert.rejects(call({ action: "act", kind: "upload", ref: many, files: [] }), /files must list 1 to 10 file paths\./u);
  await assert.rejects(call({ action: "act", kind: "upload", files: ["notes.txt"] }), /upload needs ref to the file input, or selector when the page hides it\./u);
  await assert.rejects(
    call({ action: "act", kind: "upload", selector: "#picked", files: ["notes.txt"] }),
    /#picked is not a file input\./u,
  );
});

test("performance reports the renderer's counters and the document's own timings", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-performance-"));
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === "/slow.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      return response.end("window.slowLoaded = true;");
    }
    if (path !== "/perf") {
      response.writeHead(404, { "content-type": "text/plain" });
      return response.end("missing");
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Performance page</title><h1>Performance page</h1>
      <div id="rows"></div>
      <script>
        const rows = document.getElementById("rows");
        for (let index = 0; index < 300; index += 1) {
          const row = document.createElement("div");
          row.textContent = "row " + index;
          rows.append(row);
        }
        const script = document.createElement("script");
        script.src = "/slow.js";
        document.head.append(script);
      </script>`);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  await call({ action: "open", url: `http://127.0.0.1:${address.port}/perf` });

  const metrics = await call({ action: "performance", operation: "metrics" });
  assert.match(metrics.text, /nodes (\d+)/u);
  const nodes = Number(/nodes (\d+)/u.exec(metrics.text)?.[1]);
  assert.ok(nodes >= 300, metrics.text);
  assert.match(metrics.text, /heap [\d.]+ (B|KB|MB)/u);
  assert.match(metrics.text, /layouts \d+ \(/u);
  assert.match(metrics.text, /script \d+( ms|\.\d s)? of /u);
  assert.match(metrics.text, /Counters accumulate from this tab's first performance call\./u);

  const timings = await call({ action: "performance", operation: "timings" });
  assert.match(timings.text, /Load: first byte \d+ ms, DOMContentLoaded \d+ ms, load \d+ ms · document \d+ (B|KB|MB)/u);
  // Headless Chrome reports no paint entries until it composites; both answers are valid.
  assert.match(timings.text, /Paints: (first-paint \d+(\.\d)? (ms|s)|none reported yet\.)/u);
  assert.match(timings.text, /Resources: \d+ requests?, [\d.]+ (B|KB|MB) transferred\./u);

  await assert.rejects(call({ action: "performance", operation: "vitals" }), /performance needs operation: metrics or timings\./u);
  // The counters survive a second call and only grow.
  const again = await call({ action: "performance" });
  assert.match(again.text, /nodes (\d+)/u);
  assert.ok(Number(/nodes (\d+)/u.exec(again.text)?.[1]) >= nodes);
});

test("storage lists cookie and storage names, flags and sizes but never values", {
  skip: !detected.executable,
  timeout: 90_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-browser-storage-"));
  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] !== "/store") {
      response.writeHead(404, { "content-type": "text/plain" });
      return response.end("missing");
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Storage page</title><h1>Storage page</h1>
      <script>
        document.cookie = "sid=cookie-secret-value; path=/";
        document.cookie = "theme=light; path=/";
        localStorage.setItem("draft", "draft-secret-value");
        localStorage.setItem("seen", "1");
        sessionStorage.setItem("tab-token", "tab-secret-value");
      </script>`);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "", mirrorState: false, allowedOrigins: [] };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.onTestFinished(async () => {
    await browser.stop();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (params: Record<string, unknown>) => browser.tool("alpha", params, { cwd: dir });

  await call({ action: "open", url: `http://127.0.0.1:${address.port}/store` });

  const cookies = await call({ action: "storage", what: "cookies" });
  assert.match(cookies.text, /2 cookies for 127\.0\.0\.1:\d+, values hidden:/u);
  assert.match(cookies.text, /^ {2}sid · session · \d+ B$/mu);
  assert.match(cookies.text, /^ {2}theme · session · \d+ B$/mu);
  assert.match(cookies.text, /Values are never read:/u);
  assert.doesNotMatch(cookies.text, /cookie-secret-value|light/u);

  const local = await call({ action: "storage", what: "local" });
  assert.match(local.text, /2 localStorage keys on http:\/\/127\.0\.0\.1:\d+ \(\d+ B\), values hidden:/u);
  assert.match(local.text, /^ {2}draft · \d+ B$/mu);
  assert.match(local.text, /^ {2}seen · \d+ B$/mu);
  assert.doesNotMatch(local.text, /draft-secret-value/u);

  const session = await call({ action: "storage", what: "session" });
  assert.match(session.text, /1 sessionStorage key on http:\/\/127\.0\.0\.1:\d+ \(\d+ B\), values hidden:/u);
  assert.match(session.text, /^ {2}tab-token · \d+ B$/mu);
  assert.doesNotMatch(session.text, /tab-secret-value/u);

  // Filters narrow by name; an empty result is explained, not mistaken for an error.
  assert.match((await call({ action: "storage", what: "cookies", filter: "THE" })).text, /^ {2}theme/mu);
  assert.doesNotMatch((await call({ action: "storage", what: "cookies", filter: "THE" })).text, /sid/u);
  assert.match((await call({ action: "storage", what: "local", filter: "draft" })).text, /Filtered to "draft" from 2\./u);
  assert.match((await call({ action: "storage", what: "local", filter: "nothing" })).text, /localStorage is empty on/u);
  await assert.rejects(call({ action: "storage", what: "indexed" }), /storage needs what: cookies, local or session\./u);
});
