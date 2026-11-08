/**
 * The `gen_image` tool's gateway side: validates what an agent asked for, runs it through the media registry, and
 * returns the staged media so the transcript renders it inline. A failed request comes back as one sentence the
 * agent can relay, never as a stack trace.
 */
import { readSessionRegistry } from "../sessions/sessions.ts";
import { generateMedia, type GeneratedMedia } from "../media/service.ts";
import { createMediaRegistry, type MediaRegistry } from "../media/registry.ts";
import { codexCredentialResolver } from "../media/codex-credential.ts";
import { readMediaSettings } from "../media/settings.ts";
import type { MediaAspect, MediaKind } from "../media/provider.ts";

export class MediaGenerationInputError extends Error {}

const ASPECTS: readonly MediaAspect[] = ["square", "landscape", "portrait"];

/** A test supplies its own registry and session lookup; production reads HUI's settings and registry. */
export type MediaGenerationDeps = {
  registry?: MediaRegistry;
  /** The caller's session record: its working directory decides which files belong to the Files view. */
  session?: (sessionId: string) => Promise<{ cwd: string } | undefined>;
  /** Where staged media is kept; tests point it at a temporary directory. */
  storeRoot?: string;
};

function aspectOf(value: unknown): MediaAspect {
  if (value === undefined) return "square";
  const aspect = ASPECTS.find((candidate) => candidate === value);
  if (!aspect) throw new MediaGenerationInputError("aspect must be square, landscape or portrait.");
  return aspect;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw new MediaGenerationInputError(`${field} must be a short string.`);
  return value.trim();
}

function defaultRegistry(): MediaRegistry {
  return createMediaRegistry({
    settings: () => readMediaSettings(),
    codexCredential: codexCredentialResolver(),
    // A key saved in Settings wins; the environment variable keeps a headless gateway usable before that page exists.
    geminiKey: async () => (await readMediaSettings()).gemini.apiKey ?? process.env["GEMINI_API_KEY"]?.trim() ?? undefined,
  });
}

export async function generateMediaForSession(
  callerSessionId: string,
  kind: MediaKind,
  params: Record<string, unknown>,
  deps: MediaGenerationDeps = {},
): Promise<GeneratedMedia> {
  const prompt = params["prompt"];
  if (typeof prompt !== "string" || !prompt.trim()) throw new MediaGenerationInputError("prompt must be a non-empty string.");
  if (prompt.length > 4_000) throw new MediaGenerationInputError("prompt must be at most 4000 characters.");
  const findSession = deps.session
    ?? (async (id: string) => (await readSessionRegistry()).sessions.find((session) => session.id === id));
  const session = await findSession(callerSessionId);
  if (!session) throw new MediaGenerationInputError("Conversation no longer exists.");
  const provider = optionalId(params["provider"], "provider");
  const model = optionalId(params["model"], "model");
  return generateMedia(deps.registry ?? defaultRegistry(), {
    kind,
    prompt: prompt.trim(),
    aspect: aspectOf(params["aspect"]),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  }, { workspace: session.cwd, ...(deps.storeRoot ? { storeRoot: deps.storeRoot } : {}) });
}
