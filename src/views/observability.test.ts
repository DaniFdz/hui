import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const source = await readFile(new URL("./observability.ts", import.meta.url), "utf8");

test("diagnostic copy states the privacy boundary", () => {
  assert.match(source, /never includes prompt text, tool arguments\/output, credentials or secret values/u);
});
