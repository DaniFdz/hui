/** Guards the web suite's shard matrix: the pull-request workflow and the nightly must slice it identically. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const workflow = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

/** The `shard:` matrix of one job, or null when the job declares none. */
const matrixOf = (source, job) => {
  const start = source.indexOf(`\n  ${job}:`);
  assert.notEqual(start, -1, `the workflow declares a "${job}" job`);
  const match = source.slice(start).match(/^ {8}shard: (\[[^\n]+\])$/mu);
  return match === null ? null : JSON.parse(match[1]);
};

test("the nightly shards the web suite exactly as the pull-request workflow does", () => {
  const onPullRequest = matrixOf(workflow("e2e.yml"), "web");
  const nightly = matrixOf(workflow("nightly.yml"), "e2e");
  assert.ok(Array.isArray(onPullRequest), "e2e.yml declares a web shard matrix");
  assert.deepEqual(nightly, onPullRequest, "nightly.yml slices the suite the same way");
});

test("every shard of the matrix exists, is named once, and is the slice its step runs", () => {
  const suite = workflow("e2e.yml");
  const matrix = matrixOf(suite, "web");
  const total = matrix.length;
  assert.ok(total >= 2, `the suite is sharded, not run whole (${total} shard)`);
  assert.deepEqual(matrix, Array.from({ length: total }, (_, index) => `${index + 1}/${total}`));
  const job = suite.slice(suite.indexOf("\n  web:"));
  assert.match(job, /^ {6}- run: npm run e2e -- --shard \$\{\{ matrix\.shard \}\}$/mu);
});
