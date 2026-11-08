import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { generateMedia } from "./service.ts";
import type { MediaProvider } from "./provider.ts";
import type { MediaRegistry } from "./registry.ts";

function provider(bytes: Buffer, overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    id: "openai-codex",
    name: "OpenAI (ChatGPT subscription)",
    kinds: ["image"],
    models: () => ["gpt-image-2"],
    available: async () => true,
    generate: async () => ({ bytes, mimeType: "image/png", extension: "png" }),
    ...overrides,
  };
}

function registry(media: MediaProvider, chosen: { provider: MediaProvider; model: string } = { provider: media, model: "gpt-image-2" }): MediaRegistry {
  return {
    providers: () => [media],
    available: async () => [media],
    choose: async () => chosen,
  };
}

test("a generated image reaches the chat as staged media, not as a local path", async (t) => {
  const store = await mkdtemp(join(tmpdir(), "hui-media-store-"));
  t.onTestFinished(() => rm(store, { recursive: true, force: true }));
  const result = await generateMedia(registry(provider(Buffer.from("image-bytes"))), { kind: "image", prompt: "a cat", aspect: "square" }, { workspace: store, storeRoot: store });
  assert.equal(result.provider, "openai-codex");
  assert.equal(result.model, "gpt-image-2");
  assert.equal(result.media.length, 1);
  const [media] = result.media;
  assert.equal(media!.kind, "image");
  assert.equal(media!.mimeType, "image/png");
  assert.equal(media!.size, 11);
  assert.equal(media!.name, "image-1.png");
  assert.match(media!.url, /^\/__hui\/media\/[0-9a-f-]{36}\/image-1\.png$/u);
  assert.equal(media!.path, undefined, "a generated file lives in HUI's store, not in the session's workspace");
});

test("a provider that returns something other than media is refused", async (t) => {
  const store = await mkdtemp(join(tmpdir(), "hui-media-store-"));
  t.onTestFinished(() => rm(store, { recursive: true, force: true }));
  const html = provider(Buffer.from("<html>"), { generate: async () => ({ bytes: Buffer.from("<html>"), mimeType: "text/html", extension: "html" }) });
  await assert.rejects(
    generateMedia(registry(html), { kind: "image", prompt: "a cat", aspect: "square" }, { workspace: store, storeRoot: store }),
    /unsupported file type/u,
  );
});

test("a model the provider does not offer is refused before any request", async () => {
  let called = false;
  const media = provider(Buffer.from("x"), { generate: async () => { called = true; return { bytes: Buffer.from("x"), mimeType: "image/png", extension: "png" }; } });
  await assert.rejects(
    generateMedia(registry(media), { kind: "image", prompt: "a cat", aspect: "square", model: "dall-e-9" }, { workspace: process.cwd() }),
    /does not offer dall-e-9/u,
  );
  assert.equal(called, false);
});
