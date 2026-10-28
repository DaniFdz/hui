/**
 * Keeps every image a Durable request sends within the provider's image limits.
 *
 * A history keeps images as their tools and attachments made them, such as a
 * full-page screenshot 8192 pixels tall, and it keeps every screenshot the
 * conversation ever made. Providers refuse a request holding an image too large,
 * and some refuse one holding too many, so every later turn of that conversation
 * would fail with it. Each request shrinks and trims what it sends; the stored
 * history stays as it was.
 *
 * How many images a provider takes is its own choice, and for some of them the
 * rejection is the only place that number appears. The cap of a model is the one
 * a rejection taught, kept in the config directory so a restart does not cost a
 * conversation another error.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { AgentDoc, defineExtension, GenerationTask, hook, type HookApi, type TaskId } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { DEFAULT_IMAGE_LIMITS, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import { getImageDimensions } from "@earendil-works/pi-tui";
import { IMAGE_CAPS_FILE } from "../paths.ts";

type Part = Exclude<Extract<Message, { role: "user" }>["content"], string>[number];
type ImagePart = Extract<Part, { type: "image" }>;

/** The most images a request keeps when its rejection names no limit of the provider's. */
const UNSTATED_IMAGE_CAP = 30;

/** A rejection about the images of a request, rather than about anything else in it. */
const IMAGE_REJECTION = /too many images|image input|images per request/i;

/** The limit a rejection states, as in "Too many images: 100 (max 64)". */
const STATED_LIMIT = /\b(?:max(?:imum)?|at most)\b[^0-9]{0,16}(\d+)/i;

function countImages(messages: readonly Message[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.content == null || typeof message.content === "string") continue;
    for (const part of message.content) if (part.type === "image") count++;
  }
  return count;
}

/**
 * `messages` sending at most `cap` images: the newest ones kept, the rest replaced
 * by a single note where the first of them was; undefined when they already fit.
 */
export function trimImages(messages: readonly Message[], cap: number): Message[] | undefined {
  const omitted = countImages(messages) - cap;
  if (omitted <= 0) return undefined;
  let dropped = 0;
  let note: Part | undefined;
  return messages.map((message) => {
    if (message.content == null || typeof message.content === "string" || message.role === "assistant" || !message.content.some((part) => part.type === "image")) return message;
    const content: Part[] = [];
    for (const part of message.content) {
      if (part.type !== "image" || dropped === omitted) {
        content.push(part);
        continue;
      }
      dropped++;
      if (note === undefined) {
        note = { type: "text", text: `[${omitted} earlier image${omitted === 1 ? "" : "s"} left out: this model takes at most ${cap} images per request. Read a file again to see it.]` };
        content.push(note);
      }
    }
    return { ...message, content } as Message;
  });
}

/** How many images each model takes per request, as its provider's rejections taught. */
export class ImageCaps {
  readonly #path: string;
  #caps: Promise<Map<string, number>> | undefined;

  constructor(path: string) {
    this.#path = path;
  }

  async get(key: string): Promise<number | undefined> {
    return (await this.#read()).get(key);
  }

  async learn(key: string, sent: number, errorMessage: string): Promise<void> {
    if (!IMAGE_REJECTION.test(errorMessage)) return;
    const caps = await this.#read();
    const known = caps.get(key);
    // Within a cap this model already taught: the count is not what the provider refused.
    if (known !== undefined && sent < known) return;
    const stated = Number(STATED_LIMIT.exec(errorMessage)?.[1]);
    const cap = Number.isNaN(stated) ? (known === undefined ? Math.min(sent - 1, UNSTATED_IMAGE_CAP) : known - 1) : stated;
    if (cap < 1 || cap === known) return;
    caps.set(key, cap);
    await writeFile(this.#path, `${JSON.stringify(Object.fromEntries(caps), null, 2)}\n`).catch(() => undefined);
  }

  #read(): Promise<Map<string, number>> {
    return (this.#caps ??= readFile(this.#path, "utf8")
      .then((text) => new Map(Object.entries(JSON.parse(text) as Record<string, unknown>)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= 1)))
      .catch(() => new Map<string, number>()));
  }
}

function fits(part: ImagePart): boolean {
  const size = getImageDimensions(part.data, part.mimeType);
  return part.data.length <= DEFAULT_IMAGE_LIMITS.maxBytes
    && (!size || (size.widthPx <= DEFAULT_IMAGE_LIMITS.maxWidth && size.heightPx <= DEFAULT_IMAGE_LIMITS.maxHeight));
}

const shrunk = new Map<string, Part>();
const SHRUNK_KEPT = 32;

async function fitPart(part: Part, images: ImageProcessor): Promise<Part> {
  if (part.type !== "image" || fits(part)) return part;
  const key = createHash("sha256").update(part.data).digest("base64");
  const cached = shrunk.get(key);
  if (cached) return cached;
  const prepared = await images.prepare(new Uint8Array(Buffer.from(part.data, "base64")), part.mimeType, DEFAULT_IMAGE_LIMITS).catch(() => undefined);
  if (!prepared) return { type: "text", text: "[An image was left out: it is larger than the model accepts and could not be shrunk.]" };
  const image: Part = { type: "image", data: prepared.data, mimeType: prepared.mimeType };
  shrunk.set(key, image);
  if (shrunk.size > SHRUNK_KEPT) shrunk.delete(shrunk.keys().next().value!);
  return image;
}

/** `messages` with every image too large shrunk to fit, or undefined when all of them already fit. */
async function fitImages(messages: readonly Message[], images: ImageProcessor): Promise<Message[] | undefined> {
  let changed = false;
  const fitted = await Promise.all(messages.map(async (message) => {
    if (message.role === "assistant" || typeof message.content === "string" || message.content.every((part) => part.type !== "image" || fits(part))) return message;
    changed = true;
    return { ...message, content: await Promise.all(message.content.map((part) => fitPart(part, images))) } as Message;
  }));
  return changed ? fitted : undefined;
}

/** The model a request goes to, as the key its image cap is learned under. */
async function modelKey(api: HookApi, context: Context): Promise<string | undefined> {
  const model = (await api.snapshot(AgentDoc, api.conversationId, context))?.model;
  return model === undefined || model === null ? undefined : `${model.provider}/${model.modelId}`;
}

let processor: Promise<ImageProcessor> | undefined;

/** The image limits extension, over `caps` to learn a model's image count from its provider's rejection. */
export function createImageLimits(caps: ImageCaps) {
  /** Images the request being answered by each task carried, for the rejection to read. */
  const sent = new Map<TaskId, number>();
  return defineExtension({
    name: "hui-image-limits",
    hooks: [hook(GenerationTask, {
      beforeRequest: async (request, api, context) => {
        const key = await modelKey(api, context);
        const cap = key === undefined ? undefined : await caps.get(key);
        const trimmed = cap === undefined ? undefined : trimImages(request.messages, cap);
        const messages = trimmed ?? request.messages;
        sent.set(api.taskId, countImages(messages));
        const fitted = await fitImages(messages, await (processor ??= createNodePhotonImages()));
        const next = fitted ?? trimmed;
        return next && { messages: next };
      },
      afterResponse: async (message: AssistantMessage, api, context) => {
        const count = sent.get(api.taskId);
        sent.delete(api.taskId);
        if (count === undefined || message.stopReason !== "error" || !message.errorMessage) return;
        const key = await modelKey(api, context);
        if (key !== undefined) await caps.learn(key, count, message.errorMessage);
      },
    })],
  });
}

export const ImageLimits = createImageLimits(new ImageCaps(IMAGE_CAPS_FILE));
