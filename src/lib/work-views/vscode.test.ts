import assert from "node:assert/strict";
import { test } from "node:test";
import { vscodeWorkViewKind } from "./vscode.ts";
import { vscodeUnavailableReason } from "../../../shared/vscode.ts";

test("the VS Code kind is one view per conversation with a stable key and title", async () => {
  assert.equal(vscodeWorkViewKind.kind, "vscode");
  assert.equal(vscodeWorkViewKind.label, "VS Code");
  assert.equal(vscodeWorkViewKind.shortcut, "Mod+Alt+KeyV");
  const first = await vscodeWorkViewKind.create("alpha");
  const second = await vscodeWorkViewKind.create("alpha");
  assert.deepEqual(first, { kind: "vscode" });
  assert.equal(vscodeWorkViewKind.key(first), vscodeWorkViewKind.key(second), "launching again reuses the open view");
  assert.equal(vscodeWorkViewKind.title(first), "VS Code");
  assert.equal(vscodeWorkViewKind.unavailable?.(), undefined, "unknown status never blocks the launcher");
});

test("the launcher's reason comes from the gateway's state", () => {
  const base = { executableError: "" };
  assert.equal(vscodeUnavailableReason(undefined), undefined);
  assert.equal(vscodeUnavailableReason({ ...base, state: "off" }), "VS Code is off. Turn it on in Settings → Tools → VS Code.");
  assert.equal(vscodeUnavailableReason({ state: "unavailable", executableError: "openvscode-server was not found on PATH." }), "openvscode-server was not found on PATH.");
  for (const state of ["stopped", "starting", "running", "failed"] as const) assert.equal(vscodeUnavailableReason({ ...base, state }), undefined, state);
});
