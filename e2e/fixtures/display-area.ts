/** Measures Android's real safe display and WebView frame, and maps CSS boxes into display coordinates. No page padding is injected. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator } from "e2e";
import { CDP_PORT } from "./phone.ts";

export type Box = { x: number; y: number; width: number; height: number };
export type Insets = { top?: number; right?: number; bottom?: number; left?: number };
/** All readings use CSS-sized display pixels, including the native bars outside the WebView. */
export type DisplayArea = { width: number; height: number; top: number; right: number; bottom: number; left: number; box(target: Locator): Promise<Box> };
export type PageMetrics = { width: number; height: number; ratio: number; scale: number };
const PACKAGE = "dev.hui.app.debug";
// This stock overlay has a 171-physical-pixel notch, taller than API 36's already-48dp status bar.
const CUTOUT = "com.android.internal.emulation.pixel_3_xl";
const adb = (...args: string[]) => execFileSync(process.env["ADB"] ?? "adb", [
  ...(process.env["ANDROID_SERIAL"] ? ["-s", process.env["ANDROID_SERIAL"]] : []), ...args,
], { encoding: "utf8", timeout: 30_000 }).trim();

const rect = (match: RegExpMatchArray | null, label: string): Box => {
  if (!match) throw new Error(`display measurement: missing ${label}`);
  const [x, y, right, bottom] = match.slice(1).map(Number) as [number, number, number, number];
  if (right <= x || bottom <= y) throw new Error(`display measurement: empty ${label}`);
  return { x, y, width: right - x, height: bottom - y };
};

/** Insets come from the window manager, independently of the WebView whose fitting is under test. */
export function parseDisplay(state: string) {
  const display = rect(state.match(/mDisplayFrame=Rect\((\d+), (\d+) - (\d+), (\d+)\)/u), "display frame");
  const bar = (name: string) => rect(state.match(new RegExp(`type=${name} frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\] visible=true`, "u")), name);
  const status = bar("statusBars");
  const navigation = bar("navigationBars");
  const cutout = state.match(/mDisplayCutout=DisplayCutout\{insets=Rect\((\d+), (\d+) - (\d+), (\d+)\)/u);
  if (!cutout) throw new Error("display measurement: missing cutout insets");
  const [left, top, right, bottom] = cutout.slice(1).map(Number) as [number, number, number, number];
  if (display.x !== 0 || display.y !== 0 || status.y !== 0 || navigation.y <= status.height || navigation.x !== 0) {
    throw new Error("display measurement currently requires a portrait display with top/bottom system bars");
  }
  return { width: display.width, height: display.height, left, top: Math.max(top, status.height),
    right: display.width - right, bottom: Math.min(display.height - bottom, navigation.y), cutoutTop: top };
}

/** UIAutomator reports actual native view bounds, not DOM padding or CDP's emulated viewport. */
export function parseWebView(xml: string): Box {
  const nodes: string[] = [];
  const ancestors: boolean[] = [];
  for (const [node] of xml.matchAll(/<node\b[^>]*>|<\/node>/gu)) {
    if (node === "</node>") { ancestors.pop(); continue; }
    const nativeView = node.includes('class="android.webkit.WebView"') && node.includes(`package="${PACKAGE}"`);
    // Chromium's accessibility document is itself labelled WebView and can round its bounds beyond its native parent.
    if (nativeView && !ancestors.includes(true)) nodes.push(node);
    if (!node.endsWith("/>")) ancestors.push(nativeView);
  }
  if (nodes.length !== 1) throw new Error(`display measurement: expected one HUI WebView, found ${nodes.length}`);
  return rect(nodes[0]!.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u), "WebView bounds");
}

export function displayBox(box: Box, frame: Box, ratio: number): Box {
  return { ...box, x: frame.x / ratio + box.x, y: frame.y / ratio + box.y };
}

/** Rejects emulated metrics and unsafe native fitting before any DOM box can be mistaken for physical evidence. */
export function validateNativeFrame(safe: ReturnType<typeof parseDisplay>, frame: Box, metrics: PageMetrics): void {
  const { ratio } = metrics;
  if (!(ratio > 0) || metrics.scale !== 1 || Math.abs(frame.width / ratio - metrics.width) > 1 || Math.abs(frame.height / ratio - metrics.height) > 1) {
    throw new Error(`native frame / CSS viewport mismatch: ${JSON.stringify({ frame, metrics })}`);
  }
  if (frame.y < safe.top || frame.y + frame.height > safe.bottom || frame.x < safe.left || frame.x + frame.width > safe.right) {
    throw new Error(`WebView overlaps system chrome: ${JSON.stringify({ frame, safe })}`);
  }
}

/** A test owns its cutout overlays and rotation; cleanup restores effective frames, not just settings flags. */
export function androidDisplay(run = adb) {
  let original: { name: string; enabled: boolean }[] | undefined;
  let evidence: string | undefined;
  let captures = 0;
  let rotation: { key: string; value: string }[] | undefined;
  let originalRotation: number | undefined;
  let baseline: ReturnType<typeof parseDisplay> | undefined;
  const displayState = () => run("shell", "dumpsys", "window", "displays");
  const rotationOf = (state: string) => {
    const value = state.match(/^\s*mRotation=([0-3])\b/mu)?.[1];
    if (value === undefined) throw new Error("display measurement: missing effective rotation");
    return Number(value);
  };
  const waitFor = (label: string, accepts: (state: string) => boolean) => {
    const deadline = Date.now() + 10_000;
    let state: string;
    do {
      state = displayState();
      if (accepts(state)) return state;
    } while (Date.now() < deadline);
    throw new Error(`native display did not reach ${label}: ${state}`);
  };
  const rememberRotation = () => {
    if (rotation) return;
    originalRotation = rotationOf(displayState());
    rotation = ["accelerometer_rotation", "user_rotation"].map((key) => ({ key, value: run("shell", "settings", "get", "system", key) }));
  };
  const setRotation = (value: number) => {
    run("shell", "settings", "put", "system", "user_rotation", String(value));
    return waitFor(`rotation ${value}`, (state) => rotationOf(state) === value);
  };
  const refreshConfiguration = (value: number) => {
    // API 36 can retain the notch-sized SystemUI window after its resource overlay is disabled.
    // A real configuration round trip rebuilds those bounds; resource/overlay flags alone cannot prove it.
    run("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    setRotation((value + 1) % 4);
    return setRotation(value);
  };
  const requireEmulator = () => {
    const serial = process.env["ANDROID_SERIAL"] ?? run("get-serialno");
    if (!/^emulator-\d+$/u.test(serial)) throw new Error("Display injection and rotation require an isolated Android emulator, not a physical handset.");
  };
  return {
    rotate(orientation: "portrait" | "landscape") {
      requireEmulator();
      rememberRotation();
      run("shell", "settings", "put", "system", "accelerometer_rotation", "0");
      if (orientation === "portrait") refreshConfiguration(0);
      else setRotation(1);
    },
    prepare() {
      requireEmulator();
      if (!baseline) {
        if (!rotation) {
          rememberRotation();
          refreshConfiguration(0);
        }
        baseline = parseDisplay(displayState());
      }
      run("shell", "uiautomator", "dump", "/sdcard/hui-safe-display.xml");
      const xml = run("shell", "cat", "/sdcard/hui-safe-display.xml");
      // The fresh app asks about notifications. Dismiss that real system dialog rather than measuring a covered page.
      if (xml.includes("Allow HUI to send you notifications?")) {
        const deny = xml.match(/<node\b[^>]*resource-id="com\.android\.permissioncontroller:id\/permission_deny(?:_and_dont_ask_again)?_button"[^>]*>/u)?.[0];
        const box = rect(deny?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u) ?? null, "notification refusal");
        run("shell", "input", "tap", String(Math.round(box.x + box.width / 2)), String(Math.round(box.y + box.height / 2)));
      }
    },
    async target(): Promise<string> {
      const pages = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.json()) as { type: string; id: string }[];
      const targets = pages.filter(({ type }) => type === "page");
      if (targets.length !== 1) throw new Error(`expected one live native page, got ${targets.length}`);
      return targets[0]!.id;
    },
    cutout() {
      requireEmulator();
      if (original) return false;
      original = [...run("shell", "cmd", "overlay", "list").matchAll(/^\[([ x])\] (com\.android\.internal\.(?:display\.cutout\.emulation\.|emulation\.pixel_)[\w.]+)$/gmu)]
        .map(([, enabled, name]) => ({ name: name!, enabled: enabled === "x" }));
      if (!original.some(({ name }) => name === CUTOUT)) throw new Error("the emulator has no Pixel 3 XL cutout overlay");
      for (const { name, enabled } of original) if (enabled) run("shell", "cmd", "overlay", "disable", name);
      run("shell", "cmd", "overlay", "enable", CUTOUT);
      return true;
    },
    restore() {
      const failures: unknown[] = [];
      const restore = (...args: string[]) => { try { run(...args); } catch (error) { failures.push(error); } };
      // Restore resources before rebuilding their effective SystemUI frame. Attempt all settings on failure.
      for (const { name, enabled } of original ?? []) {
        if (enabled || name === CUTOUT) restore("shell", "cmd", "overlay", enabled ? "enable" : "disable", name);
      }
      if (rotation) {
        try {
          refreshConfiguration(originalRotation!);
          if (baseline && originalRotation === 0) {
            waitFor("the original safe display", (state) => JSON.stringify(parseDisplay(state)) === JSON.stringify(baseline));
            // Activity's native hierarchy is available even while Chromium's accessibility root reconnects.
            // This is a cleanup barrier only; test evidence still uses the independent UIAutomator bounds.
            waitFor("the original native WebView frame", () => {
              const hierarchy = run("shell", "dumpsys", "activity", "top");
              const bounds = hierarchy.match(/com\.getcapacitor\.CapacitorWebView\{[^\n]* (\d+),(\d+)-(\d+),(\d+) /u);
              return bounds?.[2] === String(baseline!.top) && bounds[4] === String(baseline!.bottom);
            });
          }
        } catch (error) { failures.push(error); }
        finally {
          for (const { key, value } of rotation) restore("shell", "settings", value === "null" ? "delete" : "put", "system", key, ...(value === "null" ? [] : [value]));
        }
        rotation = undefined;
      }
      original = undefined;
      baseline = undefined;
      if (failures.length) throw new AggregateError(failures, `could not restore native display settings: ${failures.map(String).join("; ")}`);
    },
    ready(metrics: PageMetrics): boolean {
      const safe = parseDisplay(adb("shell", "dumpsys", "window", "displays"));
      if (original && safe.cutoutTop <= 0) return false;
      if (Math.abs(metrics.height * metrics.ratio - (safe.bottom - safe.top)) >= 3) {
        throw new Error(`waiting for actual native viewport: ${JSON.stringify({ safe, metrics })}`);
      }
      return true;
    },
    measure(metrics: PageMetrics): DisplayArea {
      const state = adb("shell", "dumpsys", "window", "displays");
      const safe = parseDisplay(state);
      if (original && safe.cutoutTop <= 0) throw new Error("the requested native cutout is not effective yet");
      adb("shell", "uiautomator", "dump", "/sdcard/hui-safe-display.xml");
      const frame = parseWebView(adb("shell", "cat", "/sdcard/hui-safe-display.xml"));
      const { ratio } = metrics;
      validateNativeFrame(safe, frame, metrics);
      evidence ??= mkdtempSync(join(tmpdir(), "hui-safe-display-"));
      const capture = join(evidence, String(++captures));
      writeFileSync(`${capture}.json`, JSON.stringify({ safe, frame, metrics }, null, 2));
      writeFileSync(`${capture}.png`, execFileSync(process.env["ADB"] ?? "adb", [
        ...(process.env["ANDROID_SERIAL"] ? ["-s", process.env["ANDROID_SERIAL"]] : []), "exec-out", "screencap", "-p",
      ], { timeout: 30_000 }));
      console.log(`Native display evidence: ${capture} ${JSON.stringify({ safe, frame, metrics })}`);
      return { width: safe.width / ratio, height: safe.height / ratio, top: safe.top / ratio, right: safe.right / ratio,
        bottom: safe.bottom / ratio, left: safe.left / ratio, box: async (target) => {
          const box = await target.boundingBox();
          if (!box) throw new Error("display measurement: the target is not laid out");
          const translated = displayBox(box, frame, ratio);
          writeFileSync(`${capture}-controls.jsonl`, `${JSON.stringify({ css: box, display: translated })}\n`, { flag: "a" });
          return translated;
        } };
    },
  };
}
