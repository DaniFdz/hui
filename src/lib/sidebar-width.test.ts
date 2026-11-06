import assert from "node:assert/strict";
import { test, vi } from "vitest";

async function load(stored: string | null) {
  vi.resetModules();
  const store = new Map<string, string>();
  if (stored !== null) store.set("hui.sidebar-width", stored);
  const properties = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal("document", { documentElement: { style: { setProperty: (name: string, value: string) => void properties.set(name, value) } } });
  return { module: await import("./sidebar-width.ts"), store, properties };
}

test("a dragged width is clamped to the handle's bounds and junk falls back to the default", async () => {
  const { module } = await load(null);
  assert.equal(module.SIDEBAR_WIDTH_DEFAULT, 258);
  assert.equal(module.normalizeSidebarWidth(320), 320);
  assert.equal(module.normalizeSidebarWidth(319.6), 320);
  assert.equal(module.normalizeSidebarWidth(10), module.SIDEBAR_WIDTH_MIN);
  assert.equal(module.normalizeSidebarWidth(4000), module.SIDEBAR_WIDTH_MAX);
  assert.equal(module.normalizeSidebarWidth("318"), 318);
  for (const junk of [null, "", "  ", "wide", Number.NaN, Infinity, {}, []]) {
    assert.equal(module.normalizeSidebarWidth(junk), module.SIDEBAR_WIDTH_DEFAULT, String(junk));
  }
});

test("applying a width sets the shell's variable and remembers it only when asked", async () => {
  const { module, store, properties } = await load(null);
  assert.equal(module.applySidebarWidth(320), 320);
  assert.equal(properties.get("--hui-sidebar-width"), "320px");
  assert.equal(store.has("hui.sidebar-width"), false);
  assert.equal(module.applySidebarWidth(1200, true), module.SIDEBAR_WIDTH_MAX);
  assert.equal(properties.get("--hui-sidebar-width"), "460px");
  assert.equal(store.get("hui.sidebar-width"), "460");
});

test("the sidebar starts at the width it was left at, and at the default when that one is gone", async () => {
  assert.equal((await load("318")).module.sidebarWidth(), 318);
  assert.equal((await load("wide")).module.sidebarWidth(), 258);
  assert.equal((await load(null)).module.sidebarWidth(), 258);
});
