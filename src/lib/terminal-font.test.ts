import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.ts";
import { readFileSync } from "node:fs";
import { DEFAULT_TERMINAL_FONT, loadTerminalFont, NERD_FONT_SYMBOLS, normalizeTerminalFont, terminalFontStack } from "./terminal-font.ts";

test("terminal fonts migrate independently and round-trip custom local families", () => {
  assert.equal(normalizeSettings({ fontUi: "geist" }).fontTerminal, DEFAULT_TERMINAL_FONT);
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, fontTerminal: "  MesloLGS NF  " });
  assert.equal(settings.fontTerminal, "MesloLGS NF");
  assert.equal(settings.fontUi, DEFAULT_SETTINGS.fontUi);
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.equal(normalizeTerminalFont("字体 Mono"), "字体 Mono");
  assert.equal(terminalFontStack("MesloLGS NF"), '"MesloLGS NF", "HUI Nerd Font Symbols", "JetBrains Mono", ui-monospace, monospace');
});

test("empty, malformed and unbounded font names fall back safely", () => {
  for (const value of [undefined, null, 42, "", " ", "a".repeat(129), "a\nb", 'a"b', "a'b", "a\\b", "a,b", "a; color: red", "<font>"]) {
    assert.equal(normalizeTerminalFont(value), DEFAULT_TERMINAL_FONT);
  }
});

test("the terminal font uses the themed settings picker instead of a native datalist", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../views/settings.ts", import.meta.url), "utf8");
  assert.match(source, /id: "settings-font-terminal"/);
  assert.match(source, /customOption: \(query\) => normalizeTerminalFont\(query\) === query/);
  assert.doesNotMatch(source, /<datalist id="terminal-fonts"/);
});

test("a bundled Nerd Font symbols face backs every terminal font stack", () => {
  const css = readFileSync(new URL("../../public/fonts/symbols-nerd-font-mono.css", import.meta.url), "utf8");
  const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
  assert.ok(tokens.includes('@import url("/fonts/symbols-nerd-font-mono.css");'));
  assert.match(css, new RegExp(`font-family: "${NERD_FONT_SYMBOLS}";`));
  // Only Nerd Font code points; letters keep coming from the chosen font.
  assert.match(css, /unicode-range: U\+23FB-23FE, U\+2B58, U\+E000-F8FF, U\+F0000-FFFFD;/);
  assert.ok(readFileSync(new URL("../../public/fonts/symbols-nerd-font-mono.woff2", import.meta.url)).byteLength > 1_000_000);
  assert.match(readFileSync(new URL("../../public/fonts/symbols-nerd-font-mono-LICENSE.txt", import.meta.url), "utf8"), /MIT License/);
  for (const font of ["JetBrains Mono", "FiraCode Nerd Font Mono", "not-a-font"]) {
    assert.ok(terminalFontStack(font).indexOf(`"${NERD_FONT_SYMBOLS}"`) > terminalFontStack(font).indexOf(`"${font}"`));
  }
});

test("terminal font loading requests the icon face with Nerd Font sample text", async () => {
  const calls: [string, string | undefined][] = [];
  await loadTerminalFont("FiraCode Nerd Font Mono", { load: async (font, text) => { calls.push([font, text]); return []; } });
  assert.deepEqual(calls, [[`13px ${terminalFontStack("FiraCode Nerd Font Mono")}`, "M\u{E0B0}\u{F0001}"]]);
  await loadTerminalFont("x", { load: async () => { throw new Error("blocked"); } });
});
