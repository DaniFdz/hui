/**
 * The Files view's wire shapes: what `/__hui/sessions/:id/files…` answers and accepts. The gateway
 * (`server/files.ts`, `server/file-routes.ts`) produces them; the browser (`src/lib/files-store.ts`) consumes them.
 * Every `path` is relative to the conversation's working directory, `/`-separated, and `""` names that directory.
 */

/** What an entry is. A symlink whose target stays inside the working directory reports its target's kind with
 * `symlink: true`; one that points outside (or nowhere) stays `"symlink"` and cannot be opened. */
export type FileEntryKind = "directory" | "file" | "symlink" | "other";

export type FileEntry = {
  name: string;
  path: string;
  kind: FileEntryKind;
  /** Bytes for a file, 0 otherwise. */
  size: number;
  symlink?: true;
};

/** `GET …/files`: whether this conversation's files can be shown at all. */
export type FilesInfo =
  | { available: true; root: string; name: string }
  | { available: false; reason: string };

export type FilesListing = { path: string; entries: FileEntry[]; truncated: boolean };

export type FilesSearch = { query: string; entries: FileEntry[]; truncated: boolean; source: "git" | "walk" };

/** How a file opens: text in the editor, an image or PDF as a preview, anything else as metadata. */
export type FilePreviewKind = "text" | "image" | "pdf" | "binary" | "too-large";

/** `GET …/files/file`. `content` is verbatim UTF-8 (separators and BOM intact) and only present for `text`. The
 * etag is the content's hash for text, so a save can say which version it replaces. */
export type FileRead = {
  path: string;
  name: string;
  size: number;
  mtime: string;
  etag: string;
  writable: boolean;
  kind: FilePreviewKind;
  mimeType: string;
  content?: string;
};

/** `PUT …/files/file` success. */
export type FileSaved = { path: string; etag: string; size: number; mtime: string };

/** The editable text limit; larger text files open as `too-large`. */
export const MAX_EDITABLE_FILE_BYTES = 2_000_000;
/** Largest upload, and the largest file the raw route streams for a preview or download. */
export const MAX_RAW_FILE_BYTES = 64 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The type a preview is served with. SVG is text: it opens in the editor, not as an image. */
export function previewMimeType(name: string): string {
  const extension = fileExtension(name);
  if (extension === "pdf") return "application/pdf";
  return IMAGE_TYPES[extension] ?? "application/octet-stream";
}

export function isMarkdownPath(path: string): boolean {
  return ["md", "markdown", "mdx"].includes(fileExtension(path));
}
