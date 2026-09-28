import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BrowserSettings } from "../../src/lib/settings.ts";
import { resolveBrowserExecutable } from "./executable.ts";
import { browserLaunchArguments, BrowserToolError, ManagedBrowser, normalizeBrowserUrl, type BrowserViewFrame } from "./manager.ts";
import type { BrowserViewAction, BrowserViewState } from "../../shared/browser.ts";

const noBrowser = { platform: "linux" as const, env: { PATH: "/nowhere" }, home: "/home/nobody", isExecutable: async () => false };

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
  let settings: BrowserSettings = { enabled: false, headless: true, executablePath: "" };
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
    <a href="/next">Next page</a>
    <p id="out"></p><p id="width"></p>
    <script>
      const width = () => { document.getElementById('width').textContent = 'width ' + innerWidth; };
      addEventListener('resize', width); width();
      setTimeout(() => { const late = document.createElement('p'); late.textContent = 'Late content'; document.body.append(late); }, 200);
    </script>`,
  "/next": "<!doctype html><title>Next</title><h1>Second page</h1><script>console.error('boom from next')</script>",
  "/popup": "<!doctype html><title>Popup</title><h1>Popup page</h1>",
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
  skip: detected.executable ? false : "no Chromium-family browser is installed",
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
  let settings: BrowserSettings = { enabled: true, headless: true, executablePath: "" };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.after(async () => {
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
  assert.match((await call("alpha", { action: "text", selector: "#out" })).text, /\n\nHello, HUI agent!$/u);
  assert.match((await call("alpha", { action: "console" })).text, /\[log\] greeted HUI agent/u);
  assert.match((await call("alpha", { action: "act", kind: "wait", text: "Late content", timeoutMs: 5_000 })).text, /condition was met/u);
  await assert.rejects(call("alpha", { action: "act", kind: "wait", text: "Never shown", timeoutMs: 1_000 }), /Timed out after 1000 ms/u);

  // Dialogs never block the page: alerts are accepted, confirms dismissed unless asked.
  const alert = await call("alpha", { action: "act", kind: "click", ref: refIn(opened.text, /button "Alert" \[ref=(e\d+)\]/u) });
  assert.deepEqual(alert.details["dialogs"], ["alert \"Saved\" accepted"]);
  const confirmRef = refIn(opened.text, /button "Confirm" \[ref=(e\d+)\]/u);
  await call("alpha", { action: "act", kind: "click", ref: confirmRef });
  assert.match((await call("alpha", { action: "text", selector: "#out" })).text, /cancelled$/u);
  await call("alpha", { action: "act", kind: "click", ref: confirmRef, dialog: "accept" });
  assert.match((await call("alpha", { action: "text", selector: "#out" })).text, /confirmed$/u);
  await call("alpha", { action: "act", kind: "select", ref: refIn(opened.text, /combobox "Color" \[ref=(e\d+)\]/u), values: ["Blue"] });
  assert.match((await call("alpha", { action: "text", selector: "#out" })).text, /color b$/u);

  const shot = await call("alpha", { action: "screenshot", path: "shots/form.png" });
  assert.equal(shot.image?.mimeType, "image/png");
  assert.equal(shot.details["width"], 1280);
  assert.equal(shot.details["height"], 800);
  assert.equal((await readFile(join(dir, "shots", "form.png"))).subarray(1, 4).toString(), "PNG");
  await assert.rejects(call("alpha", { action: "screenshot", path: "form.jpg" }), /must end in \.png/u);
  await call("alpha", { action: "resize", width: 390, height: 844 });
  assert.match((await call("alpha", { action: "text", selector: "#width" })).text, /width 390$/u);
  await call("alpha", { action: "resize" });
  assert.match((await call("alpha", { action: "text", selector: "#width" })).text, /width 1280$/u);

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

  // Removing a conversation closes its tabs; a new mode restarts the process.
  browser.closeOwner("alpha");
  assert.deepEqual((await browser.status()).tabs, []);
  settings = { ...settings, headless: false };
  await browser.applySettings(settings);
  assert.equal(browser.running, false);
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

test("the live view follows the agent's tab, streams frames only while watched and marks clicks", {
  skip: detected.executable ? false : "no Chromium-family browser is installed",
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
  const settings: BrowserSettings = { enabled: true, headless: true, executablePath: "" };
  const browser = new ManagedBrowser({ profileDir: join(dir, "profile"), readSettings: async () => settings });
  t.after(async () => {
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
  assert.deepEqual([...states], [{ running: false, tabs: [], current: null, watching: null, following: true }], "watching never launches the browser");
  assert.equal(browser.running, false);

  const opened = await call("alpha", { action: "open", url: `${origin}/form` });
  await until("the agent's tab to be watched", () => latest().watching === "t1");
  assert.deepEqual(latest(), {
    running: true, mode: "headless", tabs: [{ id: "t1", title: "Browser form", url: `${origin}/form` }],
    current: "t1", watching: "t1", following: true,
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
  assert.deepEqual(other.at(-1), { running: true, mode: "headless", tabs: [], current: null, watching: null, following: true });
  await browser.stop();
  await until("the stopped browser in the view", () => other.at(-1)?.running === false);
  second.close();
});
