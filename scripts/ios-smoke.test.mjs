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

test("iOS shares one 90 s infrastructure bound for admissions, completed text and the watchdog", () => {
  const watchdog = oracle.slice(oracle.indexOf("final class InfrastructureWatchdog"), oracle.indexOf("// Both preparation"));
  const wait = oracle.slice(oracle.indexOf("func waitForReady("), oracle.indexOf("\ndo {"));
  assert.ok(watchdog.includes("deadline = startedAt + 90"));
  assert.ok(watchdog.includes("timer.schedule(deadline: .now() + max(0, deadline - ProcessInfo.processInfo.systemUptime))"));
  assert.ok(wait.includes("let startedAt = watchdog.startedAt"));
  assert.ok(wait.includes("let deadline = watchdog.deadline"));
  assert.ok(wait.includes("while ProcessInfo.processInfo.systemUptime < deadline"));
  assert.doesNotMatch(wait, /deadline\s*=.*\+/u, "the observation loop must not invent or restart a second clock");
  const capture = oracle.slice(oracle.indexOf("func captureScreenshot("), oracle.indexOf("func warmUp("));
  const admission = capture.indexOf("if started >= watchdog.deadline { return nil }");
  assert.notEqual(admission, -1, "the final native-capture admission guard is required");
  assert.ok(admission < capture.indexOf("try capture.run()"));
  assert.ok(oracle.includes("not admitted: infrastructure deadline passed"));
  assert.ok(oracle.includes("startedAt < deadline && finishedAt >= startedAt && finishedAt < deadline && isReady(text, for: phase)"));
  assert.ok(wait.includes("startedAt: capture.startedAt, finishedAt: observedAt, deadline: deadline)"));
  assert.ok(oracle.includes('acceptsObservation("6:26", for: "connect", startedAt: 620.1418623750001,'));
  assert.ok(oracle.includes("let firstFinishedAt = 646.771619375"), "macOS self-test retains the actual slow blank C165 timing");
  assert.ok(oracle.includes('"C165 first observation exhausted infrastructure"'), "a slow first observation does not end admission");
  assert.ok(oracle.includes("startedAt: firstFinishedAt + 0.01,"));
  assert.ok(oracle.includes('"later in-bound content rejected"'), "a hypothetical subsequent matching observation can pass before the same bound");
  assert.ok(oracle.includes("for start in [infrastructureDeadline, infrastructureDeadline + 1]"));
  assert.ok(oracle.includes("for finish in [infrastructureDeadline, infrastructureDeadline + 1]"));
  assert.ok(oracle.includes('"in-bound splash/error observation passed"'));
  assert.doesNotMatch(oracle, /\b24\b|observation-start|beyond-start/u, "no unsupported admission cutoff remains");
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
  assert.ok(oracle.includes("beyond-infrastructure-bound="));
  assert.ok(oracle.includes("render latency unmeasured"));
  assert.ok(workflow.includes("NOT a UI render-latency SLA"));
  assert.ok(workflow.includes("ONE 90 s infrastructure bound for capture admission AND completed OCR"));
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
