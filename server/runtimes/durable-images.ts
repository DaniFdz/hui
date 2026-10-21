/**
 * Keeps every image a Durable request sends within the provider's image limits.
 *
 * A history keeps images as their tools and attachments made them, such as a
 * full-page screenshot 8192 pixels tall. Providers refuse a request holding one
 * too large, so every later turn of that conversation would fail with it. Each
 * request shrinks such images on the way out; the stored history stays as it was.
 */
import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { DEFAULT_IMAGE_LIMITS, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import { getImageDimensions } from "@earendil-works/pi-tui";

type Part = Exclude<Extract<Message, { role: "user" }>["content"], string>[number];

function fits(part: Extract<Part, { type: "image" }>): boolean {
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

let processor: Promise<ImageProcessor> | undefined;

export const ImageLimits = defineExtension({
  name: "hui-image-limits",
  hooks: [hook(GenerationTask, {
    beforeRequest: async (request) => {
      const messages = await fitImages(request.messages, await (processor ??= createNodePhotonImages()));
      return messages && { messages };
    },
  })],
});
