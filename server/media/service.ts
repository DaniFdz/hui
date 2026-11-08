/**
 * Runs one media request and hands its result to the chat: the bytes come from a provider, are staged in HUI's
 * presented-media store, and only the staged capability reaches the transcript. The temporary file a provider wrote
 * never survives the call, so a generation leaves nothing behind in the session's workspace.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stagePresentedMedia, type PresentedMedia } from "../agent-tools/presented-media.ts";
import { attempt, MediaProviderError, type MediaAspect, type MediaKind } from "./provider.ts";
import type { MediaRegistry } from "./registry.ts";

export type GeneratedMedia = { media: PresentedMedia[]; provider: string; model: string; kind: MediaKind };

/** What a tool call asks for, before a provider and model are chosen. */
export type MediaGenerationInput = {
  kind: MediaKind;
  prompt: string;
  aspect: MediaAspect;
  /** A provider id the caller asked for; the operator's preference decides when it is absent. */
  provider?: string;
  model?: string;
};

const MIME_TYPES = /^(image|video)\/(png|jpeg|webp|gif|avif|mp4|webm|quicktime)$/u;

export async function generateMedia(
  registry: MediaRegistry,
  request: MediaGenerationInput,
  options: { workspace: string; signal?: AbortSignal; storeRoot?: string },
): Promise<GeneratedMedia> {
  const chosen = await registry.choose(request.kind, request.provider);
  const model = request.model ?? chosen.model;
  const allowed = chosen.provider.models(request.kind);
  if (!allowed.includes(model)) {
    throw new MediaProviderError(`${chosen.provider.name} does not offer ${model} for ${request.kind}s. Choose one of: ${allowed.join(", ")}.`);
  }
  const generated = await attempt(chosen.provider, { kind: request.kind, prompt: request.prompt, aspect: request.aspect, model }, options);
  if (!MIME_TYPES.test(generated.mimeType)) throw new MediaProviderError(`${chosen.provider.name} returned an unsupported file type.`);
  if (!generated.bytes.length) throw new MediaProviderError(`${chosen.provider.name} returned an empty file.`);
  const directory = await mkdtemp(join(tmpdir(), "hui-media-"));
  try {
    const name = `${request.kind}-1.${generated.extension.replace(/[^a-z0-9]/giu, "") || "png"}`;
    await writeFile(join(directory, name), generated.bytes);
    // The workspace decides whether the file belongs to the conversation's Files view. A generated file never does,
    // because it is staged from a temporary directory outside that workspace.
    const media = await stagePresentedMedia(options.workspace, [join(directory, name)], options.storeRoot);
    return { media, provider: chosen.provider.id, model, kind: request.kind };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
