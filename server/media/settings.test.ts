import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { mergeMediaSettings, normalizeMediaSettings, readMediaSettings, viewMediaSettings, writeMediaSettings } from "./settings.ts";

async function fixture(t: { onTestFinished: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "hui-media-settings-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "media.json");
}

test("media settings are written private and read back", async (t) => {
  const path = await fixture(t);
  await writeMediaSettings({ preferred: { image: "gemini" }, models: { gemini: "gemini-3-pro-image" }, gemini: { apiKey: "test-key-not-real" } }, path);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const settings = await readMediaSettings(path);
  assert.equal(settings.preferred.image, "gemini");
  assert.equal(settings.models.gemini, "gemini-3-pro-image");
  assert.equal(settings.gemini.apiKey, "test-key-not-real");
  assert.match(await readFile(path, "utf8"), /"apiKey"/u);
});

test("the snapshot the browser sees reports a key without exposing it", async (t) => {
  const path = await fixture(t);
  await writeMediaSettings({ preferred: {}, models: {}, gemini: { apiKey: "test-key-not-real" } }, path);
  const view = viewMediaSettings(await readMediaSettings(path));
  assert.deepEqual(view.gemini, { configured: true });
  assert.doesNotMatch(JSON.stringify(view), /test-key-not-real/u);
});

test("a missing or malformed file reads as the defaults instead of an error", async (t) => {
  const path = await fixture(t);
  assert.deepEqual(await readMediaSettings(path), { preferred: {}, models: {}, gemini: {} });
  await writeFile(path, "{ not json");
  assert.deepEqual(await readMediaSettings(path), { preferred: {}, models: {}, gemini: {} });
  await writeFile(path, JSON.stringify({ preferred: { image: "unknown" }, models: { unknown: "x" }, gemini: { apiKey: 42 } }));
  assert.deepEqual(await readMediaSettings(path), { preferred: {}, models: {}, gemini: {} });
});

test("saving a model keeps the key the operator already entered, and a null removes it", async () => {
  const current = normalizeMediaSettings({ preferred: {}, models: {}, gemini: { apiKey: "keep-me" } });
  const saved = mergeMediaSettings(current, { models: { gemini: "gemini-3-pro-image" } });
  assert.equal(saved.gemini.apiKey, "keep-me");
  assert.equal(saved.models.gemini, "gemini-3-pro-image");
  const cleared = mergeMediaSettings(saved, { gemini: { apiKey: null } });
  assert.equal(cleared.gemini.apiKey, undefined);
  assert.equal(cleared.models.gemini, "gemini-3-pro-image", "clearing a key leaves the model alone");
  assert.throws(() => mergeMediaSettings(current, { preferred: { image: "nope" } }), /Unknown media provider/u);
});
