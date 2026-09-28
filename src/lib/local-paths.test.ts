import assert from "node:assert/strict";
import test from "node:test";
import { completeLocalPath, localPathQuery } from "./local-paths.ts";

test("local path queries follow the caret and also expose leading absolute prefixes", () => {
  assert.deepEqual(localPathQuery("Check @src/ma please", 13), {
    input: "src/ma",
    start: 6,
    end: 13,
    mention: true,
  });
  assert.deepEqual(localPathQuery("Open ./src/", 11), {
    input: "./src/",
    start: 5,
    end: 11,
    mention: false,
  });
  assert.deepEqual(localPathQuery("Look in /tmp/hu", 15), {
    input: "/tmp/hu",
    start: 8,
    end: 15,
    mention: false,
  });
  assert.deepEqual(localPathQuery("/review", 7), { input: "/review", start: 0, end: 7, mention: false });
  assert.equal(localPathQuery("$review", 7), null);
  assert.equal(localPathQuery("plain", 5), null);
  assert.equal(localPathQuery("@src", 1, 4), null);
});

test("completion replaces only the token under the caret", () => {
  assert.deepEqual(
    completeLocalPath("Read @src/ma next", { input: "src/ma", start: 5, end: 12, mention: true }, {
      path: "src/main.ts",
      kind: "file",
    }),
    { text: "Read @src/main.ts next", caret: 17 },
  );
});
