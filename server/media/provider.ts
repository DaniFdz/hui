/**
 * The contract every media-generation backend implements, and the errors it reports. A provider turns one prompt
 * into one file's bytes; it never decides where the file lives, how it is shown, or how a long job is tracked,
 * because those belong to `service.ts` and `jobs.ts`.
 */

export type MediaKind = "image" | "video";

export type MediaAspect = "square" | "landscape" | "portrait";

export type MediaRequest = {
  kind: MediaKind;
  prompt: string;
  aspect: MediaAspect;
  /** The provider's own model id, already validated against `models`. */
  model: string;
};

/** One generated file, in memory: small enough for images, which the provider returns inline. */
export type GeneratedMedia = {
  bytes: Buffer;
  mimeType: string;
  extension: string;
};

/** A provider a request cannot use, worded for the agent to relay to the operator. */
export class MediaProviderError extends Error {}

export type MediaProvider = {
  /** Stable id, also the key in HUI's media settings. */
  readonly id: string;
  readonly name: string;
  /** The kinds this provider can produce today. */
  readonly kinds: readonly MediaKind[];
  /** Model ids it accepts for `kind`, cheapest first. */
  models(kind: MediaKind): readonly string[];
  /** Whether its credentials are present, without contacting the provider. */
  available(): Promise<boolean>;
  /** Why a request was refused, when the provider knows better than a generic failure. */
  generate(request: MediaRequest, options?: { signal?: AbortSignal }): Promise<GeneratedMedia>;
};

/** A provider's answer, with its failure turned into one sentence an agent can act on. */
export async function attempt(provider: MediaProvider, request: MediaRequest, options?: { signal?: AbortSignal }): Promise<GeneratedMedia> {
  try {
    return await provider.generate(request, options);
  } catch (error) {
    if (error instanceof MediaProviderError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new MediaProviderError(`${provider.name} could not generate this ${request.kind}: ${detail.slice(0, 300)}`);
  }
}
