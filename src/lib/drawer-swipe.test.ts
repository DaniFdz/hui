import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DRAWER_SWIPE_EDGE_PX,
  DRAWER_SWIPE_FLING_MIN_PX,
  DRAWER_SWIPE_FLING_PX_PER_MS,
  DRAWER_SWIPE_INTENT_PX,
  DRAWER_SWIPE_OPEN_RATIO,
  drawerSwipeFollows,
  drawerSwipeOpens,
  drawerSwipeProgress,
  startsAtDrawerEdge,
} from "./drawer-swipe.ts";

test("a swipe may only start in the screen's left edge strip", () => {
  assert.equal(startsAtDrawerEdge(0), true);
  assert.equal(startsAtDrawerEdge(DRAWER_SWIPE_EDGE_PX), true);
  assert.equal(startsAtDrawerEdge(DRAWER_SWIPE_EDGE_PX + 1), false);
  assert.equal(startsAtDrawerEdge(-1), false);
  assert.equal(startsAtDrawerEdge(200), false);
});

test("a drag commits to the drawer only once it moves rightwards rather than scrolling or selecting", () => {
  assert.equal(drawerSwipeFollows(DRAWER_SWIPE_INTENT_PX - 1, 0), false);
  assert.equal(drawerSwipeFollows(DRAWER_SWIPE_INTENT_PX, 0), true);
  assert.equal(drawerSwipeFollows(40, 20), true);
  // A mostly vertical drag is a scroll; a leftwards one is not this gesture.
  assert.equal(drawerSwipeFollows(30, 30), false);
  assert.equal(drawerSwipeFollows(-60, 2), false);
});

test("the drawer follows the finger for exactly the share of its width the finger uncovered", () => {
  assert.equal(drawerSwipeProgress(0, 360), 0);
  assert.equal(drawerSwipeProgress(90, 360), 0.25);
  assert.equal(drawerSwipeProgress(360, 360), 1);
  assert.equal(drawerSwipeProgress(700, 360), 1);
  assert.equal(drawerSwipeProgress(-40, 360), 0);
  // Without a laid-out drawer there is nothing to follow.
  assert.equal(drawerSwipeProgress(90, 0), 0);
});

test("letting go opens past a third of the drawer or on a fling, and closes below both", () => {
  const width = 360;
  assert.equal(drawerSwipeOpens(width * DRAWER_SWIPE_OPEN_RATIO, width, 0), true);
  assert.equal(drawerSwipeOpens(width * DRAWER_SWIPE_OPEN_RATIO - 1, width, 0), false);
  assert.equal(drawerSwipeOpens(DRAWER_SWIPE_FLING_MIN_PX, width, DRAWER_SWIPE_FLING_PX_PER_MS), true);
  assert.equal(drawerSwipeOpens(DRAWER_SWIPE_FLING_MIN_PX - 1, width, 4), false);
  assert.equal(drawerSwipeOpens(120, width, DRAWER_SWIPE_FLING_PX_PER_MS - 0.01), false);
  // Dragging back past the edge never opens it.
  assert.equal(drawerSwipeOpens(-80, width, 4), false);
  assert.equal(drawerSwipeOpens(100, 0, 4), false);
});
