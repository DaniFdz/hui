import assert from "node:assert/strict";
import { test } from "vitest";

import { cardGridColumns, cardGridStyle } from "./card-grid.ts";

test("card rows stay full: the columns follow the card count instead of the available width", () => {
  assert.equal(cardGridColumns(6), 3, "six cards make two rows of three, not four and two");
  assert.equal(cardGridColumns(9), 3, "nine cards make three rows of three");
  assert.equal(cardGridColumns(4), 4, "four cards fill one row");
  assert.equal(cardGridColumns(2), 2);
  assert.equal(cardGridColumns(1), 1);
  assert.equal(cardGridColumns(5), 3, "three and two leaves no row with a single card");
  assert.equal(cardGridColumns(7), 4, "four and three");
  assert.equal(cardGridColumns(10), 4, "three rows: four, four and two");
});

test("a card stack tolerates an empty or broken count", () => {
  assert.equal(cardGridColumns(0), 1);
  assert.equal(cardGridColumns(-3), 1);
  assert.equal(cardGridColumns(6.7), 3);
  assert.equal(cardGridColumns(6, 2), 2);
  assert.equal(cardGridColumns(6, 0), 1);
});

test("the style carries a column count for each layout the card grid draws", () => {
  assert.equal(cardGridStyle(6), "--hui-card-grid-columns:3;--hui-card-grid-columns-compact:2;--hui-card-grid-columns-phone:1");
  assert.equal(cardGridStyle(1), "--hui-card-grid-columns:1;--hui-card-grid-columns-compact:1;--hui-card-grid-columns-phone:1");
  assert.equal(cardGridStyle(3), "--hui-card-grid-columns:3;--hui-card-grid-columns-compact:2;--hui-card-grid-columns-phone:1");
});
