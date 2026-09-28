import assert from "node:assert/strict";
import test from "node:test";
import { paneTrackSizes, sessionPaneGeometry } from "./session-pane-geometry.ts";
import { moveSessionPane, resizeSessionLayout, singleSessionLayout, splitSessionPane } from "./session-multiplexer.ts";

test("tracks redistribute constrained space and overflow rather than overlap", () => {
  assert.deepEqual(paneTrackSizes(1006, [0.5, 0.5], 320), [500, 500]);
  assert.deepEqual(paneTrackSizes(1006, [0.15, 0.85], 320), [320, 680]);
  assert.deepEqual(paneTrackSizes(400, [0.5, 0.5], 320), [320, 320]);
  assert.deepEqual(paneTrackSizes(1212, [0.05, 0.05, 0.9], 320), [320, 320, 560]);
});

test("flat pane geometry retains independent row sizes and correctly sized resize hit areas", () => {
  let layout = splitSessionPane(singleSessionLayout("a"), "p1", "b", "right");
  layout = splitSessionPane(layout, "p2", "c", "down");
  layout = resizeSessionLayout(layout, "c2", 0, 0.7);
  const geometry = sessionPaneGeometry(layout, 1006, 606);
  assert.deepEqual(geometry.panes.get("p1"), { left: 0, top: 0, width: 500, height: 606 });
  assert.deepEqual(geometry.panes.get("p2"), { left: 506, top: 0, width: 500, height: 400 });
  assert.deepEqual(geometry.panes.get("p3"), { left: 506, top: 406, width: 500, height: 200 });
  assert.equal(geometry.dividers.find(({ columnId }) => columnId)?.extent, 600);
  assert.equal(geometry.dividers.find(({ columnId }) => !columnId)?.extent, 1000);
  const moved = sessionPaneGeometry(moveSessionPane(layout, "p1", "p3", { kind: "center" }), 1006, 606);
  assert.deepEqual(moved.panes.get("p1"), geometry.panes.get("p3"));
  assert.deepEqual(moved.panes.get("p3"), geometry.panes.get("p1"));
  assert.equal(moved.panes.size, 3);
});
