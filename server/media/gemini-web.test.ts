import assert from "node:assert/strict";
import { test } from "vitest";

import { geminiAppProvider, type GeminiPage } from "./gemini-web.ts";
import { MediaProviderError } from "./provider.ts";

const PNG = Buffer.from("gemini-app-bytes").toString("base64");

/** Answers each step by what the script asks the page for, and records the order it happened in. */
function page(steps: {
  probe?: unknown;
  ask?: unknown;
  answers?: unknown[];
  read?: unknown;
  enabled?: boolean;
}): { page: GeminiPage; calls: string[] } {
  const calls: string[] = [];
  const answers = [...(steps.answers ?? [])];
  return {
    calls,
    page: {
      enabled: async () => steps.enabled ?? true,
      open: async (url: string) => { calls.push(`open ${url}`); },
      evaluate: async (expression: string) => {
        if (expression.includes("accounts.google.com/ServiceLogin")) { calls.push("probe"); return steps.probe; }
        if (expression.includes("no composer")) { calls.push("ask"); return steps.ask; }
        if (expression.includes("generating")) { calls.push("answer"); return answers.shift() ?? { generating: true, images: [], text: "" }; }
        if (expression.includes("credentials")) { calls.push("read"); return steps.read; }
        throw new Error("unexpected script");
      },
    },
  };
}

function provider(options: Parameters<typeof page>[0], timeouts: { answerTimeoutMs?: number } = {}) {
  const fixture = page(options);
  return {
    calls: fixture.calls,
    provider: geminiAppProvider({
      page: async () => fixture.page,
      answerTimeoutMs: timeouts.answerTimeoutMs ?? 1_000,
      pollIntervalMs: 1,
      sleep: async () => undefined,
    }),
  };
}

test("a signed-out browser asks the operator to sign in to Gemini once", async () => {
  const { provider: gemini, calls } = provider({ probe: { signedIn: false, composer: false, url: "https://gemini.google.com/app" } });
  await assert.rejects(
    gemini.generate({ kind: "image", prompt: "a cat", aspect: "square", model: "gemini-app" }),
    (error: unknown) => error instanceof MediaProviderError && /Sign in to Gemini in HUI's browser/u.test(error.message),
  );
  assert.deepEqual(calls, ["open https://gemini.google.com/app", "probe"]);
});

test("the provider asks the app, waits for the answer and reads the image back through the page", async () => {
  const { provider: gemini, calls } = provider({
    probe: { signedIn: true, composer: true },
    ask: { submitted: true },
    answers: [
      { generating: true, images: [], text: "" },
      { generating: false, images: [{ src: "https://lh3.googleusercontent.com/abc", width: 1024, height: 1024 }], text: "" },
    ],
    read: { ok: true, mimeType: "image/png", data: PNG },
  });
  const generated = await gemini.generate({ kind: "image", prompt: "a cat", aspect: "square", model: "gemini-app" });
  assert.equal(generated.bytes.toString(), "gemini-app-bytes");
  assert.equal(generated.mimeType, "image/png");
  assert.deepEqual(calls, ["open https://gemini.google.com/app", "probe", "ask", "answer", "answer", "read"]);
});

test("a reply that carries no image reports what Gemini said instead", async () => {
  const { provider: gemini } = provider({
    probe: { signedIn: true, composer: true },
    ask: { submitted: true },
    answers: [{ generating: false, images: [], text: "I can't generate images in this chat." }],
  });
  await assert.rejects(
    gemini.generate({ kind: "image", prompt: "a cat", aspect: "square", model: "gemini-app" }),
    (error: unknown) => error instanceof MediaProviderError && /Gemini answered without an image: I can't generate images/u.test(error.message),
  );
});

test("an answer that never arrives times out with the number of seconds it waited", async () => {
  const { provider: gemini } = provider({ probe: { signedIn: true, composer: true }, ask: { submitted: true } }, { answerTimeoutMs: 5 });
  await assert.rejects(
    gemini.generate({ kind: "image", prompt: "a cat", aspect: "square", model: "gemini-app" }),
    (error: unknown) => error instanceof MediaProviderError && /did not produce an image within/u.test(error.message),
  );
});

test("a browser that is turned off is reported before a tab is opened", async () => {
  const { provider: gemini, calls } = provider({ enabled: false, probe: { signedIn: true, composer: true } });
  assert.equal(await gemini.available(), false);
  await assert.rejects(
    gemini.generate({ kind: "image", prompt: "a cat", aspect: "square", model: "gemini-app" }),
    (error: unknown) => error instanceof MediaProviderError && /Settings → Tools → Browser/u.test(error.message),
  );
  assert.deepEqual(calls, []);
});

test("an image the page refuses to read back is named, not silently dropped", async () => {
  const { provider: gemini } = provider({
    probe: { signedIn: true, composer: true },
    ask: { submitted: true },
    answers: [{ generating: false, images: [{ src: "https://lh3.googleusercontent.com/abc", width: 512, height: 512 }], text: "" }],
    read: { ok: false, reason: "HTTP 403" },
  });
  await assert.rejects(
    gemini.generate({ kind: "image", prompt: "a cat", aspect: "square", model: "gemini-app" }),
    (error: unknown) => error instanceof MediaProviderError && /could not be read back \(HTTP 403\)/u.test(error.message),
  );
});
