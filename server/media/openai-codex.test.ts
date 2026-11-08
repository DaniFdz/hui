import assert from "node:assert/strict";
import { test } from "vitest";

import { codexClaims, codexImageProvider, type CodexCredential } from "./openai-codex.ts";
import { MediaProviderError } from "./provider.ts";

const PNG = Buffer.from("png-bytes").toString("base64");

function token(claims: Record<string, unknown> = { "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_compute_residency: "us" } }): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

function fixture(answer: (url: string, init: RequestInit) => Response, credential: CodexCredential | null = { accessToken: token() }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = codexImageProvider({
    resolveCredential: async () => credential ?? undefined,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer(url, init);
    }) as unknown as typeof fetch,
  });
  return { provider, calls };
}

test("a ChatGPT subscription generates an image through the native Codex images endpoint", async () => {
  const { provider, calls } = fixture(() => new Response(JSON.stringify({ created: 1, data: [{ b64_json: PNG }] }), { status: 200 }));
  const generated = await provider.generate({ kind: "image", prompt: "a red circle", aspect: "landscape", model: "gpt-image-2" });
  assert.equal(generated.mimeType, "image/png");
  assert.equal(generated.extension, "png");
  assert.equal(generated.bytes.toString(), "png-bytes");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://chatgpt.com/backend-api/codex/images/generations");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], `Bearer ${token()}`);
  assert.equal(headers["ChatGPT-Account-ID"], "acct-1", "the workspace header comes from the OAuth JWT");
  assert.equal(headers["x-openai-internal-codex-residency"], "us");
  assert.equal(headers["originator"], "codex_cli_rs");
  const body = JSON.parse(String(calls[0]!.init.body)) as { prompt: string; model: string; size: string; n: number };
  assert.deepEqual(body, { prompt: "a red circle", model: "gpt-image-2", size: "1536x1024", n: 1 });
});

test("a plan without image generation is reported as such, not as a generic failure", async () => {
  const { provider } = fixture(() => new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 }));
  await assert.rejects(
    provider.generate({ kind: "image", prompt: "x", aspect: "square", model: "gpt-image-2" }),
    (error: unknown) => error instanceof MediaProviderError && /plan does not include image generation/u.test(error.message),
  );
});

test("an expired or rejected credential asks for a new sign-in", async () => {
  const { provider } = fixture(() => new Response(JSON.stringify({ error: { code: "invalid_jwt" } }), { status: 401 }));
  await assert.rejects(
    provider.generate({ kind: "image", prompt: "x", aspect: "square", model: "gpt-image-2" }),
    (error: unknown) => error instanceof MediaProviderError && /Sign in again/u.test(error.message),
  );
});

test("without a connected account the provider is unavailable and says so", async () => {
  const { provider, calls } = fixture(() => new Response("{}"), null);
  assert.equal(await provider.available(), false);
  await assert.rejects(
    provider.generate({ kind: "image", prompt: "x", aspect: "square", model: "gpt-image-2" }),
    (error: unknown) => error instanceof MediaProviderError && /No ChatGPT account is connected/u.test(error.message),
  );
  assert.equal(calls.length, 0, "no request is made without a credential");
});

test("a malformed token drops the workspace headers instead of failing", () => {
  assert.deepEqual(codexClaims("not-a-jwt"), {});
  assert.deepEqual(codexClaims(token({ "https://api.openai.com/auth": { chatgpt_account_id: "a" } })), { accountId: "a" });
});
