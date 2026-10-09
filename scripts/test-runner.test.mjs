/** Verifies optional JUnit reporting keeps test output and failure exit status. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const fails of [false, true]) {
  test(`JUnit reporting preserves ${fails ? "failing" : "passing"} test results`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "hui-test-reporter-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const fixture = join(directory, "fixture.test.mjs");
    const report = join(directory, "reports", "junit.xml");
    writeFileSync(fixture, `import { test } from 'node:test';\ntest('report fixture', () => { ${fails ? "throw new Error('intentional failure');" : ""} });\n`);
    const env = { ...process.env };
    delete env.HUI_TEST_JUNIT_REPORT;
    delete env.NODE_TEST_CONTEXT;
    const plain = spawnSync(process.execPath, ["scripts/test.mjs", fixture], { env, encoding: "utf8" });
    assert.equal(plain.status, fails ? 1 : 0, plain.stderr);
    const reported = spawnSync(process.execPath, ["scripts/test.mjs", fixture], {
      env: { ...env, HUI_TEST_JUNIT_REPORT: report }, encoding: "utf8",
    });
    assert.equal(reported.status, plain.status, reported.stderr);
    assert.match(reported.stdout, /report fixture/u);
    const xml = readFileSync(report, "utf8");
    assert.match(xml, /<testsuites/u);
    assert.match(xml, /<testcase name="report fixture"/u);
    if (fails) assert.match(xml, /<failure/u);
    else assert.doesNotMatch(xml, /<failure/u);
  });
}
