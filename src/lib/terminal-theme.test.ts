import assert from "node:assert/strict";
import test from "node:test";
import { luminance, parseRgb, terminalTheme } from "./terminal-theme.ts";

const white = { r: 255, g: 255, b: 255 };
const ink = { r: 30, g: 30, b: 30 };
const accent = { r: 0, g: 100, b: 255 };

test("a dark theme keeps Gespenst's dark ANSI palette and uses the accent for cursor and selection", () => {
  const theme = terminalTheme({ background: ink, foreground: white, accent });
  assert.equal(theme.appearance, "dark");
  assert.deepEqual(theme.background, ink);
  assert.deepEqual(theme.foreground, white);
  assert.deepEqual(theme.cursor, accent);
  assert.deepEqual(theme.cursorAccent, ink);
  assert.equal("yellow" in theme, false, "unset: Gespenst's default palette applies");
  assert.ok(luminance(theme.selectionBackground) > luminance(ink));
});

test("a light theme gets a palette whose normal colors stay legible on its background", () => {
  const theme = terminalTheme({ background: white, foreground: ink, accent });
  assert.equal(theme.appearance, "light");
  const contrast = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const color = { r: value >> 16, g: (value >> 8) & 255, b: value & 255 };
    return (1.05) / (luminance(color) + 0.05);
  };
  for (const name of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const) {
    assert.ok(contrast(theme[name] ?? "#ffffff") >= 4.5, `${name} reads on white`);
  }
});

test("computed sRGB colors parse; other syntaxes are rejected", () => {
  assert.deepEqual(parseRgb("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3 });
  assert.deepEqual(parseRgb("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30 });
  assert.deepEqual(parseRgb("rgb(255 128.4 0)"), { r: 255, g: 128, b: 0 });
  assert.equal(parseRgb("oklch(0.5 0.1 200)"), undefined);
});
