/**
 * Custom marks for tool rows: `chat.toolIcons` maps a CLI or tool name to a file in
 * `USER_TOOL_ICON_DIR`, and `/__hui/tool-icons/<file>` serves it read-only. Names are
 * flat file names (no paths, no traversal), the extension picks the MIME type, and an
 * SVG is served with a locked-down CSP because the browser only ever draws it in an
 * `<img>` — this route is the one place a user-supplied file reaches the browser.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { USER_TOOL_ICON_DIR } from "./paths.ts";

export const TOOL_ICON_ROUTE = "/__hui/tool-icons/";

/** 256 KB is generous for a 64px mark and keeps one file from stalling a render. */
export const MAX_TOOL_ICON_BYTES = 256_000;

const TOOL_ICON_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

const MIME_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** Whether a value may name an icon file: flat, bounded, and one of the four types the view can draw. */
export function isToolIconName(value: unknown): value is string {
  if (typeof value !== "string" || !TOOL_ICON_NAME.test(value)) return false;
  const extension = value.slice(value.lastIndexOf(".") + 1).toLowerCase();
  return Object.hasOwn(MIME_TYPES, extension);
}

export type ToolIconFile = { bytes: Buffer; type: string; etag: string };

/** The bytes of one icon, or undefined when the name is unsafe, missing or too large. */
export async function readToolIcon(name: string): Promise<ToolIconFile | undefined> {
  if (!isToolIconName(name)) return undefined;
  const path = join(USER_TOOL_ICON_DIR, name);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_TOOL_ICON_BYTES) return undefined;
    const bytes = await readFile(path);
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    return { bytes, type: MIME_TYPES[extension]!, etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"` };
  } catch {
    return undefined;
  }
}
