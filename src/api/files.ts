/**
 * Browser client for the Files view's routes (`/__hui/sessions/:id/files…`, see docs/api.md). The gateway owns the
 * disk and resolves every path inside the conversation's working directory; this only sends requests with the
 * local-client header and turns refusals into errors, except a save conflict, which is an answer. It also downloads
 * the blobs behind media and file previews, and uploads a file with its progress and a no-progress deadline that
 * tells the body phase from the answer phase, over an XHR because only that reports how much of a body the browser has
 * sent.
 */
import type { FileEntry, FileRead, FileSaved, FilesInfo, FilesListing, FilesResolve, FilesSearch } from "./schema/files.ts";
import { filesBytes } from "../lib/files/copy.ts";
import { assertCurrentBuild } from "./offline.ts";
import { BODY_STALL_MS, CLIENT_HEADERS, fetchJson, trackedFetch } from "./request.ts";
import { reportReachable, reportRequestFailure } from "./ui-errors.ts";

export const MAX_RESOLVE_PATHS = 100;

/** Mirrors the gateway's cap (`MAX_UPLOAD_FILE_BYTES` in `server/files.ts`): the browser refuses a file the gateway
 * would refuse instead of sending gigabytes of it first. */
export const MAX_UPLOAD_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isMarkdownPath(path: string): boolean {
  return ["md", "markdown", "mdx"].includes(fileExtension(path));
}

const base = (sessionId: string, action = "") => `/__hui/sessions/${encodeURIComponent(sessionId)}/files${action ? `/${action}` : ""}`;
const withQuery = (url: string, query: Record<string, string>) => `${url}?${new URLSearchParams(query)}`;

/** A refusal the view shows as it is; `status` lets callers tell "already exists" (409) from the rest. */
export class FilesRequestError extends Error {
  status: number;
  code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return trackedFetch(url, { ...init, cache: "no-store", headers: { ...CLIENT_HEADERS, ...init.headers } });
}

async function failure(response: Response): Promise<FilesRequestError> {
  const body = await response.json().catch(() => undefined) as { error?: string; code?: string } | undefined;
  return new FilesRequestError(body?.error ?? `The gateway answered HTTP ${response.status}.`, response.status, body?.code);
}

export function loadFilesInfo(sessionId: string): Promise<FilesInfo> {
  return fetchJson<FilesInfo>(base(sessionId));
}

export async function listDirectory(sessionId: string, path: string): Promise<FilesListing> {
  const response = await request(withQuery(base(sessionId, "list"), { path }));
  if (!response.ok) throw await failure(response);
  return await response.json() as FilesListing;
}

export async function searchFiles(sessionId: string, query: string, signal?: AbortSignal): Promise<FilesSearch> {
  const response = await request(withQuery(base(sessionId, "search"), { q: query }), signal ? { signal } : {});
  if (!response.ok) throw await failure(response);
  return await response.json() as FilesSearch;
}

/** Which of `paths` (as the agent wrote them in the chat) exist inside the working directory. */
export async function resolveFilePaths(sessionId: string, paths: string[]): Promise<FilesResolve> {
  const response = await request(base(sessionId, "resolve"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) throw await failure(response);
  return await response.json() as FilesResolve;
}

export async function readFile(sessionId: string, path: string): Promise<FileRead> {
  const response = await request(withQuery(base(sessionId, "file"), { path }));
  if (!response.ok) throw await failure(response);
  return await response.json() as FileRead;
}

/** Saves text over the version `etag` names. A changed file answers with its current content instead. */
export async function saveFile(sessionId: string, path: string, content: string, etag: string): Promise<{ saved: FileSaved } | { conflict: FileRead }> {
  const response = await request(withQuery(base(sessionId, "file"), { path }), {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": `"${etag}"` },
    body: JSON.stringify({ content }),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => undefined) as { current?: FileRead; error?: string } | undefined;
    if (body?.current) return { conflict: body.current };
    throw new FilesRequestError(body?.error ?? "The file changed on disk.", 409);
  }
  if (!response.ok) throw await failure(response);
  return { saved: await response.json() as FileSaved };
}

/** A file's bytes as a blob (image and PDF previews, downloads). The route needs the client header, so an element
 * cannot point at it directly. */
export async function fetchRawFile(sessionId: string, path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await request(withQuery(base(sessionId, "raw"), { path }), signal ? { signal } : {});
  if (!response.ok) throw await failure(response);
  return await response.blob();
}

export async function fetchBlob(src: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`The image could not be downloaded (HTTP ${response.status}).`);
  return response.blob();
}

export async function fetchPreviewBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

export async function createEntry(sessionId: string, path: string, kind: "file" | "directory"): Promise<FileEntry> {
  const response = await request(base(sessionId, "entry"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, kind }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json() as { entry: FileEntry }).entry;
}

export async function deleteEntry(sessionId: string, path: string, recursive: boolean): Promise<void> {
  const response = await request(withQuery(base(sessionId, "entry"), { path, ...(recursive ? { recursive: "1" } : {}) }), { method: "DELETE" });
  if (!response.ok) throw await failure(response);
}

/** Uploads one file into a folder; an existing file answers 409 unless `overwrite`. */
export type UploadOptions = {
  /** How much of the file the browser has sent so far, in bytes, and the file's size. */
  onProgress?: (sent: number, total: number) => void;
  /** Cancels the upload; the gateway removes what it wrote so far. */
  signal?: AbortSignal;
};

export async function uploadFile(
  sessionId: string,
  directory: string,
  file: File,
  overwrite: boolean,
  options: UploadOptions = {},
): Promise<FileEntry> {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new FilesRequestError(`“${file.name}” is larger than ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024 * 1024)} GB.`, 413);
  }
  const url = withQuery(base(sessionId, "upload"), { dir: directory, name: file.name, ...(overwrite ? { overwrite: "1" } : {}) });
  // XHR rather than fetch: only `XMLHttpRequest.upload` reports progress on every browser HUI runs on.
  await assertCurrentBuild(options.signal);
  return await new Promise<FileEntry>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("The upload was cancelled.", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    // How much of the body the browser last reported as sent, so a stall can say how far it got.
    let sent = 0;
    let total = file.size;
    // Whether every byte of the body is out: the deadline's two messages, and what it waits on, differ by this.
    let bodySent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const cancel = () => request.abort();
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
      options.signal?.removeEventListener("abort", cancel);
    };
    /** Every terminal path settles once: clearing the deadline first makes the abort a stall itself fires a no-op, so
     * it can never replace the stall's rejection with a cancellation. */
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      stop();
      finish();
    };
    /** What a stall says depends on the phase it caught. While bytes are still going out the gateway cannot have
     * written anything: it renames into place only once the whole body has arrived. Once every byte is out the rename
     * may already have happened, and the abort below cannot undo it, so claiming the file was rolled back would be
     * false; the folder is what tells the operator which it was. */
    const stalled = (percent: number) => bodySent
      ? `“${file.name}” sent all of ${filesBytes(total)}, but HUI did not answer. The upload may have finished; check the folder.`
      : `“${file.name}” stopped uploading at ${percent}% (${filesBytes(sent)} of ${filesBytes(total)} sent). Nothing was saved and the folder is unchanged. Check the connection and try again.`;
    /** A body that stops arriving fires neither `load`, `error` nor `abort`, so the upload would never answer and its
     * bytes would sit in a temporary file beside the target. The deadline measures progress only: a large upload that
     * keeps sending is never aborted. */
    const arm = () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => settle(() => {
        const percent = total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 0;
        const error = new FilesRequestError(stalled(percent), 0);
        reject(error);
        request.abort();
      }), BODY_STALL_MS);
    };
    /** The body is out whole, so the deadline now waits for the answer rather than the body and gets its own window.
     * `XMLHttpRequestUpload`'s `load` is the browser saying exactly that; a final `progress` reporting every byte is
     * the same news a moment earlier. */
    const bodyComplete = () => {
      if (settled || bodySent) return;
      bodySent = true;
      arm();
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    request.upload.addEventListener("progress", (event) => {
      if (settled) return;
      sent = event.loaded;
      total = event.lengthComputable ? event.total : file.size;
      arm();
      // A progress event that accounts for every byte means the body is out: the gateway may rename it into place from
      // here on, so a deadline after this point must never promise the folder is unchanged.
      if (event.lengthComputable && event.total > 0 && event.loaded >= event.total) bodyComplete();
      options.onProgress?.(sent, total);
    });
    request.upload.addEventListener("load", bodyComplete);
    request.addEventListener("load", () => settle(() => {
      reportReachable();
      if (request.status === 201) {
        resolve((JSON.parse(request.responseText) as { entry: FileEntry }).entry);
        return;
      }
      const body = (() => {
        try {
          return JSON.parse(request.responseText) as { error?: string; code?: string };
        } catch {
          return undefined;
        }
      })();
      reject(new FilesRequestError(body?.error ?? `The gateway answered HTTP ${request.status}.`, request.status, body?.code));
    }));
    request.addEventListener("error", () => settle(() => {
      const error = new FilesRequestError("Could not reach HUI. Check the connection and try again.", 0);
      reportRequestFailure(error, { method: "POST", path: new URL(url, location.href).pathname });
      reject(error);
    }));
    request.addEventListener("abort", () => settle(() => reject(new DOMException("The upload was cancelled.", "AbortError"))));
    request.open("POST", url);
    for (const [name, value] of Object.entries(CLIENT_HEADERS)) request.setRequestHeader(name, value);
    request.setRequestHeader("content-type", "application/octet-stream");
    request.send(file);
    arm();
  });
}

/** Whether a failed upload was cancelled by its caller rather than refused. */
export function isUploadCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
