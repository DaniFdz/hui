// Owns deterministic native composer-picker geometry and open-lifecycle regressions.
import assert from "node:assert/strict";
import { test, type TestContext } from "vitest";
import { positionNativePicker } from "./home.ts";

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.onTestFinished(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

class TrackedTarget extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, callback, typeof options === "boolean" ? { capture: options } : options);
    if (!callback) return;
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, callback, typeof options === "boolean" ? { capture: options } : options);
    if (callback) this.listeners.get(type)?.delete(callback);
  }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}

function fixture(t: TestContext) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const viewport = Object.assign(new TrackedTarget(), { offsetTop: 0, offsetLeft: 0, width: 412, height: 867 });
  const windowTarget = Object.assign(new TrackedTarget(), {
    innerWidth: 412,
    innerHeight: 867,
    visualViewport: viewport,
    requestAnimationFrame(callback: FrameRequestCallback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  });
  replaceGlobal(t, "window", windowTarget);
  replaceGlobal(t, "requestAnimationFrame", windowTarget.requestAnimationFrame);
  replaceGlobal(t, "cancelAnimationFrame", windowTarget.cancelAnimationFrame);
  const properties = new Map<string, string>();
  const trigger = { top: 780.2798, right: 390.25, reads: 0, getBoundingClientRect() { this.reads++; return { top: this.top, bottom: this.top + 44, right: this.right }; } };
  const menu = {
    desiredHeight: 300,
    width: 240,
    shown: 0,
    hidden: 0,
    style: {
      getPropertyValue(name: string) { return properties.get(name) ?? ""; },
      setProperty(name: string, value: string) { properties.set(name, value); },
    },
    showPopover() { this.shown++; },
    hidePopover() { this.hidden++; },
    getBoundingClientRect() {
      return { width: this.width, height: Math.min(this.desiredHeight, Number.parseFloat(properties.get("--auto-size-available-height") ?? "Infinity")) };
    },
  };
  const details = Object.assign(new EventTarget(), {
    open: true,
    isConnected: true,
    querySelector(selector: string) { return selector === "summary" ? trigger : menu; },
  });
  const picker = details as unknown as HTMLDetailsElement;
  const position = () => positionNativePicker(picker);
  const frame = () => {
    assert.equal(frames.size, 1, "one open-picker frame is pending");
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    callback(0);
  };
  const px = (name: string) => Number.parseFloat(properties.get(name) ?? "NaN");
  const bounds = () => ({ left: px("left"), top: px("top"), ...menu.getBoundingClientRect() });
  return { frames, viewport, windowTarget, trigger, menu, details, position, frame, px, bounds };
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} should equal ${expected} without rounding`);
}

test("native picker stays above the Android keyboard and follows the next-frame anchor without another event", (t) => {
  const f = fixture(t);
  f.position();
  near(f.bounds().top + f.bounds().height, 780.2798 - 8); // Positioned before the first paint, too.
  f.frame();
  near(f.bounds().top + f.bounds().height, 780.2798 - 8);

  // Android delivers the viewport resize while the composer still has its old geometry.
  f.windowTarget.innerHeight = f.viewport.height = 578.2857;
  f.windowTarget.dispatchEvent(new Event("resize"));
  f.viewport.dispatchEvent(new Event("resize"));
  f.frame();
  let bounds = f.bounds();
  assert.ok(bounds.top >= 12);
  near(bounds.top + bounds.height, 578.2857 - 12);

  // The composer relayout follows in another frame, with no further viewport event.
  f.trigger.top = 524.3869;
  f.frame();
  bounds = f.bounds();
  near(bounds.top, 524.3869 - 8 - 300);
  near(bounds.top + bounds.height, 524.3869 - 8);
  assert.ok(bounds.top + bounds.height <= f.viewport.height - 12);
  f.details.open = false;
  f.position();
});

test("native picker uses the panned visual viewport and caps the menu to its available height", (t) => {
  const f = fixture(t);
  Object.assign(f.viewport, { offsetTop: 35.125, offsetLeft: 20.375, width: 300.5, height: 410.625 });
  f.menu.desiredHeight = 2000;
  f.position();
  f.frame();
  const bounds = f.bounds();
  near(f.px("--auto-size-available-height"), 410.625 - 24);
  near(bounds.top, 35.125 + 12);
  near(bounds.left + bounds.width, 20.375 + 300.5 - 12);
  near(bounds.top + bounds.height, 35.125 + 410.625 - 12);
  assert.ok(bounds.left >= f.viewport.offsetLeft + 12);
  assert.ok(bounds.height <= f.px("--auto-size-available-height"));
  f.details.open = false;
  f.position();
});

test("a picker near the viewport top opens below its trigger instead of collapsing", (t) => {
  const f = fixture(t);
  f.trigger.top = 20.125;
  f.position();
  near(f.bounds().top, 20.125 + 44 + 8);
  assert.ok(f.bounds().height >= 80);
  assert.ok(f.bounds().top + f.bounds().height <= f.viewport.height - 12);
  f.details.open = false;
  f.position();
});

test("open picker coalesces viewport bursts, avoids duplicate opens, and cleans up on close or detach before reopening", (t) => {
  const f = fixture(t);
  const listeners = (expected: number) => {
    for (const target of [f.windowTarget, f.viewport]) {
      assert.equal(target.count("resize"), expected);
      assert.equal(target.count("scroll"), expected);
    }
  };
  const burst = () => {
    for (const target of [f.windowTarget, f.viewport]) {
      target.dispatchEvent(new Event("resize"));
      target.dispatchEvent(new Event("scroll"));
      target.dispatchEvent(new Event("resize"));
    }
  };
  f.position();
  f.position();
  assert.equal(f.menu.shown, 1);
  listeners(1);
  const reads = f.trigger.reads;
  burst();
  assert.equal(f.frames.size, 1);
  assert.equal(f.trigger.reads, reads, "viewport events do not force synchronous layouts");
  f.frame();
  assert.equal(f.trigger.reads, reads + 1, "one geometry read per coalesced frame");
  burst();
  assert.equal(f.frames.size, 1);

  f.details.open = false;
  f.position(); // The details toggle callback closes the lane immediately.
  listeners(0);
  assert.equal(f.frames.size, 0);
  assert.ok(f.menu.hidden > 0);
  burst();
  assert.equal(f.frames.size, 0);

  f.details.open = true;
  f.position();
  listeners(1);
  assert.equal(f.menu.shown, 2);
  f.details.isConnected = false;
  f.frame(); // Removal needs no viewport or toggle event to clean up.
  listeners(0);
  assert.equal(f.frames.size, 0);
  burst();
  assert.equal(f.frames.size, 0);

  f.details.isConnected = true;
  f.position();
  listeners(1);
  assert.equal(f.menu.shown, 3);
  f.frame();
  f.details.open = false;
  f.position();
  listeners(0);
  assert.equal(f.frames.size, 0);
});
