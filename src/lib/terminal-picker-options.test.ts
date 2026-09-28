import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { terminalPickerOptions } from "./terminal-picker-options.ts";
import type { TerminalView } from "./terminal-types.ts";

const view = (id: string, title: string, status: TerminalView["status"] = "running"): TerminalView =>
  ({ id, ownerSessionId: "s1", title, cwd: "/tmp", cols: 80, rows: 24, status, createdAt: "2026-09-25T00:00:00.000Z" });

test("terminal picker lists terminals and marks exited ones", () => {
  assert.deepEqual(terminalPickerOptions([view("t1", "Terminal 1"), view("t2", "Terminal 2", "exited")], "t1"), [
    { value: "t1", label: "Terminal 1" },
    { value: "t2", label: "Terminal 2 (exited)" },
  ]);
});

test("terminal picker keeps a missing current terminal as unavailable", () => {
  assert.deepEqual(terminalPickerOptions([view("t2", "Terminal 2")], "t1"), [
    { value: "t1", label: "Terminal unavailable" },
    { value: "t2", label: "Terminal 2" },
  ]);
  assert.deepEqual(terminalPickerOptions([], "t1"), [{ value: "t1", label: "Terminal unavailable" }]);
});

test("the terminal header uses the shared HUI picker instead of a native select", () => {
  const pane = readFileSync(new URL("../components/terminal-pane.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/terminal.css", import.meta.url), "utf8");
  assert.doesNotMatch(pane, /<select/);
  assert.match(pane, /renderPicker\(\{[\s\S]*label: "Terminal"[\s\S]*onOpen:[\s\S]*refreshList/);
  assert.doesNotMatch(css, /\.hui-terminal-title select/);
  assert.match(css, /\.hui-terminal-title \.picker-select__trigger \{[^}]*border: 0/);
});
