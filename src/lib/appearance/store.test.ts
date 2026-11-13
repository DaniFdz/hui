/** The device store's boundary: normalization, the storage adapter, and two devices on one gateway keeping their own. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  APPEARANCE_KEY,
  APPEARANCE_VERSION,
  DEFAULT_CHAT_APPEARANCE,
  DEFAULT_DEVICE_APPEARANCE,
  normalizeDeviceAppearance,
  readAppearance,
  saveAppearance,
  type AppearanceStorage,
} from "./store.ts";

/** One device's localStorage: independent of any other, and as refusing as the operator's browser needs it to be. */
function storage(initial?: string, options: { refuse?: boolean } = {}): AppearanceStorage & { value: () => string | null } {
  let value = initial ?? null;
  return {
    getItem: (key: string) => (key === APPEARANCE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (options.refuse) throw new DOMException("quota", "QuotaExceededError");
      if (key === APPEARANCE_KEY) value = next;
    },
    value: () => value,
  };
}

const stored = (patch: object) => JSON.stringify({ version: APPEARANCE_VERSION, ...patch });

/** Shared byte for byte with `cli/desktop-appearance-seed.fixture.json`: the look HUI exports for HUI's desktop app
 * must normalize exactly as this store does (scripts/boundaries.test.mjs keeps the pair identical). */
const lookFixtures: { case: string; input: unknown; expected: Record<string, unknown> }[] = JSON.parse(
  readFileSync(new URL("./look.fixture.json", import.meta.url), "utf8"),
);

test("a settings file normalizes to the same look this store keeps, and no chat preference reaches it", () => {
  for (const fixture of lookFixtures) {
    const { chat: _chat, ...look } = normalizeDeviceAppearance(fixture.input);
    assert.deepEqual(look, fixture.expected, fixture.case);
  }
});

test("a device with nothing stored starts from HUI's defaults, not the gateway's old values", () => {
  assert.deepEqual(readAppearance(storage()), DEFAULT_DEVICE_APPEARANCE);
  assert.deepEqual(readAppearance(undefined), DEFAULT_DEVICE_APPEARANCE);
  assert.deepEqual(DEFAULT_DEVICE_APPEARANCE, {
    theme: "claw",
    themeMode: "system",
    accent: "",
    fontUi: "instrument-sans",
    fontChat: "instrument-sans",
    fontTerminal: "JetBrains Mono",
    textScale: 100,
    chat: { messageWidth: "comfortable", collapseTaskProgress: false, sendShortcut: "enter", githubEmbeds: true, datadogEmbeds: true },
  });
});

test("a corrupt, foreign or older record reads as the defaults and never throws", () => {
  for (const record of ["{", "null", "[]", "nope", JSON.stringify({ theme: "miami" }), JSON.stringify({ version: 2, theme: "miami" }), JSON.stringify({ version: "1", theme: "miami" })]) {
    assert.deepEqual(readAppearance(storage(record)), DEFAULT_DEVICE_APPEARANCE, record);
  }
  const unreadable: AppearanceStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => undefined };
  assert.deepEqual(readAppearance(unreadable), DEFAULT_DEVICE_APPEARANCE);
});

test("every stored value passes the validator the Appearance page uses", () => {
  assert.deepEqual(
    normalizeDeviceAppearance({ theme: "  miami ", themeMode: "dark", accent: " #5B9CF6 ", fontUi: "geist", fontChat: "lora", fontTerminal: " MesloLGS NF ", textScale: 125 }),
    {
      theme: "miami",
      themeMode: "dark",
      accent: "#5b9cf6",
      fontUi: "geist",
      fontChat: "lora",
      fontTerminal: "MesloLGS NF",
      textScale: 125,
      chat: DEFAULT_CHAT_APPEARANCE,
    },
  );
  const junk = normalizeDeviceAppearance({
    theme: 42, themeMode: "chartreuse", accent: "red", fontUi: {}, fontChat: [], fontTerminal: "bad;name", textScale: "big",
    chat: { messageWidth: "huge", collapseTaskProgress: "yes", sendShortcut: "space", githubEmbeds: "no", datadogEmbeds: 0 },
  });
  assert.deepEqual(junk, DEFAULT_DEVICE_APPEARANCE);
});

test("an unknown theme id is kept, so a missing theme file is not a forgotten choice", () => {
  assert.equal(normalizeDeviceAppearance({ theme: "not-installed" }).theme, "not-installed");
  assert.equal(normalizeDeviceAppearance({ theme: "  spaced  " }).theme, "spaced");
  assert.equal(normalizeDeviceAppearance({ theme: "   " }).theme, "claw");
});

test("the chat preferences keep the enums, and both previews are opt-out", () => {
  assert.deepEqual(normalizeDeviceAppearance({ chat: { messageWidth: "wide", collapseTaskProgress: true, sendShortcut: "modifierEnter", githubEmbeds: false, datadogEmbeds: false } }).chat, {
    messageWidth: "wide", collapseTaskProgress: true, sendShortcut: "modifierEnter", githubEmbeds: false, datadogEmbeds: false,
  });
  assert.deepEqual(normalizeDeviceAppearance({ chat: { githubEmbeds: null, datadogEmbeds: null } }).chat, DEFAULT_CHAT_APPEARANCE);
});

test("a saved choice round-trips under one versioned key", () => {
  const device = storage();
  const saved = saveAppearance({ theme: "miami", textScale: 140 }, device);
  assert.equal(saved?.theme, "miami");
  assert.deepEqual(JSON.parse(device.value() ?? "{}"), { version: APPEARANCE_VERSION, ...DEFAULT_DEVICE_APPEARANCE, theme: "miami", textScale: 140 });
  assert.deepEqual(readAppearance(device), { ...DEFAULT_DEVICE_APPEARANCE, theme: "miami", textScale: 140 });
});

test("a patch keeps what the device already chose", () => {
  const device = storage(stored({ theme: "miami", chat: { ...DEFAULT_CHAT_APPEARANCE, sendShortcut: "modifierEnter" } }));
  saveAppearance({ accent: "#ff8066" }, device);
  const kept = readAppearance(device);
  assert.equal(kept.theme, "miami");
  assert.equal(kept.accent, "#ff8066");
  assert.equal(kept.chat.sendShortcut, "modifierEnter");
});

test("a write the browser refuses resolves undefined instead of pretending it landed", () => {
  assert.equal(saveAppearance({ theme: "miami" }, storage(undefined, { refuse: true })), undefined);
});

test("two devices on one gateway keep their own appearance", () => {
  const laptop = storage();
  const phone = storage();
  saveAppearance({ theme: "miami", themeMode: "dark", fontUi: "lora" }, laptop);
  saveAppearance({ theme: "rose", chat: { ...DEFAULT_CHAT_APPEARANCE, messageWidth: "compact" } }, phone);
  assert.deepEqual(readAppearance(laptop), { ...DEFAULT_DEVICE_APPEARANCE, theme: "miami", themeMode: "dark", fontUi: "lora" });
  assert.deepEqual(readAppearance(phone), { ...DEFAULT_DEVICE_APPEARANCE, theme: "rose", chat: { ...DEFAULT_CHAT_APPEARANCE, messageWidth: "compact" } });
  // Nothing either device wrote is visible to the other, and nothing was written twice.
  saveAppearance({ theme: "claw" }, laptop);
  assert.equal(readAppearance(phone).theme, "rose");
  assert.equal(JSON.parse(laptop.value() ?? "{}").theme, "claw");
});
