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

test("iOS warms the real capture transport before launch, outside the unchanged readiness deadline", () => {
  const warmUp = '"$RUNNER_TEMP/ios-smoke" warm-up "$HUI_IOS_UDID" "$RUNNER_TEMP/shots"';
  const boot = 'xcrun simctl bootstatus "$HUI_IOS_UDID" -b';
  const launch = 'xcrun simctl launch "$HUI_IOS_UDID" dev.hui.app';
  assert.equal(workflow.split(warmUp).length - 1, 1, "exactly one fatal native capture warm-up");
  assert.ok(workflow.indexOf(boot) < workflow.indexOf(warmUp));
  assert.ok(workflow.indexOf(warmUp) < workflow.indexOf(launch), "cold transport cost precedes app launch");
  assert.doesNotMatch(workflow, /warm-up[^\n]*\|\|/u, "transport failure must not be ignored");
  assert.ok(oracle.includes('captureScreenshot(udid: udid, path: latest, label: phase)'));
  assert.ok(oracle.includes('captureScreenshot(udid: udid, path: frame, label: "warm-up")'), "warm-up uses the identical Simulator transport");
  assert.ok(oracle.includes('try recognizeFile(frame)'), "warm-up also exercises Vision on the actual native frame size");
  const wait = oracle.slice(oracle.indexOf("func waitForReady("), oracle.indexOf("\ndo {"));
  assert.ok(wait.indexOf("systemUptime + 24") < wait.indexOf("while "));
  assert.ok(wait.indexOf("captureScreenshot(") < wait.indexOf("try recognizeFile(latest)"));
  assert.ok(wait.includes("observedAt < deadline && matches"), "a matching frame observed late must still fail");
  assert.ok(wait.includes("OCR completed at uptime="));
  assert.ok(oracle.includes("screenshot started at uptime="));
  assert.ok(oracle.includes("screenshot completed at uptime="));
  assert.ok(oracle.includes("screenshot failed with status"));
  assert.ok(oracle.includes("CI Connect OCR did not match"), "macOS self-test covers the exact CI OCR that arrived late");
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
