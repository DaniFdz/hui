// TEMPORARY diagnostic, reverted before merge. Preloaded with --import into a
// node:test test process (NODE_TEST_CONTEXT=child-v8), it remembers where each
// handle that can keep the process alive was created, and on SIGUSR2 writes the
// ones still open and not unreferenced, with their creation stacks, beside the
// diagnostic reports, where watchdog.mjs prints them. A diagnostic report shows
// all of a process's JavaScript timers as one libuv timer; this tells them apart.
import { createHook } from "node:async_hooks";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const TRACKED = new Set([
  "Timeout", "TCPSERVERWRAP", "TCPWRAP", "PIPESERVERWRAP", "PIPEWRAP", "PROCESSWRAP", "FSEVENTWRAP",
  "STATWATCHER", "UDPWRAP", "TTYWRAP", "WORKER", "MESSAGEPORT", "TLSWRAP", "GETADDRINFOREQWRAP", "SIGNALWRAP",
]);

if (process.env.NODE_TEST_CONTEXT === "child-v8") {
  const live = new Map();
  createHook({
    init(asyncId, type, _trigger, resource) {
      if (!TRACKED.has(type)) return;
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 16;
      const stack = (new Error().stack ?? "").split("\n").slice(2).map((line) => line.trim());
      Error.stackTraceLimit = limit;
      live.set(asyncId, { type, stack, since: Date.now(), resource: new WeakRef(resource) });
    },
    destroy(asyncId) {
      live.delete(asyncId);
    },
  }).enable();
  process.on("SIGUSR2", () => {
    const held = [];
    for (const [asyncId, entry] of live) {
      const resource = entry.resource.deref();
      if (!resource) { live.delete(asyncId); continue; }
      const referenced = typeof resource.hasRef === "function" ? resource.hasRef() : undefined;
      if (referenced === false) continue;
      held.push({ type: entry.type, referenced: referenced ?? "unknown", ageMs: Date.now() - entry.since, stack: entry.stack });
    }
    const dir = /--report-directory=(\S+)/u.exec(process.env.NODE_OPTIONS ?? "")?.[1] ?? process.env.RUNNER_TEMP ?? "/tmp";
    writeFileSync(join(dir, `handles.${process.pid}.json`), JSON.stringify({ pid: process.pid, held }));
  });
}
