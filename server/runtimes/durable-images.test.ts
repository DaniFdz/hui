import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { HookApi } from "@earendil-works/pi-durable";
import { createImageLimits, ImageCaps, trimImages } from "./durable-images.ts";

const png = (data = "iVBORw0KGgo="): { type: "image"; data: string; mimeType: string } => ({ type: "image", data, mimeType: "image/png" });

const user = (...images: string[]): Message =>
  ({ role: "user", content: [{ type: "text", text: "look" }, ...images.map((data) => png(data))], timestamp: 1 }) as unknown as Message;

const reply = (): Message => ({ role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 2 }) as unknown as Message;

function imageCount(messages: readonly Message[]): number {
  return messages.flatMap((message) => (typeof message.content === "string" ? [] : message.content.filter((part) => part.type === "image"))).length;
}

test("a request over the cap keeps its newest images and says once what it left out", () => {
  const messages = [user("a", "b"), reply(), user("c", "d"), reply(), user("e")];
  const trimmed = trimImages(messages, 2)!;
  assert.equal(imageCount(trimmed), 2, "only the cap's worth of images goes");
  assert.deepEqual(trimmed[0]!.content, [{ type: "text", text: "look" },
    { type: "text", text: "[3 earlier images left out: this model takes at most 2 images per request. Read a file again to see it.]" }],
  "the first dropped image leaves one note in its place");
  assert.deepEqual(trimmed[4]!.content, [{ type: "text", text: "look" }, png("e")], "the newest image stays");
  assert.equal(trimImages(messages, 5), undefined, "a request within the cap is left alone");
  assert.equal(trimImages([user("a")], 1), undefined, "one image at the cap is left alone");
});

test("the learned cap is the model's own, kept for the next gateway to read", async (t: TestContext) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-image-caps-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "image-caps.json");
  const caps = new ImageCaps(path);
  const unstated = "400: {\"error\":\"Invalid image input. Check image data, format, count, and dimensions.\"}";

  await caps.learn("p/stated", 100, "400: Too many images: 100 (max 64)");
  assert.equal(await caps.get("p/stated"), 64, "the limit the provider names");
  assert.equal(await caps.get("p/other"), undefined, "another model of the provider keeps its own");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { "p/stated": 64 });

  await caps.learn("p/silent", 31, unstated);
  assert.equal(await caps.get("p/silent"), 30, "one less than the request it refused, down to the smallest known cap");
  await caps.learn("p/silent", 29, unstated);
  assert.equal(await caps.get("p/silent"), 30, "a request within that cap teaches nothing");

  await caps.learn("p/stated", 20, "400: Too many images: 20 (max 64)");
  assert.equal(await caps.get("p/stated"), 64, "a request well within the cap teaches nothing");
  await caps.learn("p/stated", 64, unstated);
  assert.equal(await caps.get("p/stated"), 63, "a request at the cap that still failed lowers it by one");
  assert.equal(await new ImageCaps(path).get("p/stated"), 63, "a restarted gateway reads the cap it learned");

  await caps.learn("p/other", 40, "400: context length exceeded");
  assert.equal(await caps.get("p/other"), undefined, "an error about something else teaches nothing");
});

test("a request refused for its image count is trimmed from then on", async (t: TestContext) => {
  const dir = await mkdtemp(join(tmpdir(), "hui-image-limit-request-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const limits = createImageLimits(new ImageCaps(join(dir, "image-caps.json")));
  const handlers = (limits.hooks![0] as { handlers: { beforeRequest: Function; afterResponse: Function } }).handlers;
  const api = { taskId: "task", conversationId: 1, snapshot: async () => ({ model: { provider: "p", modelId: "m" } }) } as unknown as HookApi;
  const messages = [user(...Array.from({ length: 31 }, (_, index) => `image-${index}`))];

  const first = await handlers.beforeRequest({ messages }, api, BACKGROUND_CONTEXT);
  assert.equal(first, undefined, "an unknown model's request goes out as it was");

  const refused = {
    role: "assistant", content: [], api: "openai-completions", provider: "p", model: "m", stopReason: "error",
    errorMessage: "400: {\"error\":\"Invalid image input. Check image data, format, count, and dimensions.\"}",
    timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  } as unknown as AssistantMessage;
  await handlers.afterResponse(refused, api, BACKGROUND_CONTEXT);

  const second = await handlers.beforeRequest({ messages }, api, BACKGROUND_CONTEXT);
  assert.equal(imageCount(second.messages), 30, "the next request carries the cap's worth of images");
  assert.match(JSON.stringify(second.messages[0].content), /1 earlier image left out/, "and says what it left out");
});