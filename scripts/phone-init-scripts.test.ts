/** Proves recovered Android contexts install real init scripts once, even when the engine configures them again. */
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { test } from "vitest";
import { attachmentInitScripts, type InitScript } from "./phone-init-scripts.ts";

function attachment(replay: InitScript[]) {
  const installed: string[] = [];
  return {
    installed,
    addInitScript: attachmentInitScripts(async (script) => {
      assert.equal(typeof script, "string");
      installed.push(script as string);
    }, replay),
    navigate() {
      const document = { count: 0, order: [] as string[] };
      for (const script of installed) runInNewContext(script, document);
      return document;
    },
  };
}

const counter = "count += 1; order.push('counter');";
const afterCounter = "order.push('after:' + count);";

// AttemptSession.transition() calls configure after the replacement attachment has replayed and reloaded.
async function configure(context: ReturnType<typeof attachment>) {
  await context.addInitScript(counter);
  await context.addInitScript(afterCounter);
}

test("replacement replay followed by engine reconfiguration runs each script once on later navigation", async () => {
  const replay: InitScript[] = [];
  const original = attachment(replay);
  await configure(original);
  assert.equal(original.navigate().count, 1);

  const replacement = attachment(replay);
  for (const entry of [...replay]) await replacement.addInitScript(entry.script, entry.argument);
  assert.deepEqual(replacement.navigate(), { count: 1, order: ["counter", "after:1"] }); // recovery reload
  await configure(replacement);
  assert.deepEqual(replacement.navigate(), { count: 1, order: ["counter", "after:1"] }); // later navigation
  assert.equal(replacement.installed.length, 2);
  assert.equal(replay.length, 2);
});

test("identical sequential and concurrent registrations share one native installation", async () => {
  const replay: InitScript[] = [];
  const context = attachment(replay);
  await Promise.all([context.addInitScript(counter), context.addInitScript(counter)]);
  await context.addInitScript(counter);
  assert.equal(context.installed.length, 1);
  assert.equal(context.navigate().count, 1);
  assert.equal(replay.length, 1);
});

test("a slow first registration preserves native and replay ordering for distinct concurrent scripts", async () => {
  const replay: InitScript[] = [];
  const installed: unknown[] = [];
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const firstFinished = new Promise<void>((resolve) => { release = resolve; });
  const register = attachmentInitScripts(async (script) => {
    installed.push(script);
    if (script === counter) {
      started();
      await firstFinished;
    }
  }, replay);
  const first = register(counter);
  const second = register(afterCounter);
  await firstStarted;
  assert.deepEqual(installed, [counter]);
  assert.equal(replay.length, 0);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(installed, [counter, afterCounter]);
  assert.deepEqual(replay.map((entry) => entry.script), [counter, afterCounter]);
  const replacement = attachment(replay);
  for (const entry of [...replay]) await replacement.addInitScript(entry.script, entry.argument);
  assert.deepEqual(replacement.navigate(), { count: 1, order: ["counter", "after:1"] });
});

test("a rejected installation is not cached or treated as installed and a later registration retries", async () => {
  const replay: InitScript[] = [];
  const failure = new Error("native registration failed");
  let calls = 0;
  const register = attachmentInitScripts(async () => {
    if (++calls === 1) throw failure;
  }, replay);
  const failed = await Promise.allSettled([register(counter), register(counter)]);
  assert.ok(failed.every((result) => result.status === "rejected" && result.reason === failure));
  assert.equal(calls, 1);
  assert.deepEqual(replay, []);
  await register(counter);
  await register(counter);
  assert.equal(calls, 2);
  assert.deepEqual(replay, [{ script: counter, argument: undefined }]);
});

test("a failed replay remains retryable on the attachment without duplicating the attempt cache", async () => {
  const replay: InitScript[] = [{ script: counter, argument: undefined }];
  let calls = 0;
  const register = attachmentInitScripts(async () => {
    if (++calls === 1) throw new Error("replacement unavailable");
  }, replay);
  await assert.rejects(register(counter), /replacement unavailable/u);
  await register(counter);
  assert.equal(calls, 2);
  assert.equal(replay.length, 1);
});

test("registration identity includes the argument and a fresh attempt starts with an empty replay cache", async () => {
  const replay: InitScript[] = [];
  let calls = 0;
  const register = attachmentInitScripts(async () => { calls += 1; }, replay);
  await register(counter, 1);
  await register(counter, 2);
  await register(counter, 1);
  assert.equal(calls, 2);
  assert.equal(replay.length, 2);

  const nextAttempt: InitScript[] = [];
  const fresh = attachment(nextAttempt);
  assert.equal(fresh.navigate().count, 0);
  await fresh.addInitScript(counter);
  assert.equal(fresh.navigate().count, 1);
  assert.equal(nextAttempt.length, 1);
  assert.equal(replay.length, 2);
});
