import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionTreeIds } from "./session-tree.ts";

test("subtree traversal includes nested descendants regardless of order, without looping on cycles", () => {
  const sessions = [
    { id: "grandchild", parentId: "child" }, { id: "outside" },
    { id: "child", parentId: "root" }, { id: "root", parentId: "grandchild" },
  ];
  assert.deepEqual([...sessionTreeIds(sessions, "root")].sort(), ["child", "grandchild", "root"]);
  assert.deepEqual([...sessionTreeIds(sessions, "outside")], ["outside"]);
});
