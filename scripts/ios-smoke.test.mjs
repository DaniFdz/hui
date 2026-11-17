/** Guards the iOS boot-readiness and share-handoff wiring and evidence scope; actual Swift/Vision self-tests run only on macOS. */
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
  assert.ok(watchdog.includes("let phaseStart = ProcessInfo.processInfo.systemUptime"));
  assert.ok(watchdog.includes("self.startedAt = phaseStart"));
  assert.ok(watchdog.includes("self.deadline = phaseStart + 90"));
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

test("iOS spends macOS minutes only on a change that can reach the native shell", () => {
  const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
  assert.doesNotMatch(triggers, /package(-lock)?\.json/u, "a dependency bump is proved by the Linux mobile build and the nightly");
  for (const path of ["mobile/ios/**", "mobile/connect/**", "capacitor.config.ts", "src/lib/native-shell.ts", "src/lib/native-shell-boot.ts"]) {
    assert.equal(triggers.split(`      - "${path}"`).length - 1, 2, `${path} wakes both the pull request and the push`);
  }
});

test("the app it built is checked for the Share Extension it embedded", () => {
  const start = workflow.indexOf("- name: Check the Share Extension is embedded");
  assert.notEqual(start, -1, "the embed check is wired into the job");
  const step = workflow.slice(start, workflow.indexOf("- name: Compile and self-test", start));
  assert.ok(workflow.indexOf("- name: Build for the simulator") < start, "the check reads what the build produced");
  for (const line of [
    'test -d "$app/PlugIns"',
    'appex=$(find "$app/PlugIns" -maxdepth 1 -name "*.appex" -print -quit)',
    'test "$point" = "com.apple.share-services"',
  ]) assert.ok(step.includes(line), line);
  assert.doesNotMatch(step, /\|\s*head\b/u, "a find into head fails under pipefail");
  for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
    assert.equal((step.match(new RegExp(`Print :${key}`, "gu")) ?? []).length, 2, `${key} is read from the appex and the app`);
  }
});

test("the simulator build targets the device it captures on, so one architecture is compiled", () => {
  assert.match(workflow, /-destination "id=\$HUI_IOS_UDID" ONLY_ACTIVE_ARCH=YES/u);
  assert.doesNotMatch(workflow, /generic\/platform\/iOS Simulator/u);
  assert.ok(workflow.includes('path: ~/iosbuild'));
  assert.ok(workflow.includes('-derivedDataPath "$HOME/iosbuild"'));
  assert.ok(workflow.indexOf("actions/cache@") < workflow.indexOf("-derivedDataPath"));
});

test("iOS opens hui://share in the running app after the gateway screen and OCRs the seed's lead", () => {
  const gateway = '"$RUNNER_TEMP/ios-smoke" wait "$HUI_IOS_UDID" "$RUNNER_TEMP/shots" gateway';
  const openURL = "xcrun simctl openurl \"$HUI_IOS_UDID\" 'hui://share?url=https%3A%2F%2Fwww.instagram.com%2Freel%2F987654321%2F'";
  const share = '"$RUNNER_TEMP/ios-smoke" wait "$HUI_IOS_UDID" "$RUNNER_TEMP/shots" share';
  const upload = "uses: actions/upload-artifact@";
  assert.equal(workflow.split(share).length - 1, 1, "the share phase runs exactly once");
  const gatewayWait = workflow.indexOf(gateway);
  const opened = workflow.indexOf(openURL);
  const proved = workflow.indexOf(share);
  assert.notEqual(gatewayWait, -1, "the gateway screen is proved first");
  assert.notEqual(opened, -1, "the share link is opened");
  assert.ok(gatewayWait < opened, "the share is delivered to the app the gateway screen just proved");
  assert.doesNotMatch(workflow.slice(gatewayWait, opened), /simctl terminate/u,
    "the app stays running: a stopped app's openurl leaves the system confirmation the OCR oracle cannot dismiss");
  assert.ok(opened < proved, "the link is opened before its screen is read");
  assert.ok(proved < workflow.indexOf(upload), "the ready share frame is uploaded with the artifact");
  // The extension builds `hui://share?url=<value>`: the link has to carry the shared post, percent-encoded once.
  const encoded = "https%3A%2F%2Fwww.instagram.com%2Freel%2F987654321%2F";
  assert.ok(openURL.includes(`'hui://share?url=${encoded}'`), "the openurl carries the percent-encoded Instagram post");
  assert.match(oracle, /"share": \["Look this post in Instagram"\]/u, "the oracle requires the share sentence's lead");
  const selfTest = oracle.slice(oracle.indexOf("func selfTest()"), oracle.indexOf("// This owns the single whole-phase"));
  assert.ok(selfTest.includes('rendered("Look this post in YouTube https://www.youtube.com/watch?v=1")'),
    "the one-phrase share phase rejects another site's seed in the self-test");
  assert.ok(selfTest.includes('!isReady(otherSiteShare, for: "share")'), "and asserts that negative");
  assert.ok(oracle.includes('for phase in ["connect", "gateway", "share"]'), "the self-test exercises the new phase");
  assert.ok(oracle.includes("<connect|gateway|share>"), "and the usage string names it");
});
