/**
 * Which media provider serves a request. It reads HUI's media settings, asks each provider whether it has
 * credentials, and refuses with the reason a request cannot be served instead of picking something that will fail
 * later. Providers themselves never know about settings or each other. The Gemini account route is opt-in: it drives
 * a browser tab on the operator's Google session, so it is never picked by default.
 */
import { MediaProviderError, type MediaKind, type MediaProvider } from "./provider.ts";
import { codexImageProvider, type CodexCredential } from "./openai-codex.ts";
import { geminiAppProvider, type GeminiPage } from "./gemini-web.ts";
import { geminiImageProvider } from "./gemini-api.ts";
import { MEDIA_PROVIDERS, type MediaProviderId, type MediaSettings } from "./settings.ts";

export type ChosenProvider = { provider: MediaProvider; model: string };

export type MediaRegistry = {
  /** Every provider, available or not, for the settings page and the refusal messages. */
  providers(): MediaProvider[];
  available(kind: MediaKind): Promise<MediaProvider[]>;
  /** The provider and model that will serve `kind`, honoring `requested` and then the operator's preference. */
  choose(kind: MediaKind, requested?: string): Promise<ChosenProvider>;
};

/** The account route opens a tab on the operator's Google session, so only an explicit choice may select it. */
const OPT_IN = "gemini-web";

export function createMediaRegistry(deps: {
  settings: () => Promise<MediaSettings>;
  codexCredential: () => Promise<CodexCredential | undefined>;
  geminiKey: () => Promise<string | undefined>;
  /** HUI's browser for the calling conversation; absent when that conversation cannot drive one. */
  geminiPage?: () => Promise<GeminiPage | undefined>;
  fetch?: typeof fetch;
}): MediaRegistry {
  const codex = codexImageProvider({ resolveCredential: deps.codexCredential, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  const gemini = geminiImageProvider({ apiKey: deps.geminiKey, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  const app = geminiAppProvider({ page: deps.geminiPage ?? (async () => undefined) });
  const providers = [codex, app, gemini];
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  async function available(kind: MediaKind, settings: MediaSettings): Promise<MediaProvider[]> {
    const usable: MediaProvider[] = [];
    for (const provider of providers) {
      if (!provider.kinds.includes(kind)) continue;
      if (provider.id === OPT_IN && settings.preferred[kind] !== OPT_IN) continue;
      if (await provider.available()) usable.push(provider);
    }
    return usable;
  }

  return {
    providers: () => [...providers],
    available: async (kind: MediaKind) => available(kind, await deps.settings()),
    async choose(kind: MediaKind, requested?: string): Promise<ChosenProvider> {
      const settings = await deps.settings();
      const wanted = requested ?? settings.preferred[kind];
      if (wanted !== undefined && !MEDIA_PROVIDERS.some((id: MediaProviderId) => id === wanted)) {
        throw new MediaProviderError(`Unknown media provider: ${String(wanted).slice(0, 60)}.`);
      }
      const provider = wanted === undefined ? (await available(kind, settings))[0] : byId.get(wanted);
      if (!provider) throw new MediaProviderError(noProviderMessage(kind, wanted));
      if (!provider.kinds.includes(kind)) throw new MediaProviderError(`${provider.name} does not generate ${kind}s.`);
      if (!(await provider.available())) throw new MediaProviderError(unconfiguredMessage(provider));
      const model = settings.models[provider.id as MediaProviderId] ?? provider.models(kind)[0];
      if (!model) throw new MediaProviderError(`${provider.name} offers no ${kind} model.`);
      return { provider, model };
    },
  };
}

function noProviderMessage(kind: MediaKind, wanted: string | undefined): string {
  return wanted === undefined
    ? `No ${kind} provider is configured. Connect a ChatGPT account in Settings → Models, choose the Gemini account route, or add a Gemini API key.`
    : `The ${wanted} provider is not available for ${kind}s.`;
}

function unconfiguredMessage(provider: MediaProvider): string {
  if (provider.id === "openai-codex") return "No ChatGPT account is connected. Connect one in Settings → Models.";
  if (provider.id === OPT_IN) return "The Gemini account route needs HUI's browser: turn it on in Settings → Tools → Browser, then sign in to Gemini once.";
  return `Add an API key for ${provider.name} in Settings → Media providers.`;
}
