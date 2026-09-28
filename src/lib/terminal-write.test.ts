import assert from "node:assert/strict";
import test from "node:test";
import { writeTerminal, type TerminalWriter } from "./terminal-write.ts";

function recorder() {
  const writes: string[] = [];
  const terminal: TerminalWriter = { write(data, callback) { writes.push(data); callback?.(); } };
  return { terminal, writes };
}

test("terminal writes forward output and its completion callback", () => {
  const { terminal, writes } = recorder();
  let done = 0;
  writeTerminal(terminal, "$ ", () => done++);
  assert.deepEqual(writes, ["$ "]);
  assert.equal(done, 1);
});

test("an empty replay skips the terminal write but still completes", () => {
  const { terminal, writes } = recorder();
  let done = 0;
  writeTerminal(terminal, "", () => done++);
  writeTerminal(terminal, "");
  assert.deepEqual(writes, []);
  assert.equal(done, 1);
});

test("ghostty-web rejects the empty writes the guard skips", async () => {
  const { readFile } = await import("node:fs/promises");
  const dist = new URL("../../node_modules/ghostty-web/dist/", import.meta.url);
  const { Ghostty } = await import(new URL("ghostty-web.js", dist).href);
  const { instance } = await WebAssembly.instantiate(await readFile(new URL("ghostty-vt.wasm", dist)), { env: { log: () => {} } });
  const vt = new Ghostty(instance).createTerminal(80, 24);
  try {
    assert.throws(() => vt.write(""), RangeError);
    writeTerminal(vt, "");
    writeTerminal(vt, "ok");
  } finally { vt.free(); }
});
