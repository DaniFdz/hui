// TEMPORARY diagnostic, reverted before merge. Runs a command; every 20 s it
// lists the test processes that have run longer than that, and if the command
// is still running after the given seconds, it prints what every process under
// it is doing: thread states, open descriptors, the kernel stack, and from a
// Node.js diagnostic report (SIGUSR2 with --report-on-signal) the JavaScript
// stack and the active, referenced libuv handles. It prints selected fields and
// an allowlist of environment variables only, never a raw report or the whole
// environment (the repository is public), and it uploads nothing.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const [delayArg, separator, ...command] = process.argv.slice(2);
if (separator !== "--" || !command.length) throw new Error("usage: watchdog.mjs <seconds> -- <command...>");
const reportDir = /--report-directory=(\S+)/u.exec(process.env.NODE_OPTIONS ?? "")?.[1];
const TEST_FILE = /\.test\.(?:ts|mjs|js)$/u;
const ALLOWED_ENV = /^(?:HOME|XDG_[A-Z_]+|TMPDIR|RUNNER_TEMP|CI|GITHUB_ACTIONS|LANG|TZ|DISPLAY|CHROME[A-Z_]*)$/u;
const TICKS = 100;
const started = Date.now();
const log = (line) => console.log(`[watchdog ${Math.round((Date.now() - started) / 1000)} s] ${line}`);

const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
let diagnosis = Promise.resolve();
const sampler = setInterval(sample, 20_000);
const timer = setTimeout(() => {
  diagnosis = diagnose().catch((error) => log(`diagnosis failed: ${error?.stack ?? error}`));
}, Number(delayArg) * 1000);
child.on("exit", async (code, signal) => {
  clearInterval(sampler);
  clearTimeout(timer);
  await diagnosis;
  log(`${command.join(" ")} ended: ${signal ?? code}`);
  process.exit(code ?? 1);
});

function uptime() {
  return Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
}

function processes() {
  const table = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/u.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).split(" ");
      table.set(Number(name), {
        pid: Number(name),
        comm: stat.slice(stat.indexOf("(") + 1, close),
        state: fields[0],
        ppid: Number(fields[1]),
        cpu: (Number(fields[11]) + Number(fields[12])) / TICKS,
        threads: Number(fields[17]),
        start: Number(fields[19]) / TICKS,
        args: readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").filter(Boolean),
      });
    } catch { /* it ended meanwhile */ }
  }
  return table;
}

/** The process and everything under it. */
function descendants(table, root) {
  const found = table.has(root) ? [table.get(root)] : [];
  const queue = [root];
  while (queue.length) {
    const pid = queue.shift();
    for (const entry of table.values()) if (entry.ppid === pid) { found.push(entry); queue.push(entry.pid); }
  }
  return found;
}

function describeArgs(args) {
  const files = args.filter((arg) => TEST_FILE.test(arg));
  const shown = files.length > 2 ? [...args.filter((arg) => !TEST_FILE.test(arg)), `<${files.length} test files>`] : args;
  return shown.join(" ").slice(0, 500);
}

function isNode(entry) {
  return entry.comm === "node" || /(?:^|\/)node$/u.test(entry.args[0] ?? "");
}

function sample() {
  const now = uptime();
  const slow = descendants(processes(), child.pid)
    .filter((entry) => isNode(entry) && entry.args.some((arg) => TEST_FILE.test(arg)) && !entry.args.includes("--test") && now - entry.start > 20)
    .map((entry) => `${entry.args.find((arg) => TEST_FILE.test(arg))} (pid ${entry.pid}, ${Math.round(now - entry.start)} s, cpu ${entry.cpu.toFixed(1)} s)`);
  if (slow.length) log(`test files running over 20 s: ${slow.join(", ")}`);
}

function read(path) {
  try { return readFileSync(path, "utf8").trim(); } catch (error) { return `(${error.code})`; }
}

function sudoRead(path) {
  const result = spawnSync("sudo", ["-n", "cat", path], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : `(unreadable: ${(result.stderr || "").trim().slice(0, 120)})`;
}

function threads(pid) {
  try {
    return readdirSync(`/proc/${pid}/task`).map((tid) => {
      const stat = read(`/proc/${pid}/task/${tid}/stat`);
      const close = stat.lastIndexOf(")");
      return `${tid} ${stat.slice(stat.indexOf("(") + 1, close)} ${stat.slice(close + 2, close + 3)} wchan=${read(`/proc/${pid}/task/${tid}/wchan`)}`;
    });
  } catch (error) { return [`(${error.code})`]; }
}

function descriptors(pid) {
  try {
    const anon = {};
    const shown = [];
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      let target;
      try { target = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (target.startsWith("anon_inode:")) anon[target] = (anon[target] ?? 0) + 1;
      else shown.push(`${fd}=${target}`);
    }
    return [...shown, ...Object.entries(anon).map(([kind, count]) => `${kind}x${count}`)].join(" ");
  } catch (error) { return `(${error.code})`; }
}

function catchesSigusr2(pid) {
  const mask = /^SigCgt:\s*([0-9a-f]+)$/mu.exec(read(`/proc/${pid}/status`))?.[1];
  return mask !== undefined && (BigInt(`0x${mask}`) & (1n << 11n)) !== 0n;
}

function allowedEnv(entries) {
  return entries.filter(([key]) => ALLOWED_ENV.test(key)).map(([key, value]) => `${key}=${value}`).sort().join(" ");
}

function endpoint(value) {
  return value && typeof value === "object" ? `${value.ip4 ?? value.ip6 ?? value.host ?? "?"}:${value.port ?? "?"}` : String(value);
}

function describeHandle(handle) {
  const parts = [handle.type];
  for (const key of ["localEndpoint", "remoteEndpoint"]) if (handle[key] !== undefined) parts.push(`${key}=${endpoint(handle[key])}`);
  for (const key of ["pid", "filename", "path", "signum", "signal", "repeat", "firesInMsFromNow", "expired", "fd", "readable", "writable", "writeQueueSize"]) {
    if (handle[key] !== undefined) parts.push(`${key}=${handle[key]}`);
  }
  return parts.join(" ");
}

function printReport(report, indent = "  ") {
  const header = report.header ?? {};
  console.log(`${indent}node ${header.nodejsVersion ?? "?"}, pid ${header.processId ?? "?"}, thread ${header.threadId ?? 0}, cwd ${header.cwd ?? "?"}`);
  if (header.commandLine) console.log(`${indent}command: ${describeArgs(header.commandLine)}`);
  const js = report.javascriptStack ?? {};
  console.log(`${indent}JavaScript stack: ${js.message ?? ""}`);
  for (const frame of (js.stack ?? []).slice(0, 40)) console.log(`${indent}  ${frame}`);
  const handles = report.libuv ?? [];
  const live = handles.filter((handle) => handle.is_active && handle.is_referenced);
  console.log(`${indent}libuv: ${handles.length} handles, ${live.length} active and referenced`);
  for (const handle of live) console.log(`${indent}  ${describeHandle(handle)}`);
  const counts = {};
  for (const handle of handles) {
    const key = `${handle.type}${handle.is_active ? "" : "/inactive"}${handle.is_referenced ? "" : "/unref"}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log(`${indent}all handles: ${JSON.stringify(counts)}`);
  const native = (report.nativeStack ?? []).slice(0, 14).map((frame) => frame.symbol ?? frame.pc).join(" < ");
  if (native) console.log(`${indent}native stack: ${native}`);
  for (const worker of report.workers ?? []) {
    console.log(`${indent}worker thread:`);
    printReport(worker, `${indent}    `);
  }
}

async function reports(pids) {
  const found = new Map();
  for (const deadline = Date.now() + 15_000; Date.now() < deadline && found.size < pids.length;) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const name of reportDir && existsSync(reportDir) ? readdirSync(reportDir) : []) {
      // report.<date>.<time>.<pid>.<thread>.<sequence>.json
      const pid = Number(/^report\.\d+\.\d+\.(\d+)\.\d+\.\d+\.json$/u.exec(name)?.[1]);
      if (!pids.includes(pid) || found.has(pid)) continue;
      try { found.set(pid, JSON.parse(readFileSync(join(reportDir, name), "utf8"))); } catch { /* still being written */ }
    }
  }
  return found;
}

/** What handles.mjs wrote for a process: its open, referenced handles by creation stack. */
function printHandles(pid) {
  const path = reportDir ? join(reportDir, `handles.${pid}.json`) : undefined;
  if (!path || !existsSync(path)) return;
  const { held } = JSON.parse(readFileSync(path, "utf8"));
  const groups = new Map();
  for (const entry of held) {
    const frames = entry.stack.filter((frame) => !frame.includes("node:internal")).slice(0, 10);
    const key = `${entry.type} referenced=${entry.referenced}\n${frames.map((frame) => `      ${frame}`).join("\n")}`;
    const group = groups.get(key) ?? { count: 0, oldest: 0 };
    groups.set(key, { count: group.count + 1, oldest: Math.max(group.oldest, entry.ageMs) });
  }
  console.log(`  open handles by creation stack (handles.mjs): ${held.length}`);
  for (const [key, group] of groups) console.log(`    ${group.count}x, oldest ${Math.round(group.oldest / 1000)} s: ${key}`);
}

function nativeStacks(pid) {
  const result = spawnSync("sudo", ["-n", "gdb", "-p", String(pid), "-batch", "-ex", "thread apply all bt 25"], { encoding: "utf8", timeout: 60_000 });
  const lines = `${result.stdout ?? ""}`.split("\n").filter((line) => /^(?:Thread |#\d)/u.test(line));
  if (!lines.length) console.log(`    (gdb gave no stack: ${`${result.stderr ?? result.error ?? ""}`.trim().slice(0, 200)})`);
  for (const line of lines.slice(0, 160)) console.log(`    ${line.slice(0, 220)}`);
}

async function diagnose() {
  log(`${command.join(" ")} is still running: diagnosing`);
  console.log(`allowlisted environment: ${allowedEnv(Object.entries(process.env))}`);
  const now = uptime();
  const tree = descendants(processes(), child.pid);
  for (const entry of tree) {
    console.log(`--- pid ${entry.pid} (parent ${entry.ppid}) ${entry.comm} state ${entry.state}, ${Math.round(now - entry.start)} s old, cpu ${entry.cpu.toFixed(1)} s, ${entry.threads} threads`);
    console.log(`  command: ${describeArgs(entry.args)}`);
    console.log(`  descriptors: ${descriptors(entry.pid)}`);
    for (const line of threads(entry.pid)) console.log(`  thread ${line}`);
    console.log(`  kernel stack of the main thread:\n${sudoRead(`/proc/${entry.pid}/stack`).split("\n").map((line) => `    ${line}`).join("\n")}`);
    if (entry.args.some((arg) => TEST_FILE.test(arg)) && !entry.args.includes("--test")) {
      const environ = read(`/proc/${entry.pid}/environ`).split("\0").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]);
      console.log(`  its allowlisted environment: ${allowedEnv(environ)}`);
    }
  }
  // The node:test runner names every file; each test process names its own.
  const signalled = tree.filter((entry) => isNode(entry) && (entry.args.some((arg) => TEST_FILE.test(arg)) || !entry.args.some((arg) => /scripts\/test\.mjs$/u.test(arg))));
  const reportable = signalled.filter((entry) => catchesSigusr2(entry.pid));
  for (const entry of reportable) process.kill(entry.pid, "SIGUSR2");
  log(`asked ${reportable.length} node processes for a report: ${reportable.map((entry) => entry.pid).join(", ")}${signalled.length > reportable.length ? ` (not signalled, no SIGUSR2 handler: ${signalled.filter((entry) => !reportable.includes(entry)).map((entry) => entry.pid).join(", ")})` : ""}`);
  const found = await reports(reportable.map((entry) => entry.pid));
  for (const entry of reportable) {
    const report = found.get(entry.pid);
    console.log(`=== report of pid ${entry.pid}: ${describeArgs(entry.args)}`);
    if (report) printReport(report);
    else console.log("  no report within 15 s: its JavaScript thread is busy or blocked");
    printHandles(entry.pid);
  }
  for (const entry of signalled.filter((entry) => entry.args.some((arg) => TEST_FILE.test(arg)) && !entry.args.includes("--test"))) {
    console.log(`=== native stacks of pid ${entry.pid}`);
    nativeStacks(entry.pid);
  }
  log("diagnosis done");
}
