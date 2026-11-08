import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { generateMediaForSession, MediaGenerationInputError } from "./media-generation.ts";
import type { MediaProvider } from "../media/provider.ts";
import type { MediaRegistry } from "../media/registry.ts";

function fixture() {
  const provider: MediaProvider = {
    id: "openai-codex",
    name: "OpenAI (ChatGPT subscription)",
    kinds: ["image"],
    models: () => ["gpt-image-2"],
    available: async () => true,
    generate: async () => ({ bytes: Buffer.from("bytes"), mimeType: "image/png", extension: "png" }),
  };
  const registry: MediaRegistry = {
    providers: () => [provider],
    available: async () => [provider],
    choose: async () => ({ provider, model: "gpt-image-2" }),
  };
  return registry;
}

test("gen_image needs a prompt and a conversation that still exists", async (t) => {
  const store = await mkdtemp(join(tmpdir(), "hui-media-generation-"));
  t.onTestFinished(() => rm(store, { recursive: true, force: true }));
  const deps = { registry: fixture(), session: async () => ({ cwd: store }), storeRoot: store };
  await assert.rejects(generateMediaForSession("session-1", "image", {}, deps), MediaGenerationInputError);
  await assert.rejects(generateMediaForSession("session-1", "image", { prompt: "   " }, deps), /non-empty/u);
  await assert.rejects(generateMediaForSession("session-1", "image", { prompt: "x".repeat(4_001) }, deps), /4000/u);
  await assert.rejects(
    generateMediaForSession("session-1", "image", { prompt: "a cat" }, { registry: fixture(), session: async () => undefined, storeRoot: store }),
    /Conversation no longer exists/u,
  );
  await assert.rejects(generateMediaForSession("session-1", "image", { prompt: "a cat", aspect: "wide" }, deps), /aspect must be/u);
  await assert.rejects(generateMediaForSession("session-1", "image", { prompt: "a cat", provider: "" }, deps), /provider must be/u);
});

test("a valid request returns staged media the transcript can draw", async (t) => {
  const store = await mkdtemp(join(tmpdir(), "hui-media-generation-"));
  t.onTestFinished(() => rm(store, { recursive: true, force: true }));
  const result = await generateMediaForSession("session-1", "image", { prompt: "a cat", aspect: "landscape" }, {
    registry: fixture(),
    session: async () => ({ cwd: store }),
    storeRoot: store,
  });
  assert.equal(result.kind, "image");
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0]!.mimeType, "image/png");
  assert.match(result.media[0]!.url, /^\/__hui\/media\//u);
});
