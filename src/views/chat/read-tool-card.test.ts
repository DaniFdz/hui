import assert from "node:assert/strict";
import test from "node:test";
import { readToolPresentation } from "./read-tool-card.ts";

test("read rows summarize their target and retain unsummarized arguments", () => {
  const view = readToolPresentation({ kind: "tool", id: "1", name: "read", args: { path: "/home/test/project/file.ts", offset: 5, limit: 20 } });
  assert.deepEqual(view, { target: "file.ts", detail: "from ~/project/file.ts", extras: [["offset", 5], ["limit", 20]] });
});

test("read presentation handles Windows paths without inventing a path for other tools", () => {
  assert.deepEqual(readToolPresentation({ kind: "tool", id: "1", name: "read", args: { path: "C:\\Users\\test\\project\\file.ts" } }),
    { target: "file.ts", detail: "from ~\\project\\file.ts", extras: [] });
  assert.equal(readToolPresentation({ kind: "tool", id: "1", name: "read", args: {} }), null);
  assert.equal(readToolPresentation({ kind: "tool", id: "1", name: "read", args: { path: "/tmp/file name " } })?.target, "file name ");
  assert.equal(readToolPresentation({ kind: "tool", id: "1", name: "bash", args: { path: "file.ts" } }), null);
});
