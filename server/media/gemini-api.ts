/**
 * Image generation over the Gemini Developer API with an AI Studio key: Nano Banana's `generateContent` with an
 * image response modality. A Google AI Pro/Ultra subscription does not authorize this endpoint, so the key is the
 * whole credential and `settings.ts` owns it.
 */
import { MediaProviderError, type GeneratedMedia, type MediaAspect, type MediaKind, type MediaProvider, type MediaRequest } from "./provider.ts";

export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_IMAGE_MODELS = ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"] as const;

const ASPECT_RATIOS: Record<MediaAspect, string> = { square: "1:1", landscape: "16:9", portrait: "9:16" };

export function geminiImageProvider(options: {
  apiKey: () => Promise<string | undefined>;
  fetch?: typeof fetch;
}): MediaProvider {
  const request = options.fetch ?? fetch;
  return {
    id: "gemini",
    name: "Google Gemini (API key)",
    kinds: ["image"],
    models: (kind: MediaKind) => (kind === "image" ? GEMINI_IMAGE_MODELS : []),
    async available() {
      return Boolean(await options.apiKey());
    },
    async generate(input: MediaRequest): Promise<GeneratedMedia> {
      if (input.kind !== "image") throw new MediaProviderError("The Gemini image key generates images here, not videos.");
      const key = await options.apiKey();
      if (!key) throw new MediaProviderError("No Gemini API key is configured. Add one in Settings → Media providers.");
      const response = await request(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(input.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ASPECT_RATIOS[input.aspect] } },
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new MediaProviderError(refusal(response.status, body));
      const parts = (() => {
        try {
          return (JSON.parse(body) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: unknown; data?: unknown } }> } }> })
            .candidates?.[0]?.content?.parts ?? [];
        } catch {
          return [];
        }
      })();
      const image = parts.find((part) => typeof part.inlineData?.data === "string" && part.inlineData.data)?.inlineData;
      if (!image || typeof image.data !== "string") throw new MediaProviderError("Gemini answered without an image; try a more explicit image prompt.");
      const mimeType = typeof image.mimeType === "string" ? image.mimeType : "image/png";
      return { bytes: Buffer.from(image.data, "base64"), mimeType, extension: mimeType === "image/jpeg" ? "jpg" : "png" };
    },
  };
}

function refusal(status: number, body: string): string {
  const detail = (() => {
    try {
      const error = (JSON.parse(body) as { error?: { message?: unknown } }).error;
      return typeof error?.message === "string" ? error.message : undefined;
    } catch {
      return undefined;
    }
  })();
  if (status === 400 && detail?.includes("API key")) return "Gemini rejected the API key. Check it in Settings → Media providers.";
  if (status === 401 || status === 403) return "Gemini refused this key; check it in Settings → Media providers.";
  if (status === 429) return "The Gemini API key reached its rate limit or free-tier quota. Try again later or enable billing on its project.";
  return `Gemini refused the request (${status})${detail ? `: ${detail.slice(0, 200)}` : "."}`;
}
