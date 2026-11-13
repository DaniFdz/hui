import assert from "node:assert/strict";
import { nothing, type PropertyValues } from "lit";
import { afterEach, test, vi } from "vitest";
import * as browserApi from "../api/browser.ts";
import { forgetRecentBrowserFrames } from "../controllers/browser-view-controller.ts";
import { BrowserPreview } from "./browser-preview.ts";

class Preview extends BrowserPreview {
  change(values: Partial<Pick<BrowserPreview, "sessionId" | "live" | "visible" | "onScreen" | "now">>) {
    const changed = new Map(Object.keys(values).map((key) => [key, this[key as keyof this]]));
    Object.assign(this, values);
    super.willUpdate(changed as PropertyValues);
  }
}

class Socket {
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  close() { this.closed = true; }
  state() {
    this.onmessage?.({ data: JSON.stringify({ type: "state", running: true, mode: "headless",
      tabs: [{ id: "t1", title: "Fixture", url: "http://127.0.0.1/" }], current: "t1", watching: "t1", following: true }) });
  }
  frame() {
    const header = new TextEncoder().encode(JSON.stringify({ tabId: "t1", width: 1280, height: 800, seq: 1 }));
    const bytes = new Uint8Array(4 + header.length + 4);
    new DataView(bytes.buffer).setUint32(0, header.length);
    bytes.set(header, 4);
    bytes.set([0xff, 0xd8, 0xff, 0xd9], 4 + header.length);
    this.onmessage?.({ data: bytes.buffer });
  }
}

const previews: Preview[] = [];
afterEach(() => {
  for (const preview of previews.splice(0)) preview.disconnectedCallback();
  forgetRecentBrowserFrames();
});

function harness() {
  const opens: { socket: Socket; resolve: () => void }[] = [];
  vi.spyOn(browserApi, "connectBrowserView").mockImplementation(() => new Promise<WebSocket>((resolve) => {
    const socket = new Socket();
    opens.push({ socket, resolve: () => resolve(socket as unknown as WebSocket) });
  }));
  const preview = new Preview();
  previews.push(preview);
  preview.change({ sessionId: "alpha", live: true, visible: true, onScreen: true });
  return { preview, opens };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

for (const hidden of ["visible", "onScreen"] as const) {
  for (const order of ["hide then end", "end and hide together", "end while shown"] as const) {
    test(`a stream cancelled before its first frame recovers once: ${hidden}, ${order}`, async () => {
      const { preview, opens } = harness();
      assert.equal(opens.length, 1);
      // The HTTP socket lease is still in flight: neither state nor a frame has arrived.
      if (order === "hide then end") {
        preview.change({ [hidden]: false });
        preview.change({ live: false });
      } else if (order === "end and hide together") {
        preview.change({ live: false, [hidden]: false });
      } else preview.change({ live: false });
      assert.equal(opens.length, order === "end while shown" ? 2 : 1, "hidden cards do not open a final snapshot");
      opens[0]!.resolve();
      await settle();
      assert.equal(opens[0]!.socket.closed, true, "an in-flight stream lease is cancelled");
      preview.change({ [hidden]: true });
      assert.equal(opens.length, 2, "a cancelled stream is not a completed snapshot");
      opens[1]!.resolve();
      await settle();
      opens[1]!.socket.state();
      opens[1]!.socket.frame();
      assert.equal(opens[1]!.socket.closed, true, "the final snapshot stops after one frame");
      assert.notEqual(preview.render(), nothing, "the idle card now has a real decoded frame");
      for (let tick = 0; tick < 20; tick += 1) {
        preview.change({ now: Date.now() + tick * 15_000 });
        preview.change({ [hidden]: false });
        preview.change({ [hidden]: true });
      }
      assert.equal(opens.length, 2, "clock updates and revisiting an idle card do not poll");
    });
  }
}

test("a visible stream keeps its last frame at turn end without an extra snapshot", async () => {
  const { preview, opens } = harness();
  opens[0]!.resolve();
  await settle();
  opens[0]!.socket.state();
  opens[0]!.socket.frame();
  preview.change({ live: false });
  assert.equal(opens[0]!.socket.closed, true);
  assert.notEqual(preview.render(), nothing);
  preview.change({ visible: false });
  preview.change({ visible: true });
  assert.equal(opens.length, 1);
});

test("a cached frame is not a frame received by the current stream", async () => {
  const previous = harness();
  previous.opens[0]!.resolve();
  await settle();
  previous.opens[0]!.socket.state();
  previous.opens[0]!.socket.frame();
  previous.preview.disconnectedCallback();

  const { preview, opens } = harness();
  assert.notEqual(preview.render(), nothing, "the new live card paints the cached page immediately");
  preview.change({ live: false });
  assert.equal(opens.length, 2, "the cached page cannot suppress the current turn's final snapshot");
});

test("a turn ending while hidden refreshes once even if its stream had an earlier frame", async () => {
  const { preview, opens } = harness();
  opens[0]!.resolve();
  await settle();
  opens[0]!.socket.state();
  opens[0]!.socket.frame();
  preview.change({ visible: false });
  assert.equal(opens[0]!.socket.closed, true, "hiding the card stops streaming immediately");
  preview.change({ live: false });
  assert.equal(opens.length, 1);
  preview.change({ visible: true });
  assert.equal(opens.length, 2, "the hidden turn's final page is captured on return");
});
