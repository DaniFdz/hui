/**
 * `/__hui/sessions/:id/files…`: the Files view's routes. It finds the conversation's working directory in the
 * registry, refuses conversations on a remote worker (their files are on that machine, not the gateway's disk), and
 * maps requests onto `FilesRoot` (`files.ts`). `hui.ts` applies the `x-hui` guard before dispatching here.
 */
import { displayPath } from "./working-directories.ts";
import { FilesError, FilesRoot, parseIfMatch } from "./files.ts";
import { MAX_EDITABLE_FILE_BYTES, MAX_RAW_FILE_BYTES, type FilesInfo } from "../shared/files.ts";
import { basename } from "node:path";

export const FILES_ROUTE = /^\/__hui\/sessions\/([^/]+)\/files(?:\/(list|search|file|raw|entry|upload))?$/u;

export const REMOTE_FILES_REASON = "Files are not available for conversations on a remote worker yet: their files live on that machine.";

export type FilesRouteRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  ifMatch: string | undefined;
  /** The parsed JSON body, limited to `maxBytes`. */
  json(maxBytes: number): Promise<unknown>;
  /** The raw body, limited to `maxBytes`. */
  bytes(maxBytes: number): Promise<Buffer>;
};

export type FilesRouteResult =
  | { status: number; body: unknown; etag?: string }
  | { status: number; file: { name: string; mimeType: string; data: Buffer; download: boolean } };

type SessionLocation = { cwd: string; worker?: string | undefined };

/** JSON text escapes and quotes: a 2 MB file can take a few times that on the wire. */
const SAVE_BODY_BYTES = MAX_EDITABLE_FILE_BYTES * 6 + 1024;

function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FilesError("Send a JSON object.", 400);
  return body as Record<string, unknown>;
}

export function createFileRoutes(deps: { session(id: string): Promise<SessionLocation | undefined> }) {
  async function info(location: SessionLocation): Promise<FilesInfo> {
    if (location.worker) return { available: false, reason: REMOTE_FILES_REASON };
    try {
      const root = await FilesRoot.open(location.cwd);
      return { available: true, root: displayPath(root.root), name: basename(root.root) || root.root };
    } catch (error) {
      if (error instanceof FilesError) return { available: false, reason: error.message };
      throw error;
    }
  }

  async function handle(request: FilesRouteRequest): Promise<FilesRouteResult | undefined> {
    const match = FILES_ROUTE.exec(request.path);
    if (!match) return undefined;
    const id = decodeURIComponent(match[1] ?? "");
    const action = match[2];
    try {
      const location = await deps.session(id);
      if (!location) return { status: 404, body: { error: `unknown session: ${id}` } };
      if (!action) {
        if (request.method !== "GET") return { status: 405, body: { error: "method not allowed" } };
        return { status: 200, body: await info(location) };
      }
      if (location.worker) return { status: 409, body: { error: REMOTE_FILES_REASON, code: "remote" } };
      const root = await FilesRoot.open(location.cwd);
      const path = request.query.get("path") ?? "";
      const method = request.method;
      if (action === "list" && method === "GET") return { status: 200, body: await root.list(path) };
      if (action === "search" && method === "GET") return { status: 200, body: await root.search(request.query.get("q") ?? "") };
      if (action === "file" && method === "GET") {
        const file = await root.read(path);
        return { status: 200, body: file, etag: file.etag };
      }
      if (action === "file" && method === "PUT") {
        let body: unknown;
        try { body = await request.json(SAVE_BODY_BYTES); } catch { throw new FilesError("Send the file as JSON: { \"content\": \"…\" }.", 400); }
        const fields = object(body);
        if (typeof fields["content"] !== "string" || Object.keys(fields).some((key) => key !== "content")) {
          throw new FilesError("Send only the file's text: { \"content\": \"…\" }.", 400);
        }
        const saved = await root.write(path, fields["content"], request.ifMatch);
        return { status: 200, body: saved, etag: saved.etag };
      }
      if (action === "raw" && method === "GET") {
        const raw = await root.raw(path);
        const preview = raw.mimeType.startsWith("image/") || raw.mimeType === "application/pdf";
        return { status: 200, file: { ...raw, download: !preview } };
      }
      if (action === "entry" && method === "POST") {
        let body: unknown;
        try { body = await request.json(64 * 1024); } catch { throw new FilesError("Send { \"path\": \"…\", \"kind\": \"file\" | \"directory\" }.", 400); }
        const fields = object(body);
        const kind = fields["kind"];
        if (typeof fields["path"] !== "string" || (kind !== "file" && kind !== "directory")) {
          throw new FilesError("Send { \"path\": \"…\", \"kind\": \"file\" | \"directory\" }.", 400);
        }
        return { status: 201, body: { entry: await root.create(fields["path"], kind) } };
      }
      if (action === "entry" && method === "DELETE") {
        const recursive = request.query.get("recursive") === "1";
        return { status: 200, body: { deleted: await root.remove(path, recursive) } };
      }
      if (action === "upload" && method === "POST") {
        const name = request.query.get("name") ?? "";
        const overwrite = request.query.get("overwrite") === "1";
        let data: Buffer;
        try { data = await request.bytes(MAX_RAW_FILE_BYTES); } catch { throw new FilesError("Uploads are limited to 64 MB.", 413); }
        return { status: 201, body: { entry: await root.upload(request.query.get("dir") ?? "", name, data, overwrite) } };
      }
      return { status: 405, body: { error: "method not allowed" } };
    } catch (error) {
      if (error instanceof FilesError) {
        return {
          status: error.status,
          body: { error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.current ? { current: error.current } : {}) },
        };
      }
      return { status: 500, body: { error: error instanceof Error ? error.message : "Files request failed." } };
    }
  }

  return { handle };
}

export { parseIfMatch };
