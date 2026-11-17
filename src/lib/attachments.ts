/**
 * Turning browser `File` objects into attachments.
 *
 * Everything travels as base64 because that is what both the HTTP body and pi's
 * `images` field want. Images are also kept as data URLs so the composer can
 * show a thumbnail without a second read. Every refusal is worded here once: the
 * fact, then what the operator can do instead, so a pick and a send say the same.
 * A conversation on a remote worker has no way out to name, so it is told the
 * fact alone rather than sent to a pane that answers 409.
 */
import type { Attachment } from "../api/sessions.ts";

/** pi accepts these natively as image content. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Files are handed to the agent as paths, so anything readable is allowed;
 * this only guards against something absurd being base64'd into memory. */
export const MAX_ATTACHMENT_COUNT = 8;
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_PROMPT_ATTACHMENT_BYTES = 16 * 1024 * 1024;

/** The Files pane's own cap on one file. `src/api/files.ts` exports the same number as `MAX_UPLOAD_FILE_BYTES`, but
 * R6 in `docs/map.md` keeps `src/lib/` from reading a value out of `src/api/`, so it is mirrored here: a test holds
 * the two equal, and `attachments.fixture.json` holds this side to the gateway's copy. */
export const MAX_FILES_PANE_BYTES = 2 * 1024 * 1024 * 1024;

const UNSAFE_NAME_MESSAGE = "Attachment names must be 1–128 characters without path separators or controls.";

/** Mirrors the gateway boundary. Display names may contain Unicode and spaces,
 * but never path separators, traversal-only names, or control characters. */
export function isSafeAttachmentName(name: string): boolean {
  const characters = [...name];
  return (
    characters.length > 0 &&
    characters.length <= 128 &&
    name.trim().length > 0 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/\p{Cc}]/u.test(name)
  );
}

export function isImageType(mimeType: string): boolean {
  return IMAGE_TYPES.has(mimeType);
}

/** What a refusal may end with. The Files pane is the way out of a size refusal, but a conversation on a remote
 * worker has none: its files live on that machine and the pane answers 409, so naming it there would point at a way
 * out that does not exist. Defaults to offering it, which is every conversation the gateway's disk serves. */
export type AttachmentRefusalOptions = { filesPane?: boolean };

/** The way out of a size refusal, or nothing when this conversation has no Files pane to offer. */
function filesPaneInstead(options: AttachmentRefusalOptions): readonly string[] {
  return options.filesPane === false
    ? []
    : [`Larger files can go in the Files pane, which takes up to ${MAX_FILES_PANE_BYTES / (1024 * 1024 * 1024)} GB each.`];
}

/** The fact, then the way out when there is one: one space between sentences and none after the last. */
function sentences(...parts: readonly string[]): string {
  return parts.join(" ");
}

export function attachmentTooLargeMessage(name: string, options: AttachmentRefusalOptions = {}): string {
  return sentences(`${name} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`, ...filesPaneInstead(options));
}

/** Too many files is not a size problem, so the Files pane is no answer: the rest go in another message. */
export function attachmentCountMessage(): string {
  return `At most ${MAX_ATTACHMENT_COUNT} attachments may be sent at once. Send the rest in another message.`;
}

export function attachmentTotalMessage(options: AttachmentRefusalOptions = {}): string {
  return sentences(`Attachments must be ${MAX_PROMPT_ATTACHMENT_BYTES / (1024 * 1024)} MB or less in total.`, ...filesPaneInstead(options));
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked so a large file cannot blow the argument limit of `fromCharCode`.
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Throws a message worth showing when a file is too big or unreadable. */
export async function readAttachment(file: File, options: AttachmentRefusalOptions = {}): Promise<Attachment> {
  if (!isSafeAttachmentName(file.name)) {
    throw new Error(UNSAFE_NAME_MESSAGE);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(attachmentTooLargeMessage(file.name, options));
  }
  const mimeType = file.type || "application/octet-stream";
  return {
    kind: isImageType(mimeType) ? "image" : "file",
    name: file.name,
    mimeType,
    dataBase64: toBase64(await file.arrayBuffer()),
  };
}

export function attachmentBytes(attachment: Attachment): number {
  const padding = attachment.dataBase64.endsWith("==") ? 2 : attachment.dataBase64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((attachment.dataBase64.length * 3) / 4) - padding);
}

/** The refusal to show for a set of attachments, if any. Not thrown, because a send refuses into a note rather than
 * through a catch, and both read the one wording above. */
export function attachmentRefusal(attachments: readonly Attachment[], options: AttachmentRefusalOptions = {}): string | undefined {
  if (attachments.length > MAX_ATTACHMENT_COUNT) return attachmentCountMessage();
  for (const item of attachments) {
    if (!isSafeAttachmentName(item.name)) return UNSAFE_NAME_MESSAGE;
    if (attachmentBytes(item) > MAX_ATTACHMENT_BYTES) return attachmentTooLargeMessage(item.name, options);
  }
  const total = attachments.reduce((sum, item) => sum + attachmentBytes(item), 0);
  return total > MAX_PROMPT_ATTACHMENT_BYTES ? attachmentTotalMessage(options) : undefined;
}

export function validateAttachmentTotal(attachments: readonly Attachment[], options: AttachmentRefusalOptions = {}): void {
  const refused = attachmentRefusal(attachments, options);
  if (refused) throw new Error(refused);
}

/** A data URL for an attachment already in memory, for thumbnails. */
export function attachmentPreview(attachment: Attachment): string | undefined {
  return attachment.kind === "image"
    ? `data:${attachment.mimeType};base64,${attachment.dataBase64}`
    : undefined;
}
