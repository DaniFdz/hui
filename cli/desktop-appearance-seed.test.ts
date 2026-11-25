/** The seed `--fix` writes for the desktop app: the look a settings file names, and never the chat preferences. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { DEFAULT_LOOK, desktopAppearanceSeed, lookFromSettings, lookIsDefault } from "./desktop-appearance-seed.ts";

/** Shared byte for byte with `src/lib/appearance/look.fixture.json`: the device store and this export normalize the
 * same file to the same look (scripts/boundaries.test.mjs keeps the pair identical). */
const fixtures: { case: string; input: unknown; expected: Record<string, unknown> }[] = JSON.parse(
  readFileSync(new URL("./desktop-appearance-seed.fixture.json", import.meta.url), "utf8"),
);

test("the exported look is the same normalization the device store does", () => {
  for (const fixture of fixtures) assert.deepEqual(lookFromSettings(fixture.input), fixture.expected, fixture.case);
});

test("a look that only names HUI's defaults is not worth exporting", () => {
  assert.equal(lookIsDefault(lookFromSettings({})), true);
  assert.equal(lookIsDefault(lookFromSettings({ theme: "claw", themeMode: "system" })), true);
  assert.equal(lookIsDefault(lookFromSettings({ chat: { messageWidth: "wide" } })), true, "a chat preference is no look");
  for (const changed of [{ theme: "miami" }, { themeMode: "dark" }, { accent: "#ff5c5c" }, { fontUi: "geist" }, { fontChat: "lora" }, { textScale: 90 }]) {
    assert.equal(lookIsDefault(lookFromSettings(changed)), false, JSON.stringify(changed));
  }
  // The terminal font is only a default when it is the bundled one.
  assert.equal(lookIsDefault(lookFromSettings({ fontTerminal: "MesloLGS NF" })), false);
  assert.deepEqual(DEFAULT_LOOK, { theme: "claw", themeMode: "system", accent: "", fontUi: "instrument-sans", fontChat: "instrument-sans", fontTerminal: "JetBrains Mono", textScale: 100 });
});

test("the seed names its format, the gateway and when it was written", () => {
  const seed = desktopAppearanceSeed(lookFromSettings({ theme: "miami" }), { gatewayName: " build-box ", machineHostname: "other", exportedAt: new Date("2026-11-16T10:00:00.000Z") });
  assert.deepEqual(seed, {
    format: 1,
    gateway: "build-box",
    exportedAt: "2026-11-16T10:00:00.000Z",
    appearance: { ...DEFAULT_LOOK, theme: "miami" },
  });
  // An unnamed gateway reports this machine's name, as `GET /__hui/health` does.
  assert.equal(desktopAppearanceSeed(DEFAULT_LOOK, { machineHostname: " geekom " }).gateway, "geekom");
  assert.equal(desktopAppearanceSeed(DEFAULT_LOOK, { machineHostname: "  " }).gateway, "HUI");
});
