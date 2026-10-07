/**
 * Validation and labels for media a tool presented in chat. Only well-formed items pointing at HUI's own
 * `/__hui/media/` URLs are shown; anything else in a tool's details is ignored.
 */
export type PresentedMediaItem = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "file";
  mimeType: string;
  size: number;
  url: string;
};

const MEDIA_URL = /^\/__hui\/media\/[0-9a-f]{8}-[0-9a-f-]{27,}\/[A-Za-z0-9%._~!$&'()*+,;=:@-]+$/u;

function mediaItem(value: unknown): PresentedMediaItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item["id"] !== "string" ||
    typeof item["name"] !== "string" || !item["name"] ||
    !(item["kind"] === "image" || item["kind"] === "video" || item["kind"] === "audio" || item["kind"] === "file") ||
    typeof item["mimeType"] !== "string" ||
    typeof item["size"] !== "number" || !Number.isSafeInteger(item["size"]) || item["size"] < 0 ||
    typeof item["url"] !== "string" || !MEDIA_URL.test(item["url"])
  ) return undefined;
  return item as PresentedMediaItem;
}

export function presentedMediaFromDetails(details: unknown): PresentedMediaItem[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const raw = (details as Record<string, unknown>)["media"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return [];
  const parsed = raw.map(mediaItem);
  return parsed.every((item): item is PresentedMediaItem => item !== undefined) ? parsed : [];
}

export function mediaSizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
