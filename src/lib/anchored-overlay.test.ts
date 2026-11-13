// Owns picker collision regressions against the same Floating UI middleware as Web Awesome.
import assert from "node:assert/strict";
import { test } from "vitest";
import { computePosition, flip, offset, shift, size } from "@floating-ui/core";
import { pickerAnchorInViewport } from "./anchored-overlay.ts";

const anchor = { x: 253.9345245361328, y: 599.15478515625, width: 121.68452453613281, height: 32 };
const menu = { width: 243.04762268066406, height: 98.51786041259766 };

async function position(height: number, clamp: boolean) {
  const reference = clamp ? pickerAnchorInViewport(anchor, { offsetTop: 0, height }) : anchor;
  return computePosition({} as Element, {} as HTMLElement, {
    placement: "bottom-end",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 12 }), size({ padding: 8 })],
    platform: {
      getElementRects: async () => ({ reference, floating: { x: 0, y: 0, ...menu } }),
      getClippingRect: async () => ({ x: 0, y: 0, width: 412.19049072265625, height }),
      getDimensions: async () => menu,
      isRTL: async () => false,
    },
  });
}

test("the measured offscreen native picker anchor cannot push its menu under the real IME", async () => {
  const height = 578.2857055664062;
  const old = await position(height, false);
  assert.ok(old.y + menu.height > height, "the old middleware reproduces the measured native clipping");
  for (const available of [height, 564, 867.047607421875]) {
    const placed = await position(available, true);
    assert.ok(placed.y >= 8, `top ${placed.y} clears the viewport padding`);
    assert.ok(placed.y + menu.height <= available - 8, `the entire popup clears the IME: ${placed.y + menu.height} > ${available - 8}`);
  }
});

test("clamping preserves the real anchor width and horizontal position, including a panned viewport", () => {
  const visible = pickerAnchorInViewport(anchor, { offsetTop: 35, height: 410 });
  assert.equal(visible.x, anchor.x);
  assert.equal(visible.width, anchor.width);
  assert.equal(visible.top, 437);
  assert.equal(visible.bottom, 437);
  const normal = { ...anchor, y: 100 };
  const unchanged = pickerAnchorInViewport(normal, { offsetTop: 0, height: 867 });
  assert.equal(unchanged.y, normal.y);
  assert.equal(unchanged.height, normal.height);
});
