#!/usr/bin/env node
/**
 * Usage-page benchmark. Drives a disposable visual-verification instance (its ready receipt) in a private headless
 * Chromium over the DevTools protocol and measures the real Usage screen: painted time from document start, and per
 * interaction the time from the input to the painted state, renderer main-thread busy/script time (DevTools Performance
 * domain), PerformanceObserver long tasks, animation-frame gaps, and the whole same-origin `/__hui/usage` transfers
 * (resource timing duration plus encoded and decoded body bytes). Controls are found by the labels the page renders; the
 * keyboard and mouse paths are real DevTools input events. Development tooling only.
 *
 *   node e2e/probes/usage-benchmark.mjs --receipt <receipt.json> [--browser <chromium>] [--out result.json]
 *     [--cpu 1|4] [--mobile] [--label name]
 *
 * Limitations, reported with the numbers: interaction time includes DevTools round trips and control scrolling;
 * renderer task/script ms cover the whole scenario window, including idle frame waits; a
 * resource entry's duration is the entire request and never parse time alone; sorting and the time zone use a scripted
 * `change` event on the native select, because a closed select has no reliable CDP path; chart focus is placed with
 * `.focus()` and then moved with real arrow keys. Show more runs only when the fixture has more sessions in range than
 * the first page; otherwise it is reported as skipped with the reason.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { doctor } from "../visual-verification.mjs";
const { values: args } = parseArgs({ options: {
  receipt: { type: "string" }, browser: { type: "string" }, out: { type: "string" },
  cpu: { type: "string", default: "1" }, mobile: { type: "boolean", default: false }, label: { type: "string", default: "" },
} });
if (!args.receipt) throw new Error("Usage: node e2e/probes/usage-benchmark.mjs --receipt <receipt.json> [--browser <path>] [--out result.json] [--cpu 1|4] [--mobile] [--label name]");
await doctor(args.receipt);
const receipt = JSON.parse(await readFile(args.receipt, "utf8"));
const cpu = Number(args.cpu);
if (![1, 4].includes(cpu)) throw new Error("--cpu must be 1 or 4.");
const browserPath = args.browser ?? ["/run/current-system/sw/bin/brave", "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => existsSync(path));
if (!browserPath) throw new Error("No Chromium-family browser found; pass --browser <path>.");
for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NODE_USE_ENV_PROXY"]) delete process.env[name];
const appUrl = receipt.url;
const viewport = args.mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };

const profile = await mkdtemp(join(tmpdir(), "hui-usage-bench-"));
const browser = spawn(browserPath, [
  "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "--window-size=" + viewport.width + "," + viewport.height, "about:blank",
], { stdio: "ignore", detached: true, env: { ...process.env, NO_PROXY: "127.0.0.1,localhost" } });
let devtools, socket, cdp;
async function cleanup() {
  try { if (browser.exitCode === null && browser.signalCode === null) process.kill(-browser.pid, "SIGTERM"); } catch {}
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch("http://127.0.0.1:" + devtools + "/json/version"); } catch { break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  socket?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
const watchdog = setTimeout(() => { void cleanup().finally(() => process.exit(1)); }, 5 * 60_000);
watchdog.unref();
try {
await new Promise((resolve, reject) => { browser.once("spawn", resolve); browser.once("error", reject); });

for (let attempt = 0; attempt < 100 && !devtools; attempt++) {
  try { devtools = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
}
if (!devtools) throw new Error("Browser did not report a DevTools port.");
const target = await (await fetch("http://127.0.0.1:" + devtools + "/json/new?about:blank", { method: "PUT" })).json();
socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const pageErrors = [];
let nextId = 1;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") pageErrors.push(message.params.args.map((argument) => argument.value ?? argument.description).join(" "));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
};
cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("DevTools " + method + " timed out")); }, 60_000);
  pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(fn, ...params) {
  const result = await cdp("Runtime.evaluate", { expression: "(" + fn + ")(..." + JSON.stringify(params) + ")", awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function click(expression) {
  const point = await evaluate((source) => {
    const element = (0, eval)(source);
    if (!element) return undefined;
    element.scrollIntoView({ block: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, String(expression));
  if (!point) throw new Error("No element for " + expression);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
}
const KEYS = { ArrowLeft: 37, ArrowRight: 39, End: 35 };
async function press(key) {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: KEYS[key] });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: KEYS[key] });
}
async function typeChar(char) {
  const code = "Key" + char.toUpperCase();
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: char, code, text: char, unmodifiedText: char, windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0) });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: char, code, windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0) });
}

const instrument = () => {
  const bench = window.__usageBench = { longTasks: [], errors: [] };
  performance.setResourceTimingBufferSize(500);
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) bench.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true });
  addEventListener("error", (event) => bench.errors.push(String(event.message)));
  addEventListener("unhandledrejection", (event) => bench.errors.push(String(event.reason)));
  bench.find = (label, within = "") => [...document.querySelectorAll(within + " button")].find((button) => button.textContent.trim() === label);
  bench.pressed = (group, label) => document.querySelector('[aria-label="' + group + '"] button[aria-pressed="true"]')?.textContent.trim() === label;
  bench.idle = () => document.querySelector('main[data-testid="usage-report"]')?.getAttribute("aria-busy") !== "true";
  bench.range = () => document.querySelector('[data-testid="usage-chart"] .settings-section__desc')?.textContent ?? "";
  bench.spanDays = () => { const match = /^(\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/u.exec(bench.range()); return match ? Math.round((Date.parse(match[2] + "T00:00:00Z") - Date.parse(match[1] + "T00:00:00Z")) / 864e5) + 1 : 0; };
  bench.rows = () => [...document.querySelectorAll('[data-testid="usage-sessions"] .session-bar-row')];
  bench.input = () => document.querySelector('input[aria-label="Filter sessions"]')?.value ?? "";
  bench.days = () => [...document.querySelectorAll(".usage-report__day")];
  bench.sortValue = () => document.querySelector(".sessions-sort select")?.value ?? "";
  bench.select = (label, value) => { const select = [...document.querySelectorAll("select")].find((element) => element.getAttribute("aria-label") === label || (element.closest("label")?.textContent ?? "").includes(label)); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); };
  bench.resources = () => performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === "/__hui/usage").length;
  bench.fetched = () => bench.resources() > (bench.sample?.mark ?? 0);
  bench.arm = () => {
    const sample = bench.sample = { start: performance.now(), gaps: [], last: performance.now(), running: true, mark: bench.resources() };
    const frame = (now) => { if (!sample.running) return; sample.gaps.push(now - sample.last); sample.last = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  };
  bench.arm();
};
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Performance.enable");
await cdp("Emulation.setDeviceMetricsOverride", viewport);
await cdp("Emulation.setCPUThrottlingRate", { rate: cpu });
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(" + instrument + ")()" });

async function mainThread() {
  const { metrics } = await cdp("Performance.getMetrics");
  const value = (name) => (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000;
  return { task: value("TaskDuration"), script: value("ScriptDuration"), layout: value("LayoutDuration"), style: value("RecalcStyleDuration"), nodes: metrics.find((metric) => metric.name === "Nodes")?.value ?? 0 };
}
const mainThreadSince = async (start) => {
  const end = await mainThread();
  return { mainThreadMs: Math.round(end.task - start.task), scriptMs: Math.round(end.script - start.script), layoutMs: Math.round(end.layout - start.layout), styleMs: Math.round(end.style - start.style), nodeCount: end.nodes };
};

async function settleOn(expression, timeout) {
  const bench = window.__usageBench;
  const check = (0, eval)("(() => (" + expression + "))");
  const deadline = performance.now() + timeout;
  for (;;) {
    if (check()) {
      await document.querySelector("hui-usage-page")?.updateComplete;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (check()) break;
    }
    if (performance.now() > deadline) throw new Error("Timed out waiting for " + expression);
    await new Promise((done) => requestAnimationFrame(done));
  }
  const sample = bench.sample;
  sample.running = false;
  const end = performance.now();
  const tasks = bench.longTasks.filter((task) => task.start >= sample.start && task.start <= end);
  const gaps = sample.gaps.slice(1);
  return {
    paintedMs: Math.round(end - sample.start), frames: gaps.length, slowFrames: gaps.filter((gap) => gap > 50).length,
    maxFrameGapMs: Math.round(Math.max(0, ...gaps)), longTasks: tasks.length,
    longTaskMs: Math.round(tasks.reduce((sum, task) => sum + task.duration, 0)), maxLongTaskMs: Math.round(Math.max(0, ...tasks.map((task) => task.duration))),
  };
}

const results = { label: args.label, checkout: receipt.checkout.head, dirty: receipt.checkout.dirty, fingerprint: receipt.checkout.fingerprint, cpu, mobile: args.mobile, startedAt: new Date().toISOString(), limitations: ["Interaction time includes DevTools round trips and scrolling, not hardware input latency.", "Task and script time cover the complete scenario window.", "Resource time is the whole request, not JSON parse time.", "Native selects use scripted change events and initial chart focus is scripted.", "CPU throttling is desktop emulation, not a real phone.", "DevTools node counts include detached nodes, unlike the light-DOM element and sidebar counts."], runs: {}, skipped: {} };
const record = (name, value) => { (results.runs[name] ??= []).push(value); };
async function measure(name, act, expression, timeout = 90_000) {
  const before = await mainThread();
  await evaluate(() => window.__usageBench.arm());
  await act();
  const sample = await evaluate(settleOn, expression, timeout);
  Object.assign(sample, await mainThreadSince(before));
  record(name, sample);
  console.error(name + ": " + JSON.stringify(sample));
  return sample;
}

await cdp("Page.navigate", { url: appUrl + "/usage" });
const startupDeadline = Date.now() + 120_000;
while (!await evaluate(() => Boolean(window.__usageBench)).catch(() => false)) {
  if (Date.now() >= startupDeadline) throw new Error("The Usage document did not load.");
  await new Promise((resolve) => setTimeout(resolve, 50));
}
results.startup = await evaluate(settleOn, "__usageBench.idle() && __usageBench.rows().length > 0", 120_000);
console.error("startup: " + JSON.stringify(results.startup));
results.environment = await evaluate(() => ({ userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], devicePixelRatio, range: __usageBench.range(), rows: __usageBench.rows().length, elements: document.querySelectorAll("*").length, recentSessions: document.querySelectorAll(".sidebar-recent-session").length }));

for (const [label, days] of [["90d", 90], ["All", 1], ["30d", 30]]) await measure("preset-" + label.toLowerCase(), () => click(`__usageBench.find("${label}", '[aria-label="Range presets"]')`), `__usageBench.idle() && __usageBench.fetched() && __usageBench.pressed("Range presets", "${label}") && __usageBench.spanDays() >= ${days}`);
for (const label of ["Cost", "Tokens", "Cost", "Tokens"]) await measure("metric-" + label.toLowerCase(), () => click(`__usageBench.find("${label}", '[aria-label="Chart metric"]')`), `__usageBench.idle() && __usageBench.pressed("Chart metric", "${label}")`);
await click(`document.querySelector('input[aria-label="Filter sessions"]')`);
const beforeSearch = await evaluate(() => __usageBench.rows().length);
const broadQuery = await evaluate(() => {
  const prefixes = new Map();
  for (const row of __usageBench.rows()) {
    const prefix = row.querySelector(".session-bar-title").textContent.trim().toLowerCase().slice(0, 3);
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  }
  return [...prefixes].sort((a, b) => b[1] - a[1])[0][0];
});
for (const [index, char] of [...broadQuery].entries()) {
  await measure("typing", () => typeChar(char), `__usageBench.input() === ${JSON.stringify(broadQuery.slice(0, index + 1))}`);
}
await measure("search-no-match", async () => { for (const char of "zzzz") await typeChar(char); }, `document.body.textContent.includes("No sessions match your search.")`);
await measure("search-clear", () => click(`__usageBench.find("Clear search")`), `__usageBench.input() === "" && __usageBench.rows().length === ${beforeSearch}`);
for (const value of ["tokens", "cost", "recent"]) {
  await measure("sort-" + value, () => evaluate((name) => __usageBench.select("Sort sessions", name), value), `__usageBench.sortValue() === "${value}" && __usageBench.rows().length > 0`);
}
const beforeMore = await evaluate(() => __usageBench.rows().length);
const totalBeforeMore = await evaluate(() => Number(document.querySelector('[data-testid="usage-sessions"] .usage-summary-sub')?.textContent.match(/· (\d+) in range/u)?.[1]));
if (await evaluate(() => __usageBench.find("Show more") !== undefined)) {
  await measure("show-more", () => click(`__usageBench.find("Show more")`), `__usageBench.rows().length === ${Math.min(beforeMore + 50, totalBeforeMore)}`);
} else results.skipped["show-more"] = "the fixture has " + beforeMore + " sessions in range, so the first page holds them all";
results.pagination = { before: beforeMore, after: await evaluate(() => __usageBench.rows().length) };
await evaluate(() => { __usageBench.days()[0]?.focus(); return true; });
await measure("chart-keys", async () => { for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "End"]) await press(key); }, `__usageBench.days().length > 2 && document.activeElement === __usageBench.days().at(-1)`);
await measure("rapid-range-zone", async () => {
  for (const label of ["7d", "90d", "All", "30d"]) await click(`__usageBench.find("${label}", '[aria-label="Range presets"]')`);
  await evaluate(() => __usageBench.select("Time zone", "utc"));
}, `__usageBench.idle() && __usageBench.fetched() && __usageBench.pressed("Range presets", "30d") && __usageBench.range().endsWith("UTC") && __usageBench.spanDays() === 30`);

const resources = await evaluate(() => performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === "/__hui/usage").map((entry) => ({ waitMs: Math.round(entry.responseStart - entry.requestStart), bodyMs: Math.round(entry.responseEnd - entry.responseStart), durationMs: Math.round(entry.duration), transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })));
const sum = (key) => resources.reduce((total, entry) => total + (entry[key] ?? 0), 0);
const durations = resources.map((entry) => entry.durationMs).sort((a, b) => a - b);
results.usageRequests = { count: resources.length, medianDurationMs: durations[Math.floor(durations.length / 2)] ?? 0, maxDurationMs: durations.at(-1) ?? 0, transferBytes: sum("transferBytes"), encodedBytes: sum("encodedBytes"), decodedBytes: sum("decodedBytes"), samples: resources };
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const aggregate = (pick) => Object.fromEntries(Object.entries(results.runs).map(([name, list]) => [name, Object.fromEntries(Object.keys(list[0]).map((key) => [key, pick(list.map((item) => item[key]))]))]));
results.median = aggregate(median); results.max = aggregate((values) => Math.max(...values));
const errors = [...new Set([...pageErrors, ...(await evaluate(() => __usageBench.errors))])];
results.errors = { count: errors.length, messages: errors.slice(0, 20) };
const output = JSON.stringify(results, null, 2) + "\n";
if (args.out) { await writeFile(args.out, output, { mode: 0o600 }); await chmod(args.out, 0o600); }
console.log(output);
if (errors.length) process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await cleanup();
}