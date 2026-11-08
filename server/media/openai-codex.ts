/**
 * Image generation over a connected ChatGPT/Codex subscription: the same native images endpoint OpenAI's own Codex
 * client uses (`codex-rs/codex-api`), authorized by the OAuth credential HUI already brokers for chat, so no
 * `OPENAI_API_KEY` is needed. The backend answers 403 when a plan does not include image generation, which this
 * provider reports as itself rather than as a generic failure.
 */
import { MediaProviderError, type GeneratedMedia, type MediaAspect, type MediaKind, type MediaProvider, type MediaRequest } from "./provider.ts";

export const CODEX_IMAGE_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_IMAGE_MODELS = ["gpt-image-2", "gpt-image-1.5"] as const;

/** Pixel size per aspect, all valid for the images endpoint. */
const SIZES: Record<MediaAspect, string> = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" };

type Claims = {
  accountId?: string;
  residency?: string;
};

/** The workspace headers the backend derives from the OAuth JWT; a malformed token simply omits them. */
export function codexClaims(accessToken: string): Claims {
  const parts = accessToken.split(".");
  if (parts.length < 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[1]!)) return {};
  try {
    const auth = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"))?.["https://api.openai.com/auth"];
    const accountId = typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
    const residency = auth?.chatgpt_data_residency ?? auth?.chatgpt_compute_residency;
    return { ...(accountId ? { accountId } : {}), ...(typeof residency === "string" && residency ? { residency } : {}) };
  } catch {
    return {};
  }
}

/** `(accessToken, baseUrl)` for the connected subscription, or `(undefined, undefined)` when there is none. */
export type CodexCredential = { accessToken: string; baseUrl?: string };

export function codexImageProvider(options: {
  resolveCredential: () => Promise<CodexCredential | undefined>;
  fetch?: typeof fetch;
}): MediaProvider {
  const request = options.fetch ?? fetch;
  return {
    id: "openai-codex",
    name: "OpenAI (ChatGPT subscription)",
    kinds: ["image"],
    models: (kind: MediaKind) => (kind === "image" ? CODEX_IMAGE_MODELS : []),
    async available() {
      return (await options.resolveCredential()) !== undefined;
    },
    async generate(input: MediaRequest): Promise<GeneratedMedia> {
      if (input.kind !== "image") throw new MediaProviderError("A ChatGPT subscription generates images here, not videos.");
      const credential = await options.resolveCredential();
      if (!credential) throw new MediaProviderError("No ChatGPT account is connected. Connect one in Settings → Models.");
      const claims = codexClaims(credential.accessToken);
      const response = await request(`${(credential.baseUrl ?? CODEX_IMAGE_BASE_URL).replace(/\/+$/u, "")}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "Content-Type": "application/json",
          // The endpoint identifies the harness and its workspace; without the residency header a workspace bound
          // to a region answers 401 instead of generating.
          "User-Agent": "codex_cli_rs/0.0.0",
          originator: "codex_cli_rs",
          ...(claims.accountId ? { "ChatGPT-Account-ID": claims.accountId } : {}),
          ...(claims.residency ? { "x-openai-internal-codex-residency": claims.residency } : {}),
        },
        body: JSON.stringify({ prompt: input.prompt, model: input.model, size: SIZES[input.aspect], n: 1 }),
      });
      const body = await response.text();
      if (!response.ok) throw new MediaProviderError(refusal(response.status, body));
      let encoded: unknown;
      try {
        encoded = (JSON.parse(body) as { data?: Array<{ b64_json?: unknown }> }).data?.[0]?.b64_json;
      } catch {
        throw new MediaProviderError("OpenAI answered with something other than an image.");
      }
      if (typeof encoded !== "string" || !encoded) throw new MediaProviderError("OpenAI answered without an image.");
      return { bytes: Buffer.from(encoded, "base64"), mimeType: "image/png", extension: "png" };
    },
  };
}

/** The one sentence the operator needs, per status the backend is known to answer. */
function refusal(status: number, body: string): string {
  if (status === 401) return "OpenAI rejected the connected account. Sign in again in Settings → Models.";
  if (status === 403) return "This ChatGPT plan does not include image generation; a Plus or Pro plan does.";
  if (status === 429) return "The ChatGPT account reached its image limit. Try again once its usage window resets.";
  const detail = (() => {
    try {
      const message = (JSON.parse(body) as { detail?: unknown; error?: { message?: unknown } }).detail;
      return typeof message === "string" ? message : undefined;
    } catch {
      return undefined;
    }
  })();
  return `OpenAI refused the request (${status})${detail ? `: ${detail.slice(0, 200)}` : "."}`;
}
