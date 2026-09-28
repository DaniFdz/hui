import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./hui-owned-surfaces.ts", import.meta.url), "utf8");

test("HUI-10 implements every retained HUI-owned surface", () => {
  for (const id of ["labs", "profile", "about"]) assert.match(source, new RegExp(`case \\"${id}\\"`));
  assert.doesNotMatch(source, /dashboards|dashboardWidgets/u);
  assert.match(source, /HUI-only presentation flags/u);
  assert.match(source, /does not change PI/u);
});

test("settings render their optimistic snapshot before awaiting persistence", async () => {
  const app = await readFile(new URL("../hui-app.ts", import.meta.url), "utf8");
  const save = app.slice(app.indexOf("private async save("), app.indexOf("private chooseMode"));
  assert.match(save, /const pending = patchSettings\(patch\)/);
  assert.ok(save.indexOf("this.settings = currentSettings()") < save.indexOf("await pending"));
  assert.match(app, /private patchOwnedSettings[\s\S]*?void this\.save\(patch\)/);
  assert.doesNotMatch(app, /this\.save\(\{ \.\.\.this\.settings, \.\.\.patch \}\)/);
});
