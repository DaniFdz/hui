import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const source = readFileSync(new URL("./media-viewer.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/media-viewer.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "u").exec(styles)?.[1] ?? "";
}

test("the viewer pads itself for the safe areas the top layer would otherwise ignore", () => {
  const dialog = declarations(".hui-media-viewer");
  // border-box keeps 100vw/100dvh the outer size, so the padding does not scroll.
  assert.match(dialog, /box-sizing:\s*border-box;/u);
  assert.equal(
    /padding:([^;]+);/u.exec(dialog)?.[1]?.replace(/\s+/gu, " ").trim(),
    "var(--safe-area-top, 0px) var(--safe-area-right, 0px) var(--safe-area-bottom, 0px) var(--safe-area-left, 0px)",
  );
});

test("opening the viewer focuses the dialog, so iOS never paints the stage's keyboard ring around the picture", () => {
  assert.doesNotMatch(source, /autofocus/u);
  // Explicitly focusable: focus() lands on the dialog in every engine.
  assert.match(source, /<dialog class="hui-media-viewer" tabindex="-1"/u);
  assert.match(source, /dialog\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(styles, /\.hui-media-viewer:focus,\s*\.hui-media-viewer:focus-visible \{ outline: none; \}/u);
  // The ring stays for a keyboard reaching the pan surface.
  assert.match(styles, /\.hui-media-viewer__stage:focus-visible \{ box-shadow: inset 0 0 0 2px var\(--accent\); \}/u);
});
