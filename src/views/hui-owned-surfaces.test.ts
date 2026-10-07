import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { HUI_PAGES } from "../lib/pages.ts";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "../lib/settings.ts";
import { BOTS_LABS_HINT, renderOwnedSurface } from "./hui-owned-surfaces.ts";

const source = await readFile(new URL("./hui-owned-surfaces.ts", import.meta.url), "utf8");

/** A template's text with every nested template and value in place; handlers and directives drop out. */
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: readonly unknown[] };
    return template.strings.map((part, index) => part + (index < template.values.length ? text(template.values[index]) : "")).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** The template's handlers in document order. */
function handlers(value: unknown, found: Array<(event: unknown) => void> = []): Array<(event: unknown) => void> {
  if (typeof value === "function") found.push(value as (event: unknown) => void);
  else if (Array.isArray(value)) for (const item of value) handlers(item, found);
  else if (value && typeof value === "object" && "strings" in value && "values" in value) handlers((value as { values: unknown }).values, found);
  return found;
}

const LABS = HUI_PAGES.find((page) => page.id === "labs")!;
const labs = (settings: Settings, onSettings: (patch: Partial<Settings>) => void = () => {}) =>
  renderOwnedSurface({ page: LABS, settings, health: undefined, onSettings });

test("HUI-10 implements every retained HUI-owned surface", () => {
  for (const id of ["labs", "profile", "about"]) assert.match(source, new RegExp(`case \\"${id}\\"`));
  assert.doesNotMatch(source, /dashboards|dashboardWidgets/u);
  assert.match(source, /Experimental and opt-in features\./u);
  assert.match(source, /does not change PI/u);
});

test("Labs offers Bots, a preview that is off until turned on, beside the presentation flags", () => {
  const page = text(labs(DEFAULT_SETTINGS));
  assert.match(page, /Experimental and opt-in features\./u, "the subtitle fits more than presentation flags");
  assert.doesNotMatch(page, /HUI-only presentation flags/u);
  assert.ok(page.includes(`<span class="settings-row__title">Bots</span><span class="settings-row__desc">${BOTS_LABS_HINT}</span>`), "a Bots switch with its one-line hint");
  assert.ok(page.indexOf(">Bots<") < page.indexOf(">Dense observability<"), "first, before the presentation flags");
  assert.match(BOTS_LABS_HINT, /^Work in progress: named bots with their own chat, memory, SOUL\.md, routines and calls\. Off hides them, stops their turns and pauses their routines; nothing is deleted\.$/u);

  // Its switch saves the flag with the other Labs flags, both ways.
  const saved: Array<Partial<Settings>> = [];
  const off = normalizeSettings({ labs: { detailedDebug: true } });
  const [, change] = handlers(labs(off, (patch) => saved.push(patch)));
  change!({ currentTarget: { checked: true } });
  const on = normalizeSettings({ labs: { detailedDebug: true, bots: true } });
  handlers(labs(on, (patch) => saved.push(patch)))[1]!({ currentTarget: { checked: false } });
  assert.deepEqual(saved, [
    { labs: { denseObservability: false, detailedDebug: true, bots: true } },
    { labs: { denseObservability: false, detailedDebug: true, bots: false } },
  ]);
});

test("the Bots switch is the only one: its hint points nowhere else, on or off", () => {
  for (const settings of [DEFAULT_SETTINGS, normalizeSettings({ labs: { bots: true } })]) {
    const page = text(labs(settings));
    assert.ok(page.includes(`<span class="settings-row__desc">${BOTS_LABS_HINT}</span>`));
    assert.doesNotMatch(page, /Show the Bots tab|Settings → Sessions/u);
  }
});

test("settings render their optimistic snapshot before awaiting persistence", async () => {
  const app = await readFile(new URL("../hui-app.ts", import.meta.url), "utf8");
  const save = app.slice(app.indexOf("private async save("), app.indexOf("private chooseMode"));
  assert.match(save, /const pending = patchSettings\(patch\)/);
  assert.ok(save.indexOf("this.settings = currentSettings()") < save.indexOf("await pending"));
  assert.match(app, /private patchOwnedSettings[\s\S]*?void this\.save\(patch\)/);
  assert.doesNotMatch(app, /this\.save\(\{ \.\.\.this\.settings, \.\.\.patch \}\)/);
});
