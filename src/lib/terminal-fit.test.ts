import assert from "node:assert/strict";
import test from "node:test";
import { fittedTerminalSize } from "./terminal-fit.ts";

const host = { clientWidth: 800, clientHeight: 600 };
const current = { cols: 80, rows: 24 };

test("a changed, valid grid on a measurable host resizes", () => {
  assert.deepEqual(fittedTerminalSize(host, { cols: 100, rows: 30 }, current), { cols: 100, rows: 30 });
  assert.deepEqual(fittedTerminalSize(host, { cols: 900, rows: 400 }, current), { cols: 500, rows: 300 }, "clamped to the gateway's limits");
});

test("an unchanged grid, a hidden host or an unusable proposal sends nothing", () => {
  assert.equal(fittedTerminalSize(host, { cols: 80, rows: 24 }, current), undefined);
  assert.equal(fittedTerminalSize({ clientWidth: 0, clientHeight: 0 }, { cols: 100, rows: 30 }, current), undefined);
  assert.equal(fittedTerminalSize({ clientWidth: 800, clientHeight: 0 }, { cols: 100, rows: 30 }, current), undefined);
  assert.equal(fittedTerminalSize(host, undefined, current), undefined);
  assert.equal(fittedTerminalSize(host, { cols: 1, rows: 30 }, current), undefined);
  assert.equal(fittedTerminalSize(host, { cols: 100, rows: 0 }, current), undefined);
  assert.equal(fittedTerminalSize(host, { cols: Number.NaN, rows: 30 }, current), undefined);
});
