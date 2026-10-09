import assert from "node:assert/strict";
import test from "node:test";
import { clearWrappedLine, ptyResize, skipHiddenFits, wrappedRowsAbove } from "./terminal-fit.ts";

const host = { clientWidth: 800, clientHeight: 600 };
const sent = { cols: 80, rows: 24 };

test("a changed, valid grid on a measurable host resizes the PTY", () => {
  assert.deepEqual(ptyResize(host, { cols: 100, rows: 30 }, sent), { cols: 100, rows: 30 });
  assert.deepEqual(ptyResize(host, { cols: 900, rows: 400 }, sent), { cols: 500, rows: 300 }, "clamped to the gateway's limits");
});

test("an unchanged grid, a hidden host or an unusable grid sends nothing", () => {
  assert.equal(ptyResize(host, { cols: 80, rows: 24 }, sent), undefined);
  assert.equal(ptyResize({ clientWidth: 0, clientHeight: 0 }, { cols: 100, rows: 30 }, sent), undefined);
  assert.equal(ptyResize({ clientWidth: 800, clientHeight: 0 }, { cols: 100, rows: 30 }, sent), undefined);
  assert.equal(ptyResize(null, { cols: 100, rows: 30 }, sent), undefined);
  assert.equal(ptyResize(host, { cols: 1, rows: 30 }, sent), undefined);
  assert.equal(ptyResize(host, { cols: 100, rows: 0 }, sent), undefined);
  assert.equal(ptyResize(host, { cols: Number.NaN, rows: 30 }, sent), undefined);
});

/** A stand-in with Gespenst's shape: its own ResizeObserver calls `this.resize()` and setFont calls `this.fit()`. */
class FakeTerminal {
  calls: string[] = [];
  resize(cols?: number, rows?: number) { this.calls.push(cols === undefined ? "fit-by-resize" : `resize ${cols}x${rows}`); }
  fit() { this.calls.push("fit"); }
  observe() { this.resize(); }
  setFont() { this.fit(); }
}

test("a hidden host never refits the grid, but explicit PTY sizes still apply", () => {
  const terminal = new FakeTerminal();
  let size = { clientWidth: 0, clientHeight: 0 };
  skipHiddenFits(terminal, () => size);
  terminal.observe();
  terminal.setFont();
  terminal.fit();
  terminal.resize(120, 40);
  assert.deepEqual(terminal.calls, ["resize 120x40"]);
  size = host;
  terminal.observe();
  terminal.setFont();
  assert.deepEqual(terminal.calls, ["resize 120x40", "fit-by-resize", "fit"]);
});

test("a prompt reflowed onto several rows is cleared from its first row before the shell redraws it", () => {
  const rows = [
    { index: 40, wrapContinuation: false }, // earlier output
    { index: 41, wrapContinuation: false }, // the prompt's first row
    { index: 42, wrapContinuation: true },
    { index: 43, wrapContinuation: true }, // the cursor's row
  ];
  assert.equal(wrappedRowsAbove(rows, 43), 2);
  assert.equal(wrappedRowsAbove(rows, 41), 0);
  assert.equal(wrappedRowsAbove(rows.slice(2), 43), 2, "a continuation row's predecessor belongs to the line even when it was not read");
  assert.equal(clearWrappedLine(2), "\r\u001b[2A\u001b[J");
  assert.equal(clearWrappedLine(0), "\r\u001b[J");
});
