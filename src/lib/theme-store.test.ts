import assert from "node:assert/strict";
import test from "node:test";

import { accentOverrideTokens, builtinPalette } from "./theme-store.ts";

test("accent overrides the same semantic roles as OpenClaw", () => {
  const tokens = accentOverrideTokens("#a78bfa");

  for (const token of ["--ring", "--accent", "--accent-muted", "--primary"]) {
    assert.equal(tokens[token], "#a78bfa");
  }
  assert.equal(tokens["--accent-subtle"], "color-mix(in srgb, var(--accent) 16%, transparent)");
  assert.equal(tokens["--accent-glow"], "color-mix(in srgb, var(--accent) 30%, transparent)");
  assert.equal(tokens["--focus"], "color-mix(in srgb, var(--ring) 22%, transparent)");
  assert.equal(tokens["--focus-ring"], "0 0 0 2px var(--bg), 0 0 0 3px color-mix(in srgb, var(--ring) 80%, transparent)");
  assert.equal(tokens["--focus-glow"], "0 0 0 2px var(--bg), 0 0 0 3px var(--ring), 0 0 16px var(--accent-glow)");
});

test("accent foreground keeps readable contrast", () => {
  for (const [accent, ink] of [
    ["#f5b942", "#000000"], ["#5b9cf6", "#000000"],
    ["#a78bfa", "#000000"], ["#777777", "#000000"],
    ["#747474", "#ffffff"], ["#2563eb", "#ffffff"],
  ] as const) {
    const tokens = accentOverrideTokens(accent);
    assert.equal(tokens["--primary-foreground"], ink, accent);
    assert.equal(tokens["--accent-foreground"], ink, accent);
  }
});

test("native palettes never replace a user theme with the same name", () => {
  for (const id of ["claw", "rose", "miami"]) {
    assert.equal(builtinPalette({ id, name: id, url: `/__hui/themes/file/builtin/${id}.json` }), id);
    assert.equal(builtinPalette({ id, name: id, url: `/__hui/themes/file/user/${id}.json` }), undefined);
  }
});
