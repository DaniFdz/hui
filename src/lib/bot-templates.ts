/**
 * Client half of importing and exporting bots (`/__hui/bots/import`, `/__hui/bots/:id/export`; the contract is in
 * docs/api.md#importing-and-exporting-bots). The browser never reads a template itself: it sends the picked file, folder,
 * link or text to the gateway, shows the preview it answers, and sends that preview's template back to create the bot.
 */
import { BOT_TEMPLATE_FORMATS, BOT_TEMPLATE_LIMITS, type BotImportPreview, type BotImportResult, type BotImportSource, type BotTemplate } from "../../shared/bot-templates.ts";
import { parseBot } from "./bots.ts";
import { CLIENT_HEADERS, fetchJson } from "./settings-store.ts";
import { trackedFetch } from "./ui-errors.ts";

export type { BotImportPreview, BotImportResult, BotImportSource } from "../../shared/bot-templates.ts";

const JSON_HEADERS = { "content-type": "application/json" } as const;
/** A preview may fetch a page or unpack an archive; creating starts a chat, its memory and maybe its first turn. */
const IMPORT_TIMEOUT_MS = 90_000;

/** Where an import's source comes from, as the dialog's tabs name them. */
export type BotImportTab = "file" | "link" | "paste";

/** What the File tab picked: a file or a folder, ready to send, with what to call it. */
export type PickedSource = { label: string; source: BotImportSource; size: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bytes as base64, in chunks a call stack takes. */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** One picked file; refused here when the gateway would refuse it anyway. */
export async function pickedFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<PickedSource> {
  if (file.size > BOT_TEMPLATE_LIMITS.fileBytes) throw new Error(`${file.name} is larger than ${megabytes(BOT_TEMPLATE_LIMITS.fileBytes)}.`);
  return { label: file.name, size: file.size, source: { kind: "file", name: file.name, data: base64(new Uint8Array(await file.arrayBuffer())) } };
}

/** A picked folder (`webkitdirectory`): each file by its path inside it. */
export async function pickedFolder(files: readonly Pick<File, "name" | "size" | "arrayBuffer" | "webkitRelativePath">[]): Promise<PickedSource> {
  if (!files.length) throw new Error("That folder is empty.");
  if (files.length > BOT_TEMPLATE_LIMITS.files) throw new Error(`That folder holds ${files.length} files; HUI imports at most ${BOT_TEMPLATE_LIMITS.files}.`);
  const size = files.reduce((sum, file) => sum + file.size, 0);
  if (size > BOT_TEMPLATE_LIMITS.totalBytes) throw new Error(`That folder holds more than ${megabytes(BOT_TEMPLATE_LIMITS.totalBytes)}.`);
  const entries = await Promise.all(files.map(async (file) => ({ path: file.webkitRelativePath || file.name, data: base64(new Uint8Array(await file.arrayBuffer())) })));
  const folder = entries[0]!.path.split("/")[0] ?? "folder";
  return { label: `${folder}/ (${files.length} file${files.length === 1 ? "" : "s"})`, size, source: { kind: "files", files: entries } };
}

/** The source the dialog's state describes, or what is missing. */
export function importSource(tab: BotImportTab, state: { picked?: PickedSource | undefined; url: string; text: string }): BotImportSource | string {
  if (tab === "file") return state.picked?.source ?? "Choose a file or a folder first.";
  if (tab === "link") return state.url.trim() ? { kind: "url", url: state.url.trim() } : "Paste a Grok Bot marketplace link first.";
  return state.text.trim() ? { kind: "text", text: state.text } : "Paste a template first.";
}

/** The gateway's preview, narrowed: a malformed answer is an error, never half a preview. */
export function parseBotImportPreview(body: unknown): BotImportPreview {
  if (!isRecord(body) || !isRecord(body["template"]) || !isRecord(body["bot"]) || typeof body["soul"] !== "string") throw new Error("The import preview did not come back.");
  const lists = ["skills", "routines", "integrations", "disabledTools", "disabledSkills", "dropped", "notes"];
  if (lists.some((key) => !Array.isArray(body[key])) || !isRecord(body["memories"])) throw new Error("The import preview did not come back.");
  const format = (body["template"] as { format?: unknown }).format;
  if (typeof format !== "string" || !(format in BOT_TEMPLATE_FORMATS)) throw new Error("The import preview names a format this HUI does not know.");
  return body as unknown as BotImportPreview;
}

/** `POST /__hui/bots/import/preview`: what creating the source's bot would do. Nothing is created. */
export async function previewBotImport(request: { source: BotImportSource; pick?: string; worker?: string }): Promise<BotImportPreview> {
  return parseBotImportPreview(await fetchJson<unknown>("/__hui/bots/import/preview", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify(request), signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
  }));
}

/** `POST /__hui/bots/import`: creates the bot a preview showed. */
export async function importBot(template: BotTemplate, worker?: string): Promise<BotImportResult> {
  const body = await fetchJson<unknown>("/__hui/bots/import", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ template, ...(worker ? { worker } : {}) }), signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
  });
  const bot = isRecord(body) ? parseBot(body["bot"]) : undefined;
  if (!isRecord(body) || !bot) throw new Error("The bot was imported but could not be read back.");
  return {
    bot,
    skills: Array.isArray(body["skills"]) ? body["skills"].filter((name): name is string => typeof name === "string") : [],
    routines: typeof body["routines"] === "number" ? body["routines"] : 0,
    opener: body["opener"] === true,
    warnings: Array.isArray(body["warnings"]) ? body["warnings"].filter((line): line is string => typeof line === "string") : [],
  };
}

/** The file name a download's Content-Disposition gives, else `fallback`. */
export function downloadName(disposition: string | null, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch { /* the plain name below */ }
  }
  return /filename="([^"]+)"/iu.exec(disposition ?? "")?.[1] ?? fallback;
}

/** `GET /__hui/bots/:id/export`, saved as a download. Resolves with the file's name. */
export async function downloadBotExport(id: string, options: { memory: boolean; fallbackName: string }): Promise<string> {
  const response = await trackedFetch(`/__hui/bots/${encodeURIComponent(id)}/export${options.memory ? "?memory=1" : ""}`, {
    headers: CLIENT_HEADERS, cache: "no-store", signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(detail?.error ?? `The export returned HTTP ${response.status}.`);
  }
  const name = downloadName(response.headers.get("content-disposition"), options.fallbackName);
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return name;
}
