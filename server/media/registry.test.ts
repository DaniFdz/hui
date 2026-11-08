import assert from "node:assert/strict";
import { test } from "vitest";

import { createMediaRegistry } from "./registry.ts";
import { MediaProviderError, type MediaProvider } from "./provider.ts";
import type { MediaSettings } from "./settings.ts";

function settings(overrides: Partial<MediaSettings> = {}): MediaSettings {
  return { preferred: {}, models: {}, gemini: {}, ...overrides };
}

function registry(options: { settings?: MediaSettings; codex?: boolean; gemini?: boolean; browser?: boolean } = {}) {
  return createMediaRegistry({
    settings: async () => options.settings ?? settings(),
    codexCredential: async () => (options.codex === false ? undefined : { accessToken: "token" }),
    geminiKey: async () => (options.gemini === false ? undefined : "key"),
    geminiPage: async () => (options.browser === false ? undefined : {
      enabled: async () => true,
      open: async () => undefined,
      evaluate: async () => ({}),
    }),
  });
}

test("the connected ChatGPT subscription serves an image by default", async () => {
  const chosen = await registry().choose("image");
  assert.equal(chosen.provider.id, "openai-codex");
  assert.equal(chosen.model, "gpt-image-2");
});

test("an operator preference and model win, and an explicit request wins over both", async () => {
  const preferred = await registry({ settings: settings({ preferred: { image: "gemini" }, models: { gemini: "gemini-3-pro-image" } }) }).choose("image");
  assert.equal(preferred.provider.id, "gemini");
  assert.equal(preferred.model, "gemini-3-pro-image");
  const requested = await registry({ settings: settings({ preferred: { image: "gemini" } }) }).choose("image", "openai-codex");
  assert.equal(requested.provider.id, "openai-codex");
});

test("a provider without credentials is never chosen silently", async () => {
  const geminiOnly = registry({ codex: false, settings: settings({ preferred: { image: "gemini" } }) });
  assert.equal((await geminiOnly.choose("image")).provider.id, "gemini");
  await assert.rejects(
    registry({ codex: false, gemini: false }).choose("image"),
    (error: unknown) => error instanceof MediaProviderError && /No image provider is configured/u.test(error.message),
  );
  await assert.rejects(
    registry({ codex: false }).choose("image", "openai-codex"),
    (error: unknown) => error instanceof MediaProviderError && /Connect one in Settings → Models/u.test(error.message),
  );
});

test("an unknown or wrong-kind provider is refused with its reason", async () => {
  await assert.rejects(registry().choose("image", "dall-e"), /Unknown media provider/u);
  await assert.rejects(registry().choose("video"), /No video provider is configured/u);
  const media = await registry().available("video");
  assert.deepEqual(media, [], "neither provider generates video yet");
});

test("every provider reports the models it accepts for a kind", async () => {
  const providers: MediaProvider[] = registry().providers();
  assert.deepEqual(providers.map((provider) => provider.id), ["openai-codex", "gemini-web", "gemini"]);
  for (const provider of providers) {
    assert(provider.models("image").length > 0);
    assert.deepEqual(provider.models("video"), []);
  }
});

test("the Gemini account route is never picked by default, only when the operator chooses it", async () => {
  const byDefault = await registry({ codex: false, gemini: false, browser: true }).available("image");
  assert.deepEqual(byDefault, [], "an account route that opens a tab is opt-in");
  const chosen = await registry({
    codex: false, gemini: false, browser: true,
    settings: settings({ preferred: { image: "gemini-web" } }),
  }).choose("image");
  assert.equal(chosen.provider.id, "gemini-web");
  assert.equal(chosen.model, "gemini-app");
  await assert.rejects(
    registry({ codex: false, gemini: false, browser: false, settings: settings({ preferred: { image: "gemini-web" } }) }).choose("image"),
    /turn it on in Settings → Tools → Browser/u,
  );
});
