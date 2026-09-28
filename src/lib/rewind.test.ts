import assert from "node:assert/strict";
import test from "node:test";
import { checkpointForTarget } from "./rewind.ts";

test("contextual rewind resolves the visible occurrence on the active branch", () => {
  const checkpoints = [
    { key: "old", id: "old", kind: "user" as const, label: "User message", detail: "Old branch", current: false },
    { key: "first", id: "first", kind: "user" as const, label: "User message", detail: "First", current: true },
    { key: "thinking", id: "first", kind: "thinking" as const, label: "Before reasoning", detail: "Think", current: true },
    { key: "second", id: "second", kind: "user" as const, label: "User message", detail: "Second", current: true },
  ];

  assert.equal(checkpointForTarget(checkpoints, { kind: "user", occurrence: 1 })?.key, "second");
  assert.equal(checkpointForTarget(checkpoints, { kind: "user", occurrence: 2 }), undefined);
  assert.equal(checkpointForTarget(checkpoints, undefined), undefined);
});
