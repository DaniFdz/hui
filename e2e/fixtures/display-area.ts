/** Measures Android's real safe display and WebView frame, and maps CSS boxes into display coordinates. No page padding is injected. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator } from "e2e";
import { CDP_PORT, phoneLayoutFrame, refusePhoneNotificationPrompt } from "./phone.ts";
import { attachedNativeTarget, type NativeTarget } from "../../scripts/phone-native-target.ts";

const nativeTargets = async (): Promise<NativeTarget[]> => {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`native target discovery failed: ${response.status}`);
  return response.json() as Promise<NativeTarget[]>;
};

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

/** Android WebView DevTools reports the attached native View's physical screen frame, not emulated CSS metrics. */
export function nativeFrame(targets: NativeTarget[]): Box {
  const target = attachedNativeTarget(targets);
  if (!target) throw new Error("display measurement: no attached native WebView");
  const info = JSON.parse(target.description!) as Record<string, unknown>;
  const values = [info["screenX"], info["screenY"], info["width"], info["height"]];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
    || !(Number(info["width"]) > 0 && Number(info["height"]) > 0)) {
    throw new Error(`display measurement: malformed native frame: ${target.description}`);
  }
  const [x, y, width, height] = values as [number, number, number, number];
  return { x, y, width, height };
}

export function displayBox(box: Box, frame: Box, ratio: number): Box {
  return { ...box, x: frame.x / ratio + box.x, y: frame.y / ratio + box.y };
}

/** Matches the live CSS viewport to its attached native frame, including an IME-resized frame. */
function validateViewport(frame: Box, metrics: PageMetrics): void {
  const { ratio } = metrics;
  if (!(ratio > 0) || metrics.scale !== 1 || Math.abs(frame.width / ratio - metrics.width) > 1 || Math.abs(frame.height / ratio - metrics.height) > 1) {
    throw new Error(`native frame / CSS viewport mismatch: ${JSON.stringify({ frame, metrics })}`);
  }
}

/** Rejects emulated metrics and unsafe native fitting before any DOM box can be mistaken for physical evidence. */
export function validateNativeFrame(safe: ReturnType<typeof parseDisplay>, frame: Box, metrics: PageMetrics): void {
  validateViewport(frame, metrics);
  if (frame.y < safe.top || frame.y + frame.height > safe.bottom || frame.x < safe.left || frame.x + frame.width > safe.right) {
    throw new Error(`WebView overlaps system chrome: ${JSON.stringify({ frame, safe })}`);
  }
}

/** A native buffer must have reached SurfaceFlinger for the currently focused, drawn HUI window.
 * Attachment and CSS geometry do not prove this: rotation/activity recreation can expose a blank transition surface. */
export function nativePaint(windows: string, layers: string, latency: (layer: string) => string, queuedNs = "0") {
  const window = windows.match(/^\s*mCurrentFocus=Window\{(\w+) u\d+ dev\.hui\.app\.debug\/dev\.hui\.app\.MainActivity\}/mu)?.[1];
  if (!window) return;
  const section = windows.split(/(?=^  Window #\d+ Window\{)/mu).find((part) => part.startsWith("  Window #") && part.includes(`Window{${window} `));
  if (!section || !section.includes("mHasSurface=true isReadyForDisplay()=true")
    || !/Surface: shown=true\s+mDrawState=HAS_DRAWN\b/u.test(section) || !/^\s*isOnScreen=true$/mu.test(section)) return;
  // The buffer layer is a child of this exact WindowState, not an outgoing Activity at the same URL.
  const parent = layers.match(new RegExp(`(?:^|RequestedLayerState\\{)${window} dev\\.hui\\.app\\.debug/dev\\.hui\\.app\\.MainActivity#(\\d+)\\b`, "mu"))?.[1];
  if (!parent) return;
  const layer = layers.match(new RegExp(`(?:^|RequestedLayerState\\{)(dev\\.hui\\.app\\.debug/dev\\.hui\\.app\\.MainActivity#\\d+) parentId=${parent}\\b`, "mu"))?.[1];
  if (!layer) return;
  let presented = 0n;
  for (const row of latency(layer).trim().split("\n").slice(1)) {
    const fields = row.trim().split(/\s+/u);
    if (fields.length !== 3 || !fields.every((value) => /^\d+$/u.test(value))) continue;
    const actual = BigInt(fields[1]!);
    if (actual > presented && actual < 9223372036854775807n) presented = actual;
  }
  if (presented > 0n && presented >= BigInt(queuedNs)) return { window, layer, presentedNs: String(presented) };
}

/** The most recently queued native render must complete; an old frame in latency history cannot satisfy it.
 * An already idle window may pass without manufacturing another damage frame. gfxinfo is scoped to HUI's process. */
export function queuedNativeFrame(stats: string): string | undefined {
  let latest: { vsync: bigint; queued: bigint; completed: bigint } | undefined;
  for (const block of stats.split("---PROFILEDATA---").filter((_, index) => index % 2 === 1)) {
    const [header, ...rows] = block.trim().split("\n");
    const columns = header!.split(",");
    const field = (row: string[], name: string) => {
      const value = row[columns.indexOf(name)];
      return value && /^\d+$/u.test(value) ? BigInt(value) : 0n;
    };
    for (const line of rows) {
      const row = line.split(",");
      if (row[0] !== "0") continue;
      const vsync = field(row, "IntendedVsync");
      if (!latest || vsync > latest.vsync) latest = { vsync, queued: field(row, "SwapBuffers"), completed: field(row, "FrameCompleted") };
    }
  }
  if (latest && latest.queued > 0n && latest.completed >= latest.queued && latest.completed < 9223372036854775807n) return String(latest.queued);
}

/** A test owns its cutout overlays and rotation; cleanup restores effective frames, not just settings flags. */
export function androidDisplay(run = adb, targets = nativeTargets) {
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
      setRotation(orientation === "portrait" ? 0 : 1);
    },
    prepare() {
      requireEmulator();
      // parseDisplay's safe-area oracle supports portrait top/bottom bars only. Refuse rather than rotate a caller.
      if (rotationOf(displayState()) !== 0) throw new Error("native safe display measurement requires portrait rotation; prepare preserves the selected orientation");
      if (!baseline) {
        rememberRotation();
        refreshConfiguration(0);
        baseline = parseDisplay(displayState());
      }
      refusePhoneNotificationPrompt(run);
    },
    async viewportSize(metrics: PageMetrics): Promise<{ width: number; height: number }> {
      validateViewport(nativeFrame(await targets()), metrics);
      return { width: metrics.width, height: metrics.height };
    },
    async target(): Promise<string> {
      const target = attachedNativeTarget(await targets());
      if (!target) throw new Error("display measurement: no attached native WebView");
      return target.id;
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
            // This cleanup barrier is independent of DevTools' physical frame used by test evidence.
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
      const safe = parseDisplay(displayState());
      if (original && safe.cutoutTop <= 0) return false;
      if (Math.abs(metrics.height * metrics.ratio - (safe.bottom - safe.top)) >= 3) {
        throw new Error(`waiting for actual native viewport: ${JSON.stringify({ safe, metrics })}`);
      }
      return true;
    },
    async measure(metrics: PageMetrics): Promise<DisplayArea> {
      // RAF is page layout readiness, not Android presentation. Wait for the latest actual native render to present.
      const readPaint = (queuedNs = "0") => nativePaint(run("shell", "dumpsys", "window", "-a"), run("shell", "dumpsys", "SurfaceFlinger", "--list"),
        (layer) => run("shell", "dumpsys", "SurfaceFlinger", "--latency", layer), queuedNs);
      const layout = await phoneLayoutFrame();
      const deadline = Date.now() + 10_000;
      let paint: ReturnType<typeof nativePaint>;
      let queuedNs: string | undefined;
      do {
        queuedNs = queuedNativeFrame(run("shell", "dumpsys", "gfxinfo", PACKAGE, "framestats"));
        paint = queuedNs ? readPaint(queuedNs) : undefined;
        if (paint) break;
      } while (Date.now() < deadline);
      if (!paint) throw new Error("native display has not presented its latest completed foreground render");
      if (attachedNativeTarget(await targets())?.id !== layout.target) throw new Error("native window changed during paint readiness");
      const state = displayState();
      const safe = parseDisplay(state);
      if (original && safe.cutoutTop <= 0) throw new Error("the requested native cutout is not effective yet");
      const frame = nativeFrame(await targets());
      const { ratio } = metrics;
      validateNativeFrame(safe, frame, metrics);
      evidence ??= mkdtempSync(join(tmpdir(), "hui-safe-display-"));
      const capture = join(evidence, String(++captures));
      writeFileSync(`${capture}.png`, execFileSync(process.env["ADB"] ?? "adb", [
        ...(process.env["ANDROID_SERIAL"] ? ["-s", process.env["ANDROID_SERIAL"]] : []), "exec-out", "screencap", "-p",
      ], { timeout: 30_000 }));
      const after = readPaint();
      if (!after || after.window !== paint.window || after.layer !== paint.layer
        || attachedNativeTarget(await targets())?.id !== layout.target) throw new Error("native window changed during the one-shot physical capture");
      writeFileSync(`${capture}.json`, JSON.stringify({ safe, frame, metrics, readiness: { layout, queuedNs, paint, after } }, null, 2));
      console.log(`Native display evidence: ${capture} ${JSON.stringify({ safe, frame, metrics, readiness: { layout, queuedNs, paint, after } })}`);
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
