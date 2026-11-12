/** Guards independent native-frame parsing and CSS-to-display mapping, including failures that must not look safe. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { displayBox, parseDisplay, parseWebView, validateNativeFrame } from "./display-area.ts";

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
