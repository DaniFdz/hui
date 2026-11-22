/**
 * Refuses a unit or integration test that waits out the wall clock: a promise a timer resolves, a `sleep`-style helper
 * call (bare, through `node:timers/promises`, aliased, or reached through a member), or a binding aliased from a timer.
 * A test synchronizes on the state the behaviour produces, so a duration is either a poll that re-checks a condition
 * each turn (inside a loop) or, only to assert that something never happens, the file's own `quietWindow`.
 * The rule is structural, read from the ESTree, so a comment, string or regex literal can never satisfy or trip it.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { test } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
/** e2e/ has its own stricter ban in scripts/use-cases.test.ts. */
const ROOTS = ["bin", "cli", "desktop", "evals", "mobile/connect", "scripts", "server", "src"];
const TEST = /\.test\.(?:ts|mjs)$/u;
/** A helper whose whole job is to hand back the clock, bare or as a member's property. */
const WAIT_HELPERS = new Set(["sleep", "delay", "waitForTimeout", "pause"]);
/** Node's promise timers: importing one of these under any name makes the local binding a wait helper too. */
const PROMISE_TIMERS = new Set(["setTimeout", "setInterval"]);
const PROMISE_TIMERS_MODULE = "node:timers/promises";
const TIMERS = new Set(["setTimeout", "setInterval"]);
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
/** A file keeps one helper named `quietWindow` and may call it any number of times: every call waits only to assert
 * that something does NOT happen, which the comment above each call names. Its body holds the one driven timer. */
const QUIET = "quietWindow";
const FIX =
  "await the promise or event the code under test produces, predicate on it with vi.waitFor, drive its own timer with vi.useFakeTimers() and advanceTimersByTime, or — only to assert that something never happens — keep the window inside the file's own quietWindow";

async function tests(directory) {
  const found = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...await tests(path));
    } else if (TEST.test(entry.name)) found.push(path);
  }
  return found;
}

function walk(node, visit) {
  if (Array.isArray(node)) for (const child of node) walk(child, visit);
  else if (typeof node?.type === "string") {
    visit(node);
    for (const value of Object.values(node)) if (value && typeof value === "object") walk(value, visit);
  }
}

const named = (node, name) => node?.type === "Identifier" && node.name === name;
const identifier = (node) => (node?.type === "Identifier" ? node.name : undefined);
const isFunction = (node) => /^(?:Arrow)?FunctionExpression$|^FunctionDeclaration$/u.test(node?.type ?? "");
/** A function declared or assigned as `quietWindow`, whatever its signature. */
const isQuietFunction = (node) => isFunction(node) && named(node.id, QUIET);

/** The names a binding target gives, so `quietWindow: () => {}` and `x.quietWindow = () => {}` both count. */
const boundName = (node) => identifier(node) ?? (node?.type === "MemberExpression" ? propertyName(node.property) : undefined);

/** A property's name, written `sleep` or `"sleep"`. */
function propertyName(node) {
  return identifier(node) ?? (node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined);
}

/** The `resolve` a Promise executor is handed, if it names one. */
const resolveOf = (executor) => identifier(executor.params?.[0]);

/** Whether `body` calls `name` anywhere, which is `setTimeout(() => resolve(value), n)`. */
function callsName(body, name) {
  let called = false;
  walk(body, (node) => {
    if (node.type === "CallExpression" && named(node.callee, name)) called = true;
  });
  return called;
}

/**
 * The timer call a Promise executor hands its own `resolve`, at any nesting inside the executor, or undefined when the
 * executor resolves some other way (an event, a rejection guard, a stimulus handed to production code).
 */
function timerResolving(executor, timers) {
  const resolve = resolveOf(executor);
  if (!resolve) return undefined;
  let timer;
  walk(executor.body, (node) => {
    if (timer || node.type !== "CallExpression" || !timers.has(identifier(node.callee))) return;
    const [callback] = node.arguments;
    if (named(callback, resolve) || (isFunction(callback) && callsName(callback.body, resolve))) timer = node;
  });
  return timer;
}

/** What a call waits on, or undefined when it is not a wait: `sleep(50)`, a promise timer under its imported name, a
 * `scheduler.wait(50)`, and the same waits reached through a member, as `helpers.sleep(50)`. */
function waitShape(call, waits, schedulers) {
  const { callee } = call;
  if (callee.type === "Identifier") return waits.has(callee.name) ? "a sleep-style helper" : undefined;
  if (callee.type !== "MemberExpression") return undefined;
  const name = propertyName(callee.property);
  if (WAIT_HELPERS.has(name)) return "a sleep-style helper";
  return name === "wait" && schedulers.has(identifier(callee.object)) ? "a sleep-style helper" : undefined;
}

/** Every problem `code` holds, as `{ line, shape }`, honouring the loop poll and the file's quietWindow. */
function problemsIn(code) {
  const ast = parseAst(code, { lang: "ts" });
  const quiet = new Set();
  /** The local names that hand back the clock: a promise timer's binding, an alias, and the member it is reached by. */
  const waits = new Set(WAIT_HELPERS);
  const timers = new Set(TIMERS);
  /** Local bindings of `node:timers/promises`' `scheduler`, whose `.wait()` is a wait like any sleep. */
  const schedulers = new Set();
  walk(ast, (node) => {
    if (isQuietFunction(node)) quiet.add(node.start);
    else if (node.type === "VariableDeclarator" && named(node.id, QUIET) && isFunction(node.init)) quiet.add(node.init.start);
    else if (node.type === "AssignmentExpression" && boundName(node.left) === QUIET && isFunction(node.right)) quiet.add(node.right.start);
    else if (node.type === "Property" && boundName(node.key) === QUIET && isFunction(node.value)) quiet.add(node.value.start);
    else if (node.type === "MethodDefinition" && boundName(node.key) === QUIET) quiet.add(node.value.start);
    else if (node.type === "ImportDeclaration" && node.source.value === PROMISE_TIMERS_MODULE) {
      for (const specifier of node.specifiers) {
        const imported = identifier(specifier.imported);
        if (PROMISE_TIMERS.has(imported)) waits.add(identifier(specifier.local));
        else if (imported === "scheduler") schedulers.add(identifier(specifier.local));
      }
    }
  });
  // One level of aliasing, so `const t = setTimeout` is the same wait as the timer it names.
  const aliases = [];
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || !identifier(node.id)) return;
    const from = identifier(node.init);
    if (from && timers.has(from)) aliases.push([node.id.name, timers]);
    else if (from && waits.has(from)) aliases.push([node.id.name, waits]);
  });
  for (const [name, into] of aliases) into.add(name);
  const lineOf = (offset) => code.slice(0, offset).split("\n").length;
  const problems = [];
  /** The one timer a quietWindow body may drive: a second timer inside it is a wait of its own. */
  let quietTimer = false;
  const visit = (node, looped, inQuiet) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, looped, inQuiet);
      return;
    }
    if (typeof node?.type !== "string") return;
    const record = (shape) => {
      if (looped) return;
      if (inQuiet && !quietTimer) quietTimer = true;
      else problems.push({ line: lineOf(node.start), shape });
    };
    const executor = node.type === "NewExpression" && named(node.callee, "Promise") ? node.arguments?.[0] : undefined;
    const shape = node.type === "CallExpression" ? waitShape(node, waits, schedulers) : undefined;
    if (executor && isFunction(executor) && timerResolving(executor, timers)) record("a promise the wall clock resolves");
    else if (shape) record(shape);
    const inner = inQuiet || quiet.has(node.start);
    const loops = looped || LOOPS.has(node.type);
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value, loops, inner);
  };
  visit(ast, false, false);
  return problems;
}

const files = (await Promise.all(ROOTS.map(tests))).flat().sort();

test("a unit test waits on the behaviour's state, not on the wall clock", async () => {
  const problems = (await Promise.all(files.map(async (file) => problemsIn(await readFile(join(root, file), "utf8"))
    .map(({ line, shape }) => `${file}:${line} waits out the wall clock (${shape}); ${FIX}`)))).flat();
  assert.deepEqual(problems, [], "await the state the code under test produces");
});

test.each([
  ["import { setTimeout as wait } from 'node:timers/promises'; await wait(50);", "a sleep-style helper"],
  ["import { setTimeout } from 'node:timers/promises'; await setTimeout(50);", "a sleep-style helper"],
  ["import { scheduler } from 'node:timers/promises'; await scheduler.wait(50);", "a sleep-style helper"],
  ["await helpers.sleep(50);", "a sleep-style helper"],
  ["await helpers['waitForTimeout'](50);", "a sleep-style helper"],
  ["const t = setTimeout; await new Promise((resolve) => t(resolve, 50));", "a promise the wall clock resolves"],
  ["const i = setInterval; await new Promise((resolve) => i(resolve, 50));", "a promise the wall clock resolves"],
  ["const quietWindow = (ms) => { new Promise((r) => setTimeout(r, ms)); return new Promise((r) => setTimeout(r, ms)); };", "a promise the wall clock resolves"],
  ["await new Promise((resolve) => setTimeout(resolve, 5));", "a promise the wall clock resolves"],
  ["const settle = () => new Promise((resolve) => setTimeout(resolve, 0));", "a promise the wall clock resolves"],
  ["await new Promise<void>((resolve) => setTimeout(() => resolve(value), 5));", "a promise the wall clock resolves"],
  ["await new Promise((resolve) => stream.on('end', () => setTimeout(resolve, 50)));", "a promise the wall clock resolves"],
  ["await new Promise((resolve, reject) => setInterval(resolve, 5));", "a promise the wall clock resolves"],
  ["await sleep(50);", "a sleep-style helper"],
  ["await delay(50);", "a sleep-style helper"],
  ["await waitForTimeout(10);", "a sleep-style helper"],
  ["await pause(200);", "a sleep-style helper"],
])("a wait handed straight to the clock is refused: %s", (code, shape) => {
  assert.deepEqual(problemsIn(code), [{ line: 1, shape }]);
});

test.each([
  "for (let i = 0; i < 20 && !done; i++) await new Promise((resolve) => setTimeout(resolve, 5));",
  "while (!done) await new Promise((resolve) => setTimeout(resolve, 5));",
  "do { await sleep(5); } while (!done);",
  "const quietWindow = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const quietWindow = async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); };",
  "import { setTimeout as wait } from 'node:timers/promises'; const quietWindow = (ms) => wait(ms); await quietWindow(50); await quietWindow(50);",
  "import { setTimeout as wait } from 'node:timers/promises'; for (let i = 0; i < 20 && !done; i++) await wait(10);",
  "for (let i = 0; i < 20 && !done; i++) await helpers.sleep(5);",
  "import { scheduler } from 'node:timers/promises'; await scheduler.yield();",
  "await helpers.flush(50);",
  "await new Promise((resolve, reject) => setTimeout(() => reject(new Error('deadline')), 50));",
  "await new Promise((resolve) => nextTick(resolve));",
  "await new Promise((resolve) => setTimeout(worker.tick, 5));",
  "await new Promise((resolve) => setTimeout(() => worker.tick(), 5));",
  "await new Promise((resolve) => setImmediate(resolve));",
  "await new Promise((resolve) => queueMicrotask(resolve));",
  "vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(50);",
  "await vi.waitFor(() => assert.equal(seen, 1));",
  "await clock.tick(50);",
  "// await sleep(50) in a comment is prose",
  'const prose = "await sleep(50) in a string is prose";',
  "const pattern = /sleep\\(/u;",
])("a wait that synchronizes on state still passes: %s", (code) => {
  assert.deepEqual(problemsIn(code), []);
});
