import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { readHuiSettingsAt, normalizeSettings, DEFAULT_SETTINGS } from "./hui-settings.ts";

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
    thinking: "",
    routes: [],
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
    thinking: "",
    routes: [],
  });
});

test("the default reasoning keeps a PI level and drops Ultra or an unknown one", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-settings-"));
  const path = join(directory, "settings.json");
  const level = async (thinking: unknown) => {
    await writeFile(path, JSON.stringify({ models: { thinking } }));
    return (await readHuiSettingsAt(path)).models.thinking;
  };
  assert.equal(await level(" high "), "", "levels are exact, not trimmed");
  assert.equal(await level("high"), "high");
  assert.equal(await level("max"), "max");
  assert.equal(await level("ultra"), "", "Ultra is the session's own choice, not a default");
  assert.equal(await level("turbo"), "");
  assert.equal(await level(7), "");
});

const fixtures: { input: unknown; expected: ReturnType<typeof normalizeSettings> }[] = JSON.parse(readFileSync(new URL("./hui-settings.fixture.json", import.meta.url), "utf8"));

test("hui-settings preserves the shared runtime fixtures", () => {
  for (const fixture of fixtures) {
    assert.deepEqual(normalizeSettings(fixture.input), fixture.expected);
  }
  assert.deepEqual(DEFAULT_SETTINGS, fixtures.find((fixture) => fixture.input === null)!.expected);
});
