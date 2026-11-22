/**
 * Refuses a unit or integration test that waits out the wall clock: a promise a timer resolves, or a `sleep`-style
 * helper call. A test synchronizes on the state the behaviour produces, so a duration is either a poll that re-checks a
 * condition each turn (inside a loop) or, only to assert that something never happens, the file's own `quietWindow`.
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
const ROOTS = ["cli", "scripts", "server", "src"];
const TEST = /\.test\.ts$/u;
/** A helper whose whole job is to hand back the clock. */
const WAIT_HELPERS = new Set(["sleep", "delay", "waitForTimeout", "pause"]);
const TIMERS = new Set(["setTimeout", "setInterval"]);
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
/** The one wait a file may keep: it exists only to assert that something does NOT happen, and the name says so. */
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
const boundName = (node) => identifier(node) ?? (node?.type === "MemberExpression" ? identifier(node.property) : undefined);

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
function timerResolving(executor) {
  const resolve = resolveOf(executor);
  if (!resolve) return undefined;
  let timer;
  walk(executor.body, (node) => {
    if (timer || node.type !== "CallExpression" || !TIMERS.has(identifier(node.callee))) return;
    const [callback] = node.arguments;
    if (named(callback, resolve) || (isFunction(callback) && callsName(callback.body, resolve))) timer = node;
  });
  return timer;
}

/** Every problem `code` holds, as `{ line, shape }`, honouring the loop poll and the file's quietWindow. */
function problemsIn(code) {
  const ast = parseAst(code, { lang: "ts" });
  const quiet = new Set();
  walk(ast, (node) => {
    if (isQuietFunction(node)) quiet.add(node.start);
    else if (node.type === "VariableDeclarator" && named(node.id, QUIET) && isFunction(node.init)) quiet.add(node.init.start);
    else if (node.type === "AssignmentExpression" && boundName(node.left) === QUIET && isFunction(node.right)) quiet.add(node.right.start);
    else if (node.type === "Property" && boundName(node.key) === QUIET && isFunction(node.value)) quiet.add(node.value.start);
    else if (node.type === "MethodDefinition" && boundName(node.key) === QUIET) quiet.add(node.value.start);
  });
  const lineOf = (offset) => code.slice(0, offset).split("\n").length;
  const problems = [];
  let quietUsed = false;
  const visit = (node, looped, inQuiet) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, looped, inQuiet);
      return;
    }
    if (typeof node?.type !== "string") return;
    const record = (shape) => {
      if (looped) return;
      if (inQuiet && !quietUsed) quietUsed = true;
      else problems.push({ line: lineOf(node.start), shape });
    };
    const executor = node.type === "NewExpression" && named(node.callee, "Promise") ? node.arguments?.[0] : undefined;
    if (executor && isFunction(executor) && timerResolving(executor)) record("a promise the wall clock resolves");
    else if (node.type === "CallExpression" && node.callee.type === "Identifier" && WAIT_HELPERS.has(node.callee.name)) record("a sleep-style helper");
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
