import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DIFF_LIST_WIDTH,
  FILES_NAV_WIDTH,
  maxPanelWidth,
  normalizePanelWidth,
  readPanelWidth,
  rememberPanelWidth,
} from "./panel-width.ts";

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test("a panel width is rounded and kept within its own bounds", () => {
  assert.equal(FILES_NAV_WIDTH.defaultWidth, 260);
  assert.equal(FILES_NAV_WIDTH.min, 200);
  assert.equal(FILES_NAV_WIDTH.max, 640);
  assert.equal(DIFF_LIST_WIDTH.defaultWidth, 280);
  assert.equal(DIFF_LIST_WIDTH.min, 220);
  assert.equal(DIFF_LIST_WIDTH.max, 640);
  assert.equal(normalizePanelWidth(320, FILES_NAV_WIDTH), 320);
  assert.equal(normalizePanelWidth(319.6, FILES_NAV_WIDTH), 320);
  assert.equal(normalizePanelWidth(10, FILES_NAV_WIDTH), FILES_NAV_WIDTH.min);
  assert.equal(normalizePanelWidth(4000, FILES_NAV_WIDTH), FILES_NAV_WIDTH.max);
  assert.equal(normalizePanelWidth("318", FILES_NAV_WIDTH), 318);
  assert.equal(normalizePanelWidth(500, DIFF_LIST_WIDTH), 500);
  assert.equal(normalizePanelWidth(10, DIFF_LIST_WIDTH), DIFF_LIST_WIDTH.min);
  assert.equal(normalizePanelWidth(4000, DIFF_LIST_WIDTH), DIFF_LIST_WIDTH.max);
  for (const junk of [null, "", "  ", "wide", Number.NaN, Infinity, {}, []]) {
    assert.equal(normalizePanelWidth(junk, FILES_NAV_WIDTH), FILES_NAV_WIDTH.defaultWidth, String(junk));
  }
});

test("the list leaves the content its room when the pane is narrow", () => {
  assert.equal(maxPanelWidth(0, FILES_NAV_WIDTH, 240), FILES_NAV_WIDTH.max);
  assert.equal(maxPanelWidth(560, FILES_NAV_WIDTH, 240), 320);
  assert.equal(maxPanelWidth(1022, FILES_NAV_WIDTH, 240), FILES_NAV_WIDTH.max);
  assert.equal(maxPanelWidth(400, FILES_NAV_WIDTH, 240), FILES_NAV_WIDTH.min);
  assert.equal(maxPanelWidth(0, DIFF_LIST_WIDTH, 320), DIFF_LIST_WIDTH.max);
  assert.equal(maxPanelWidth(700, DIFF_LIST_WIDTH, 320), 380);
  assert.equal(maxPanelWidth(400, DIFF_LIST_WIDTH, 320), DIFF_LIST_WIDTH.min);
});

test("a chosen width is read back from the browser and only the normalized value is written", () => {
  const memory = store();
  assert.equal(readPanelWidth(FILES_NAV_WIDTH, memory), FILES_NAV_WIDTH.defaultWidth);
  assert.equal(rememberPanelWidth(FILES_NAV_WIDTH, 318.4, memory), 318);
  assert.equal(memory.values.get(FILES_NAV_WIDTH.storageKey), "318");
  assert.equal(readPanelWidth(FILES_NAV_WIDTH, memory), 318);
  assert.equal(rememberPanelWidth(DIFF_LIST_WIDTH, 4000, memory), DIFF_LIST_WIDTH.max);
  assert.equal(memory.values.get(DIFF_LIST_WIDTH.storageKey), "640");
  assert.equal(readPanelWidth(DIFF_LIST_WIDTH, memory), DIFF_LIST_WIDTH.max);
  assert.equal(readPanelWidth(FILES_NAV_WIDTH, store({ [FILES_NAV_WIDTH.storageKey]: "wide" })), FILES_NAV_WIDTH.defaultWidth);
});
