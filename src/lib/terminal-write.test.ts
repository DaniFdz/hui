import assert from "node:assert/strict";
import test from "node:test";
import { writeTerminal, type TerminalWriter } from "./terminal-write.ts";

function recorder() {
  const writes: (string | Uint8Array)[] = [];
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
  writeTerminal(terminal, new Uint8Array(0), () => done++);
  assert.deepEqual(writes, []);
  assert.equal(done, 2);
});

test("socket output is written as bytes, unchanged", () => {
  const { terminal, writes } = recorder();
  const bytes = new TextEncoder().encode("\u001b[32mok");
  writeTerminal(terminal, bytes);
  assert.equal(writes[0], bytes);
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

test("ghostty-web decodes UTF-8 split across byte writes, so binary messages need no client decoder", async () => {
  const { readFile } = await import("node:fs/promises");
  const dist = new URL("../../node_modules/ghostty-web/dist/", import.meta.url);
  const { Ghostty } = await import(new URL("ghostty-web.js", dist).href);
  const { instance } = await WebAssembly.instantiate(await readFile(new URL("ghostty-vt.wasm", dist)), { env: { log: () => {} } });
  const vt = new Ghostty(instance).createTerminal(20, 4);
  try {
    for (const byte of new TextEncoder().encode("é雪😀x")) writeTerminal(vt, new Uint8Array([byte]));
    const cells = vt.getLine(0) as { codepoint: number }[];
    assert.deepEqual(cells.slice(0, 6).map((cell) => cell.codepoint), [0xe9, 0x96ea, 0, 0x1f600, 0, 0x78]);
  } finally { vt.free(); }
});
