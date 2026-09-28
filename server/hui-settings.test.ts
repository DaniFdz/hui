import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHuiSettingsAt } from "./hui-settings.ts";

test("reads normalized disabled skill preferences without touching PI settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-settings-"));
  const path = join(directory, "settings.json");
  await writeFile(path, JSON.stringify({
    disabledSkills: [{ name: "review", path: "/skills/review/SKILL.md" }],
  }));
  const settings = await readHuiSettingsAt(path);
  assert.deepEqual(settings.disabledSkills, [{ name: "review", path: "/skills/review/SKILL.md" }]);
});

test("missing HUI settings use defaults", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-settings-"));
  assert.deepEqual((await readHuiSettingsAt(join(directory, "missing.json"))).disabledSkills, []);
  assert.deepEqual((await readHuiSettingsAt(join(directory, "missing.json"))).models, {
    primary: "",
    fallback: "",
    utility: "",
  });
});

test("normalizes HUI-owned model routes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-settings-"));
  const path = join(directory, "settings.json");
  await writeFile(path, JSON.stringify({
    models: {
      primary: " openai/gpt-5.6-luna ",
      fallback: "anthropic/claude-haiku-4-5",
      utility: "not-a-model",
    },
  }));
  assert.deepEqual((await readHuiSettingsAt(path)).models, {
    primary: "openai/gpt-5.6-luna",
    fallback: "anthropic/claude-haiku-4-5",
    utility: "",
  });
});
