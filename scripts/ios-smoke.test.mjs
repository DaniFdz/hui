/** Guards iOS boot-readiness wiring and evidence scope; actual Swift/Vision self-tests run only on macOS. */
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
  assert.equal(workflow.split('"scripts/ios-smoke.swift"').length - 1, 2);
  assert.equal(workflow.split('"scripts/ios-smoke.test.mjs"').length - 1, 2);
});

test("iOS warms the real capture transport before launch without reusing it as proof", () => {
  const warmUp = '"$RUNNER_TEMP/ios-smoke" warm-up "$HUI_IOS_UDID" "$RUNNER_TEMP/shots"';
  assert.equal(workflow.split(warmUp).length - 1, 1);
  assert.ok(workflow.indexOf('xcrun simctl bootstatus "$HUI_IOS_UDID" -b') < workflow.indexOf(warmUp));
  assert.ok(workflow.indexOf(warmUp) < workflow.indexOf('xcrun simctl launch "$HUI_IOS_UDID" dev.hui.app'));
  assert.doesNotMatch(workflow, /warm-up[^\n]*\|\|/u);
  assert.ok(oracle.includes('captureScreenshot(udid: udid, path: frame, label: "warm-up", watchdog: watchdog)'));
  assert.ok(oracle.includes('try recognizeFile(frame)'));
  const wait = oracle.slice(oracle.indexOf("func waitForReady("), oracle.indexOf("\ndo {"));
  assert.doesNotMatch(wait, /capture-warm-up|recognizeFile\(frame\)/u);
  assert.ok(wait.includes("captureScreenshot(udid: udid, path: latest, label: phase,"));
  assert.ok(wait.indexOf("captureScreenshot(") < wait.indexOf("try recognizeFile(latest)"));
});

test("iOS admits observations for 24 s, bounds infrastructure separately, and retains every real observation", () => {
  assert.ok(oracle.includes("let deadline = startedAt + 24"));
  assert.ok(oracle.includes("while ProcessInfo.processInfo.systemUptime < deadline"));
  const capture = oracle.slice(oracle.indexOf("func captureScreenshot("), oracle.indexOf("func warmUp("));
  assert.ok(capture.indexOf("if let deadline, started >= deadline { return nil }") < capture.indexOf("try capture.run()"));
  assert.ok(oracle.includes("watchdog: watchdog, before: deadline) else {"));
  assert.ok(oracle.includes("not admitted: observation-start deadline passed"));
  assert.ok(oracle.includes("startedAt < deadline && finishedAt >= startedAt && isReady(text, for: phase)"));
  assert.doesNotMatch(oracle, /observedAt < deadline|finishedAt < deadline/u, "completion is not a render-latency SLA");
  assert.ok(oracle.includes("finishedAt: 512.0349127916667, deadline: 510.09199558333336"), "macOS self-test includes exact late 6d completion");
  assert.ok(oracle.includes("for start in [510.09199558333336, 511.0]"), "deadline equality and later admissions are rejected");
  assert.ok(oracle.includes('"late splash/error observation passed"'), "late completion never waives required content");
  assert.ok(oracle.includes("timer.schedule(deadline: .now() + 90)"));
  assert.ok(oracle.includes("timer.setEventHandler { [weak self] in self?.expire() }"));
  assert.ok(oracle.includes("kill(child.processIdentifier, SIGKILL)"));
  const expiry = oracle.slice(oracle.indexOf("private func expire()"), oracle.indexOf("// Both preparation"));
  assert.ok(expiry.includes("exit(1)"));
  assert.doesNotMatch(expiry, /waitUntilExit/u, "watchdog cannot wait on an uncooperative child");
  assert.equal((oracle.match(/defer \{ watchdog.cancel\(\) \}/gu) ?? []).length, 2, "both warm-up and proof phases are bounded");
  assert.ok(workflow.includes("timeout-minutes: 30"));
  assert.ok(oracle.includes('"\\(phase)-\\(attempt).png"'));
  assert.ok(oracle.includes('"\\(phase)-\\(attempt).txt"'));
  assert.ok(oracle.includes("try evidence.write(to: record, atomically: true, encoding: .utf8)"));
  assert.ok(oracle.includes("OCR pending"), "capture timings survive an OCR hang");
  assert.ok(oracle.includes('"\\(phase)-\\(attempt)-error.txt"'));
  assert.ok(oracle.includes("beyond-start-budget="));
  assert.ok(oracle.includes("render latency unmeasured"));
  assert.ok(workflow.includes("NOT a <=24 s launch/render/observation SLA"));
});

test("iOS readiness requires known rendered content, never elapsed sleep or changed bytes", () => {
  assert.match(oracle, /"connect": \["Connect to HUI", "GATEWAY URL"\]/u);
  assert.match(oracle, /"gateway": \["Plan the Android app", "Fix the flaky upload test"\]/u);
  for (const title of ["Plan the Android app", "Fix the flaky upload test"]) assert.ok(workflow.includes(`seed "${title}"`));
  assert.ok(oracle.includes("phrases.allSatisfy"));
  assert.ok(oracle.includes("VNRecognizeTextRequest()"));
  assert.ok(oracle.includes("guard capture.terminationStatus == 0 else"));
  assert.ok(oracle.includes("try FileManager.default.copyItem(at: latest, to: ready)"));
  assert.ok(oracle.includes("CI Connect OCR did not match"));
  assert.doesNotMatch(oracle, /Thread\.sleep|usleep|try\?/u);
  assert.doesNotMatch(workflow, /\bcmp\b|seq 1 12|screenshot[^\n]*\|\| true/u);
  assert.equal((workflow.match(/\bsleep\s+\d+/gu) ?? []).length, 1, "only the pre-existing receipt state poll may sleep");
});
