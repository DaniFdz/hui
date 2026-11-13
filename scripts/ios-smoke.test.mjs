/** Guards the iOS CI boot oracle's wiring; actual Vision positive/negative image tests run on macOS, not in this guard. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const workflow = await readFile(new URL("../.github/workflows/ios.yml", import.meta.url), "utf8");
const oracle = await readFile(new URL("./ios-smoke.swift", import.meta.url), "utf8");

test("iOS compiles and self-tests Vision once before either real screenshot wait", () => {
  const compile = 'xcrun swiftc scripts/ios-smoke.swift -o "$RUNNER_TEMP/ios-smoke"';
  const selfTest = '"$RUNNER_TEMP/ios-smoke" self-test';
  const connect = '"$RUNNER_TEMP/ios-smoke" wait "$HUI_IOS_UDID" "$RUNNER_TEMP/shots" connect';
  const gateway = '"$RUNNER_TEMP/ios-smoke" wait "$HUI_IOS_UDID" "$RUNNER_TEMP/shots" gateway';
  for (const command of [compile, selfTest, connect, gateway]) assert.equal(workflow.split(command).length - 1, 1);
  assert.ok(workflow.indexOf(compile) < workflow.indexOf(selfTest));
  assert.ok(workflow.indexOf(selfTest) < workflow.indexOf('xcrun simctl launch "$HUI_IOS_UDID" dev.hui.app'));
  assert.ok(workflow.indexOf(connect) < workflow.indexOf(gateway));
  assert.equal(workflow.split('"scripts/ios-smoke.swift"').length - 1, 2, "both trigger path filters cover the oracle");
  assert.equal(workflow.split('"scripts/ios-smoke.test.mjs"').length - 1, 2, "both filters cover this guard");
});

test("iOS readiness requires known rendered content, never elapsed sleep or changed bytes", () => {
  assert.match(oracle, /"connect": \["Connect to HUI", "GATEWAY URL"\]/u);
  assert.match(oracle, /"gateway": \["Plan the Android app", "Fix the flaky upload test"\]/u);
  for (const title of ["Plan the Android app", "Fix the flaky upload test"]) assert.ok(workflow.includes(`seed "${title}"`));
  assert.ok(oracle.includes("phrases.allSatisfy"), "every required phrase must match the same captured frame");
  assert.ok(oracle.includes("VNRecognizeTextRequest()"));
  assert.ok(oracle.includes("ProcessInfo.processInfo.systemUptime + 24"));
  assert.ok(oracle.includes("guard capture.terminationStatus == 0 else"), "capture errors are fatal");
  assert.ok(oracle.includes("try FileManager.default.copyItem(at: latest, to: ready)"), "the matched frame is retained");
  assert.doesNotMatch(oracle, /Thread\.sleep|usleep|try\?/u);
  assert.doesNotMatch(workflow, /\bcmp\b|seq 1 12|screenshot[^\n]*\|\| true/u);
  assert.equal((workflow.match(/\bsleep\s+\d+/gu) ?? []).length, 1, "only the pre-existing receipt state poll may sleep");
});
