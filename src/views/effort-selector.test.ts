import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { effortState, shownThinking } from "./effort-selector.ts";

const source = readFileSync(new URL("./effort-selector.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/openclaw-chat.css", import.meta.url), "utf8");

test("the effort scale is gradual from Off to the model's highest level", () => {
  const levels = ["off", "minimal", "low", "medium", "high"];
  assert.deepEqual(levels.map((level) => effortState(level, levels).fraction), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(levels.map((level) => effortState(level, levels).index), [0, 1, 2, 3, 4]);
  assert.equal(effortState("low", levels).boost, "");
  assert.equal(effortState("high", levels).boost, "max", "the model's own highest level keeps its glow");
});

test("a saved level the model lacks fits to its highest PI level, never to Ultra", () => {
  assert.deepEqual(effortState("xhigh", ["off", "minimal", "low", "medium", "high"]), {
    level: "high", unset: false, index: 4, fraction: 1, boost: "max",
  });
  assert.equal(shownThinking("xhigh", ["off", "minimal", "low", "medium", "high", "ultra"]), "high");
  assert.equal(shownThinking("max", ["off", "low", "medium", "high"]), "high");
});

test("Ultra is its own stop with its own boost, and a runtime without it sends the model's highest", () => {
  const durable = ["off", "low", "medium", "high", "max", "ultra"];
  assert.deepEqual(effortState("ultra", durable), { level: "ultra", unset: false, index: 5, fraction: 1, boost: "ultra" });
  assert.equal(effortState("max", durable).boost, "max");
  assert.equal(shownThinking("ultra", ["off", "low", "high"]), "high");
});

test("no level is the unset state, not Off", () => {
  assert.deepEqual(effortState("", ["off", "low", "high"]), { level: "off", unset: true, index: 0, fraction: 0, boost: "" });
});

test("an empty model report offers PI's levels", () => {
  assert.deepEqual(effortState("", undefined).level, "off");
  assert.equal(effortState("max", []).boost, "max");
  assert.equal(effortState("high", []).boost, "");
  assert.equal(effortState("ultra", undefined).level, "max", "a runtime without Ultra sends the highest level");
});

test("the selector draws every stop, the gauge's filled arc and Ultra's orbit", () => {
  assert.match(source, /data-state=\$\{at < state\.index \? "passed" : at === state\.index \? "current" : "ahead"\}/u);
  assert.match(source, /stroke-dasharray="100" stroke-dashoffset=\$\{100 - state\.fraction \* 100\}/u);
  assert.match(source, /class="chat-controls__reasoning-spectrum"/u);
  assert.match(source, /state\.boost === "ultra" \? html`<circle class="chat-controls__effort-gauge-orbit"/u);
  assert.match(source, /class="chat-controls__effort-default-action"/u);
});

test("the styles fill, grow and animate with the level; Ultra moves differently from Maximum", () => {
  assert.match(styles, /\.chat-controls__reasoning-spectrum::before\s*\{[^}]*clip-path: inset\(0 calc\(\(1 - var\(--effort-fill, 0\)\) \* 100%\) 0 0\);/su);
  assert.match(styles, /\.chat-controls__reasoning-range::-webkit-slider-thumb\s*\{[^}]*width: calc\(24px \+ 10px \* var\(--effort-fill, 0\)\);/su);
  assert.match(styles, /\[data-effort-boost="ultra"\] \.chat-controls__effort-gauge-orbit\s*\{\s*animation: chat-effort-ultra-orbit 2\.6s linear infinite;/su);
  assert.match(styles, /\[data-effort-boost="max"\] \.chat-controls__effort-gauge-arc\s*\{\s*animation: chat-effort-max-breathe/su);
  assert.match(styles, /\[data-effort-boost="ultra"\] \.chat-controls__reasoning-spectrum::after\s*\{\s*animation: chat-effort-ultra-shine 2\.6s linear infinite;/su);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)/u);
});
