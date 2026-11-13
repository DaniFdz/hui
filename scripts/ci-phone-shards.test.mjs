/** Guards complete Android CI slicing: more isolated runners reduce elapsed time without dropping cases or extending deadlines. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/mobile.yml", import.meta.url), "utf8");
const job = workflow.slice(workflow.indexOf("\n  android-e2e:"), workflow.indexOf("\n  ios-ipa:"));

test("Android uses every six-way slice once and keeps its existing failure deadline and catalogue selection", () => {
  const matrix = JSON.parse(job.match(/        shard: (\[[^\n]+\])/u)?.[1] ?? "null");
  assert.deepEqual(matrix, Array.from({ length: 6 }, (_, index) => `${index + 1}/6`));
  assert.match(job, /timeout-minutes: 45/u);
  assert.match(job, /fail-fast: false/u);
  assert.ok(job.includes('tags=$(node e2e/catalogue/phone.ts'));
  assert.ok(job.includes('npx e2e run --target android --shard "${{ matrix.shard }}" --tag "$tags"'));
  assert.doesNotMatch(job, /--exclude-tag|--grep|--max-failures|--retries/u);
});
