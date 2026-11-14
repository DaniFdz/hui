/** The exported look's adoption: it seeds a device that never chose, and never overrides one that did. */
import assert from "node:assert/strict";
import { test } from "vitest";

import { adoptAppearanceSeed, seededLook } from "./desktop-seed.ts";
import { APPEARANCE_KEY, APPEARANCE_VERSION, DEFAULT_DEVICE_APPEARANCE, readAppearance, type AppearanceStorage } from "./store.ts";

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

const SEED = {
  format: 1,
  gateway: "build-box",
  exportedAt: "2026-11-16T10:00:00.000Z",
  appearance: { theme: "miami", themeMode: "dark", accent: "#5b9cf6", fontUi: "geist", fontChat: "lora", fontTerminal: "MesloLGS NF", textScale: 125 },
};

/** A shell that offers one seed and records whether it was told the seed landed. */
function shell(seed: unknown, options: { fails?: boolean } = {}) {
  const report = { consumed: 0, asked: 0 };
  return {
    report,
    bridge: {
      appearanceSeed: async () => {
        report.asked += 1;
        if (options.fails) throw new Error("no shell answer");
        return seed;
      },
      markAppearanceSeedConsumed: () => { report.consumed += 1; },
    },
  };
}

test("a device that never chose adopts the exported look and consumes the seed", async () => {
  const device = storage();
  const { bridge, report } = shell(SEED);
  assert.equal(await adoptAppearanceSeed(device, bridge), true);
  assert.deepEqual(readAppearance(device), { ...DEFAULT_DEVICE_APPEARANCE, ...SEED.appearance });
  assert.deepEqual(JSON.parse(device.value() ?? "{}"), { version: APPEARANCE_VERSION, ...DEFAULT_DEVICE_APPEARANCE, ...SEED.appearance });
  assert.deepEqual(report, { asked: 1, consumed: 1 });
});

test("a device that already chose keeps its appearance and never asks for the seed", async () => {
  const device = storage(JSON.stringify({ version: APPEARANCE_VERSION, theme: "rose", themeMode: "light" }));
  const { bridge, report } = shell(SEED);
  assert.equal(await adoptAppearanceSeed(device, bridge), false);
  assert.equal(readAppearance(device).theme, "rose");
  assert.equal(readAppearance(device).themeMode, "light");
  assert.deepEqual(report, { asked: 0, consumed: 0 }, "the shell is not even asked");
});

test("a record that exists but names no appearance is still an empty device", async () => {
  const device = storage(JSON.stringify({ version: APPEARANCE_VERSION }));
  const { bridge } = shell(SEED);
  assert.equal(await adoptAppearanceSeed(device, bridge), true);
  assert.equal(readAppearance(device).theme, "miami");
});

test("only the look travels: a seed's chat preferences are ignored", async () => {
  const device = storage();
  const { bridge } = shell({ appearance: { ...SEED.appearance, chat: { messageWidth: "wide", sendShortcut: "modifierEnter" } } });
  assert.equal(await adoptAppearanceSeed(device, bridge), true);
  assert.deepEqual(readAppearance(device).chat, DEFAULT_DEVICE_APPEARANCE.chat);
  assert.deepEqual(seededLook({ appearance: { chat: { messageWidth: "wide" } } }), undefined, "a seed of habits alone seeds nothing");
});

test("a refused write leaves the device and the seed alone, so a later launch can still seed it", async () => {
  const device = storage(undefined, { refuse: true });
  const { bridge, report } = shell(SEED);
  assert.equal(await adoptAppearanceSeed(device, bridge), false);
  assert.deepEqual(report, { asked: 1, consumed: 0 });
});

test("a browser, a shell that cannot answer and a seed with no look all change nothing", async () => {
  const device = storage();
  assert.equal(await adoptAppearanceSeed(device), false, "no shell at all");
  assert.equal(await adoptAppearanceSeed(device, {}), false, "a shell without the bridge");
  assert.equal(await adoptAppearanceSeed(device, shell(SEED, { fails: true }).bridge), false, "the shell did not answer");
  assert.equal(await adoptAppearanceSeed(device, shell({ format: 1 }).bridge), false, "a seed without a look");
  assert.equal(device.value(), null);
  assert.deepEqual(readAppearance(device), DEFAULT_DEVICE_APPEARANCE);
});
