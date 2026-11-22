/** Guards web-shard evidence retention: cancellation must not erase the traces needed to diagnose earlier failures. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const workflow = await readFile(new URL("../.github/workflows/e2e.yml", import.meta.url), "utf8");

test("web shards retain partial evidence on cancellation without changing their failure policy", () => {
  assert.match(workflow, /- if: \$\{\{ always\(\) \}\}\n\s+uses: actions\/upload-artifact@/u);
  assert.ok(workflow.includes("            .e2e/"));
  assert.ok(workflow.includes("            /tmp/hui-visual-*/artifacts/"));
  assert.match(workflow, /timeout-minutes: 20/u);
  assert.match(workflow, /fail-fast: false/u);
  assert.doesNotMatch(workflow, /continue-on-error|--retries/u);
});
