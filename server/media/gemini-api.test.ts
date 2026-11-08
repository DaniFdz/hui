import assert from "node:assert/strict";
import { test } from "vitest";

import { geminiImageProvider } from "./gemini-api.ts";
import { MediaProviderError } from "./provider.ts";

const PNG = Buffer.from("gemini-bytes").toString("base64");

function fixture(answer: (url: string, init: RequestInit) => Response, key: string | null = "test-key") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = geminiImageProvider({
    apiKey: async () => key ?? undefined,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer(url, init);
    }) as unknown as typeof fetch,
  });
  return { provider, calls };
}

test("a Gemini key generates an image and reports the aspect ratio it asked for", async () => {
  const { provider, calls } = fixture(() => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PNG } }] } }],
  }), { status: 200 }));
  const generated = await provider.generate({ kind: "image", prompt: "a blue square", aspect: "portrait", model: "gemini-3.1-flash-image" });
  assert.equal(generated.bytes.toString(), "gemini-bytes");
  assert.equal(generated.mimeType, "image/png");
  assert.equal(calls[0]!.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
  assert.equal((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"], "test-key");
  const body = JSON.parse(String(calls[0]!.init.body)) as { generationConfig: { responseModalities: string[]; imageConfig: { aspectRatio: string } } };
  assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "9:16");
});

test("an answer without an image says how to fix the prompt", async () => {
  const { provider } = fixture(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "I cannot" }] } }] }), { status: 200 }));
  await assert.rejects(
    provider.generate({ kind: "image", prompt: "x", aspect: "square", model: "gemini-3.1-flash-image" }),
    (error: unknown) => error instanceof MediaProviderError && /more explicit image prompt/u.test(error.message),
  );
});

test("a quota answer names the free-tier limit instead of echoing Google's status", async () => {
  const { provider } = fixture(() => new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 }));
  await assert.rejects(
    provider.generate({ kind: "image", prompt: "x", aspect: "square", model: "gemini-3.1-flash-image" }),
    (error: unknown) => error instanceof MediaProviderError && /free-tier quota/u.test(error.message),
  );
});

test("without a key the provider is unavailable and names where the key goes", async () => {
  const { provider, calls } = fixture(() => new Response("{}"), null);
  assert.equal(await provider.available(), false);
  await assert.rejects(
    provider.generate({ kind: "image", prompt: "x", aspect: "square", model: "gemini-3.1-flash-image" }),
    (error: unknown) => error instanceof MediaProviderError && /Settings → Media providers/u.test(error.message),
  );
  assert.equal(calls.length, 0);
});
