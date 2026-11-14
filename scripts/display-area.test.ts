/** Guards independent native-frame parsing and CSS-to-display mapping, including failures that must not look safe. */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { androidDisplay, displayBox, nativeFrame, nativePaint, parseDisplay, parseWebView, queuedNativeFrame, validateNativeFrame } from "../e2e/fixtures/display-area.ts";

const state = (cutout = 0, status = 63) => `mDisplayFrame=Rect(0, 0 - 1080, 2400)
 mDisplayCutout=DisplayCutout{insets=Rect(0, ${cutout} - 0, 0) waterfall=Insets{left=0, top=0, right=0, bottom=0}}
 InsetsSource id=1 type=statusBars frame=[0,0][1080,${status}] visible=true
 InsetsSource id=2 type=navigationBars frame=[0,2337][1080,2400] visible=true`;
const view = (bounds: string, app = "dev.hui.app.debug") => `<node class="android.webkit.WebView" package="${app}" bounds="${bounds}" />`;

test("system bars exist without a cutout and effective top is the max, not their sum", () => {
  assert.deepEqual(parseDisplay(state()), { width: 1080, height: 2400, top: 63, bottom: 2337, left: 0, right: 1080, cutoutTop: 0 });
  assert.equal(parseDisplay(state(220, 126)).top, 220);
  assert.equal(parseDisplay(state(110, 126)).top, 126);
});

test("missing or hidden system sources fail instead of reporting a safe screen", () => {
  assert.throws(() => parseDisplay(state().replace("type=statusBars", "type=unknown")), /statusBars/u);
  assert.throws(() => parseDisplay(state().replaceAll("visible=true", "visible=false")), /statusBars/u);
  assert.throws(() => parseDisplay(state().replace("mDisplayFrame", "missing")), /display frame/u);
});

test("a plausible emulated viewport or a WebView under system chrome cannot pass as native evidence", () => {
  const safe = parseDisplay(state());
  const frame = { x: 0, y: 63, width: 1080, height: 2274 };
  const metrics = { width: 412, height: 867, ratio: 2.625, scale: 1 };
  validateNativeFrame(safe, frame, metrics);
  assert.throws(() => validateNativeFrame(safe, frame, { ...metrics, ratio: 1 }), /viewport mismatch/u);
  assert.throws(() => validateNativeFrame(safe, frame, { ...metrics, scale: 2 }), /viewport mismatch/u);
  assert.throws(() => validateNativeFrame(safe, { ...frame, y: 0 }, metrics), /overlaps system chrome/u);
  assert.throws(() => validateNativeFrame(safe, { ...frame, y: 64 }, metrics), /overlaps system chrome/u);
});

test("native origin is taken from the one app WebView, not a calculated safe inset", () => {
  const frame = parseWebView(view("[0,220][1080,2337]"));
  assert.deepEqual(frame, { x: 0, y: 220, width: 1080, height: 2117 });
  const nested = view("[0,220][1080,2337]").replace(" />", ">") + view("[0,220][1080,2339]") + "</node>";
  assert.deepEqual(parseWebView(nested), frame);
  assert.deepEqual(displayBox({ x: 4, y: 8, width: 80, height: 24 }, frame, 2.625),
    { x: 4, y: 220 / 2.625 + 8, width: 80, height: 24 });
  assert.throws(() => parseWebView(view("[0,220][1080,2337]", "another.app")), /found 0/u);
  assert.throws(() => parseWebView(view("[0,220][1080,2337]").repeat(2)), /found 2/u);
  assert.throws(() => parseWebView(view("[0,220][1080,220]")), /empty/u);
});

const nativeTarget = (id: string, info: Record<string, unknown> = {}) => ({ id, type: "page", url: "http://127.0.0.1:47400/",
  description: JSON.stringify({ attached: true, visible: true, screenX: 0, screenY: 63, width: 1080, height: 2274, ...info }) });

test("physical frame selection ignores detached outgoing pages and rejects malformed or ambiguous native views", async () => {
  const current = nativeTarget("current");
  const outgoing = nativeTarget("outgoing", { attached: false });
  const frame = { x: 0, y: 63, width: 1080, height: 2274 };
  assert.deepEqual(nativeFrame([outgoing, current]), frame);
  assert.equal(await androidDisplay(() => { throw new Error("no accessibility dump"); }, async () => [outgoing, current]).target(), "current");
  assert.throws(() => nativeFrame([outgoing]), /no attached/u);
  assert.throws(() => nativeFrame([current, nativeTarget("second")]), /ambiguous/u);
  for (const info of [{ screenX: undefined }, { screenY: -1 }, { screenY: "63" }, { width: "1080" }]) {
    assert.throws(() => nativeFrame([nativeTarget("bad", info)]), /frame|metadata/u);
  }
  assert.throws(() => validateNativeFrame(parseDisplay(state()), frame, { width: 390, height: 844, ratio: 1, scale: 1 }), /viewport mismatch/u);
});

const paintedWindow = `  mCurrentFocus=Window{abc u0 dev.hui.app.debug/dev.hui.app.MainActivity}
  Window #0 Window{abc u0 dev.hui.app.debug/dev.hui.app.MainActivity}:
    mHasSurface=true isReadyForDisplay()=true
    Surface: shown=true mDrawState=HAS_DRAWN
    isOnScreen=true
  Window #1 Window{other u0 another/app}:
    Surface: shown=true mDrawState=HAS_DRAWN`;
const layers = `RequestedLayerState{abc dev.hui.app.debug/dev.hui.app.MainActivity#10 parentId=9}
RequestedLayerState{dev.hui.app.debug/dev.hui.app.MainActivity#11 parentId=10}`;

test("native paint needs the focused app's shown drawn window and its own presented buffer, not CSS or another layer", () => {
  const latency = "16666666\n100\t200\t150\n0\t0\t0\n300\t9223372036854775807\t350\n";
  assert.deepEqual(nativePaint(paintedWindow, layers, () => latency), { window: "abc", layer: "dev.hui.app.debug/dev.hui.app.MainActivity#11", presentedNs: "200" });
  for (const change of [
    paintedWindow.replace("mCurrentFocus=Window{abc", "mCurrentFocus=Window{other"),
    paintedWindow.replace("shown=true", "shown=false"),
    paintedWindow.replace("HAS_DRAWN", "DRAW_PENDING"),
    paintedWindow.replace("isOnScreen=true", "isOnScreen=false"),
  ]) assert.equal(nativePaint(change, layers, () => latency), undefined);
  assert.equal(nativePaint(paintedWindow, layers.replace("parentId=10", "parentId=99"), () => latency), undefined);
  assert.equal(nativePaint(paintedWindow, layers, () => latency, "201"), undefined, "historical presentation cannot satisfy a later queued native render");
  assert.ok(nativePaint(paintedWindow, layers, () => latency, "200"), "an already presented idle frame needs no manufactured repaint");
  for (const pending of ["16666666\n", "16666666\n0\t0\t0", "16666666\n300\t9223372036854775807\t350"]) {
    assert.equal(nativePaint(paintedWindow, layers, () => pending), undefined, "a pending fence is not a presentation");
  }
});

test("latest native render, not historical gfxinfo, must complete before its presentation is accepted", () => {
  const stats = (row: string) => `---PROFILEDATA---\nFlags,IntendedVsync,SwapBuffers,FrameCompleted,\n0,10,100,150,\n${row}\n---PROFILEDATA---`;
  assert.equal(queuedNativeFrame(stats("0,20,200,250,")), "200");
  assert.equal(queuedNativeFrame(stats("0,20,200,9223372036854775807,")), undefined);
  assert.equal(queuedNativeFrame(stats("0,20,200,0,")), undefined);
  assert.equal(queuedNativeFrame(""), undefined);
});

const CUTOUT = "com.android.internal.emulation.pixel_3_xl";
const emulator = () => {
  let rotation = 0;
  let top = 171; // Resources were restored, but the previous run left the effective SystemUI frame stale.
  let enabled = false;
  const calls: string[] = [];
  const run = (...args: string[]) => {
    const command = args.join(" ");
    calls.push(command);
    if (command === "shell dumpsys window displays") return `mRotation=${rotation} mDeferredRotationPauseCount=0\n${state(enabled ? 171 : 0, top)}`;
    if (command === "shell dumpsys activity top") return `com.getcapacitor.CapacitorWebView{abc V. 0,${top}-1080,2337 #id}`;
    if (command === "shell settings get system accelerometer_rotation") return "1";
    if (command === "shell settings get system user_rotation") return "0";
    if (command.startsWith("shell settings put system user_rotation ")) {
      const next = Number(args.at(-1));
      if (next !== rotation) top = enabled ? 171 : 63;
      rotation = next;
    }
    if (command === "shell cmd overlay list") return `[${enabled ? "x" : " "}] ${CUTOUT}`;
    if (command === `shell cmd overlay enable ${CUTOUT}`) { enabled = true; top = 171; }
    if (command === `shell cmd overlay disable ${CUTOUT}`) enabled = false; // Deliberately retain the stale native frame.
    if (command === "shell dumpsys window") return "mCurrentFocus=Window{abc u0 dev.hui.app.debug/dev.hui.app.MainActivity}";
    if (command.includes("uiautomator")) throw new Error("busy live UI never becomes accessibility-idle");
    return "";
  };
  return { run, calls, top: () => top, enabled: () => enabled };
};

test("ordinary portrait setup does not round trip even when the display is already portrait", () => {
  vi.stubEnv("ANDROID_SERIAL", "emulator-5554");
  try {
    const native = emulator();
    const display = androidDisplay(native.run);
    display.rotate("portrait");
    assert.deepEqual(native.calls.filter((call) => call.startsWith("shell settings put system user_rotation ")),
      ["shell settings put system user_rotation 0"]);
    assert.equal(native.top(), 171, "ordinary rotation does not rebuild SystemUI resources");
    display.restore();
  } finally { vi.unstubAllEnvs(); }
});

test("safe-display preparation refuses selected landscape without rotating it or capturing a portrait baseline", () => {
  vi.stubEnv("ANDROID_SERIAL", "emulator-5554");
  try {
    for (const prepared of [false, true]) {
      const native = emulator();
      const display = androidDisplay(native.run);
      if (prepared) display.prepare();
      display.rotate("landscape");
      const before = native.calls.length;
      assert.throws(() => display.prepare(), /requires portrait rotation/u);
      assert.deepEqual(native.calls.slice(before), ["shell dumpsys window displays"], "refusal only observes rotation");
      assert.match(native.run("shell", "dumpsys", "window", "displays"), /mRotation=1\b/u);
      display.restore();
      assert.deepEqual(native.calls.slice(-2), ["shell settings put system accelerometer_rotation 1", "shell settings put system user_rotation 0"]);
      assert.equal(native.calls.includes("shell dumpsys activity top"), prepared,
        "refusal preserves an existing portrait restoration baseline and never supplies a new one");
    }
  } finally { vi.unstubAllEnvs(); }
});

test("current viewport observes the attached IME frame without changing native state or requiring portrait CSS", async () => {
  const calls: string[] = [];
  let height = 2274;
  const display = androidDisplay((...args) => { calls.push(args.join(" ")); return ""; },
    async () => [nativeTarget("current", { height })]);
  const metrics = { width: 412, height: 867, ratio: 2.625, scale: 1 };
  assert.deepEqual(await display.viewportSize(metrics), { width: 412, height: 867 });
  height = 1518; // The IME has resized the same attached native WebView since phone setup.
  await assert.rejects(display.viewportSize(metrics), /viewport mismatch/u);
  assert.deepEqual(await display.viewportSize({ ...metrics, height: 578 }), { width: 412, height: 578 });
  height = 900;
  assert.deepEqual(await display.viewportSize({ ...metrics, height: 343 }), { width: 412, height: 343 });
  await assert.rejects(display.viewportSize({ ...metrics, ratio: 1 }), /viewport mismatch/u);
  assert.deepEqual(calls, [], "viewport reads never rotate, rebuild resources or inspect accessibility");
});

test("a stale native baseline and cutout cleanup both need a real configuration round trip", () => {
  vi.stubEnv("ANDROID_SERIAL", "emulator-5554");
  try {
    const native = emulator();
    for (let attempt = 0; attempt < 2; attempt++) {
      const display = androidDisplay(native.run);
      display.rotate("portrait");
      display.prepare();
      assert.equal(native.top(), 63);
      assert.ok(!native.calls.some((call) => call.includes("uiautomator")));
      assert.equal(display.cutout(), true);
      assert.equal(native.top(), 171);
      display.restore();
      assert.equal(native.enabled(), false);
      assert.equal(native.top(), 63);
    }
    const disabled = native.calls.indexOf(`shell cmd overlay disable ${CUTOUT}`);
    const rebuilt = native.calls.indexOf("shell settings put system user_rotation 1", disabled);
    const restored = native.calls.indexOf("shell settings put system accelerometer_rotation 1", rebuilt);
    assert.ok(disabled < rebuilt && rebuilt < restored, "resources rebuild before the original rotation flags are restored");
    assert.ok(native.calls.includes("shell dumpsys activity top"), "cleanup checks the effective native WebView, not only flags");
  } finally { vi.unstubAllEnvs(); }
});

test("a failed configuration refresh still restores both original rotation settings and every overlay", () => {
  vi.stubEnv("ANDROID_SERIAL", "emulator-5554");
  try {
    const native = emulator();
    let fail = false;
    const display = androidDisplay((...args) => {
      if (fail && args.join(" ") === "shell settings put system user_rotation 1") throw new Error("configuration failed");
      return native.run(...args);
    });
    display.rotate("portrait");
    display.prepare();
    display.cutout();
    fail = true;
    assert.throws(() => display.restore(), /configuration failed/u);
    assert.equal(native.enabled(), false);
    assert.deepEqual(native.calls.slice(-2), ["shell settings put system accelerometer_rotation 1", "shell settings put system user_rotation 0"]);
  } finally { vi.unstubAllEnvs(); }
});

test("display injection cannot alter a physical handset's settings", () => {
  vi.stubEnv("ANDROID_SERIAL", "physical-handset");
  try {
    const display = androidDisplay();
    assert.throws(() => display.rotate("landscape"), /isolated Android emulator/u);
    assert.throws(() => display.cutout(), /isolated Android emulator/u);
    display.restore();
  } finally {
    vi.unstubAllEnvs();
  }
});
