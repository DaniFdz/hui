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
    retryAttempts: 3,
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
    retryAttempts: 3,
    routes: [],
  });
});

test("a route without a model inherits the caller's model; a malformed one is dropped", () => {
  const settings = normalizeSettings({ models: { routes: [
    { name: "inherit", description: "Runs on its caller's model." },
    { name: "blank", model: "   " },
    { name: "broken", model: "claude-opus-5-5" },
    { name: "pinned", model: "openai/gpt-5.6-luna", thinking: "high" },
  ] } });
  assert.deepEqual(settings.models.routes, [
    { name: "inherit", description: "Runs on its caller's model.", model: "" },
    { name: "blank", description: "", model: "" },
    { name: "pinned", description: "", model: "openai/gpt-5.6-luna", thinking: "high" },
  ]);
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

test("the retry budget is a whole number from 0 to 5 and defaults to 3", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hui-settings-"));
  const path = join(directory, "settings.json");
  const attempts = async (value: unknown) => {
    await writeFile(path, JSON.stringify({ models: { retryAttempts: value } }));
    return (await readHuiSettingsAt(path)).models.retryAttempts;
  };
  assert.equal(await attempts(0), 0);
  assert.equal(await attempts(5.9), 5);
  assert.equal(await attempts(-2), 0);
  assert.equal(await attempts(99), 5);
  assert.equal(await attempts("4"), 4);
  assert.equal(await attempts("many"), 3);
  assert.equal(await attempts(undefined), 3);
});

test("a gateway name is trimmed and bounded, and empty means the machine's hostname", () => {
  assert.equal(DEFAULT_SETTINGS.name, "");
  assert.equal(normalizeSettings({}).name, "", "no saved name at all");
  assert.equal(normalizeSettings({ name: "  build-box  " }).name, "build-box");
  assert.equal(normalizeSettings({ name: "   " }).name, "", "whitespace is not a name");
  assert.equal(normalizeSettings({ name: "x".repeat(80) }).name, "x".repeat(60), "bounded to 60 characters");
  assert.equal(normalizeSettings({ name: "a".repeat(60) }).name, "a".repeat(60), "60 characters still fit");
  for (const name of [42, null, ["build-box"], { name: "build-box" }]) {
    assert.equal(normalizeSettings({ name }).name, "", JSON.stringify(name));
  }
  assert.equal(normalizeSettings(normalizeSettings({ name: " build-box " })).name, "build-box", "round-trips");
});

test("the ntfy relay keeps a capability topic and repairs a malformed server", () => {
  const normalize = (ntfy: unknown) => normalizeSettings({ notifications: { ntfy } }).notifications.ntfy;
  assert.deepEqual(normalize(undefined), { server: "https://ntfy.sh", topic: "" }, "no relay until a topic is set");
  assert.deepEqual(normalize({ topic: " hui-abc_123 " }), { server: "https://ntfy.sh", topic: "hui-abc_123" });
  assert.deepEqual(normalize({ server: "https://ntfy.example.com/", topic: "a".repeat(64) }), { server: "https://ntfy.example.com", topic: "a".repeat(64) });
  assert.deepEqual(normalize({ server: "http://127.0.0.1:8080/hui", topic: "phone" }), { server: "http://127.0.0.1:8080/hui", topic: "phone" }, "a self-hosted base path stays");
  for (const server of ["", "not a url", "ftp://ntfy.sh", "https://user:pass@ntfy.sh", "https://ntfy.sh/?q=1", "https://ntfy.sh/#a", "x".repeat(2_100)]) {
    assert.equal(normalize({ server, topic: "phone" }).server, "https://ntfy.sh", JSON.stringify(server));
  }
  for (const topic of ["", "has space", "slash/name", "x".repeat(65), 42, null]) {
    assert.equal(normalize({ server: "https://ntfy.sh", topic }).topic, "", JSON.stringify(topic));
  }
  assert.deepEqual(normalize(normalize({ server: "https://ntfy.example.com/", topic: "phone" })), { server: "https://ntfy.example.com", topic: "phone" }, "round-trips");
});

const fixtures: { input: unknown; expected: ReturnType<typeof normalizeSettings> }[] = JSON.parse(readFileSync(new URL("./hui-settings.fixture.json", import.meta.url), "utf8"));

test("hui-settings preserves the shared runtime fixtures", () => {
  for (const fixture of fixtures) {
    assert.deepEqual(normalizeSettings(fixture.input), fixture.expected);
  }
  assert.deepEqual(DEFAULT_SETTINGS, fixtures.find((fixture) => fixture.input === null)!.expected);
});
