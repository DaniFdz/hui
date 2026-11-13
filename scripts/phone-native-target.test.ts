/** Guards physical native window selection and the scope of logical identity during Activity handoff. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { attachedNativeTarget, nativeTransportGate, nativeWindowIdentity, type NativeTarget } from "./phone-native-target.ts";

const target = (id: string, attached = true, overrides = {}): NativeTarget => ({
  id, type: "page", url: "http://127.0.0.1:46721/",
  description: JSON.stringify({ attached, visible: true, width: 1080, height: 2274, ...overrides }),
});

test("same-origin detached outgoing windows never win over the attached physical window, in either order", () => {
  const old = target("old", false);
  const current = target("current");
  assert.equal(attachedNativeTarget([old, current]), current);
  assert.equal(attachedNativeTarget([current, old]), current);
  assert.equal(attachedNativeTarget([old]), undefined);
});

test("an early page-created event is not a native attachment transition", () => {
  const old = target("old");
  assert.equal(attachedNativeTarget([old, target("new", false)]), old);
  assert.equal(attachedNativeTarget([target("old", false), target("new")])?.id, "new");
  assert.equal(attachedNativeTarget([target("new", true, { visible: false })]), undefined);
  assert.equal(attachedNativeTarget([target("new", true, { width: 0 })]), undefined);
  // Observed during real Activity rebuild: discovery/attachment precedes a drawable native frame.
  const early = { ...target("new"), description: '{"attached":true,"empty":true,"never_attached":false,"screenX":0,"screenY":0,"visible":true}' };
  assert.equal(attachedNativeTarget([early]), undefined);
});

test("ambiguous attached windows and missing or malformed native metadata fail closed", () => {
  assert.throws(() => attachedNativeTarget([target("one"), target("two")]), /ambiguous/u);
  for (const description of [undefined, "", "{}", "null", "broken", '{"attached":true,"visible":true,"width":1080}']) {
    assert.throws(() => attachedNativeTarget([{ ...target("unknown"), description }]), /metadata/u);
  }
  assert.equal(attachedNativeTarget([{ id: "worker", type: "service_worker", url: "http://127.0.0.1/" }]), undefined);
});

test("monitor invalidation never disconnects an in-flight action; the next operation retires once without Page.close", () => {
  let closes = 0;
  const gate = nativeTransportGate(() => true, () => { closes += 1; });
  assert.equal(gate.isConnected(), true); // engine dispatches an action
  gate.invalidate(); // genuine new native attachment while that action completes
  assert.equal(closes, 0);
  assert.equal(gate.isConnected(), false); // next engine operation recovers before dispatch
  assert.equal(closes, 1);
  assert.equal(gate.isConnected(), false);
  assert.equal(closes, 1);
});

test("handoff keeps one logical identity only for the verified physical window", () => {
  const original = { targetId: "old", browserContextId: "native-context", url: "http://127.0.0.1/" };
  const replacement = { ...original, targetId: "new", url: "http://localhost/" };
  assert.equal(nativeWindowIdentity(original, "old", "pid-42")["targetId"], "pid-42:main-window");
  assert.equal(nativeWindowIdentity(replacement, "new", "pid-42")["targetId"], "pid-42:main-window");
  assert.equal(nativeWindowIdentity(original, "new", "pid-42"), original);
  assert.equal(nativeWindowIdentity(replacement, "old", "pid-42"), replacement);
  assert.equal(nativeWindowIdentity(replacement, "new", "pid-42")["url"], "http://localhost/");
});
