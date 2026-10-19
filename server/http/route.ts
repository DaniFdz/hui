/**
 * The request and result shape every route module (`server/routes/`) speaks. `hui.ts` turns an incoming message
 * into a `RouteRequest` (`routeRequest`) and writes the module's `RouteResult` back, so a module reads its body and
 * headers and answers JSON, HTML or a file without touching Node's HTTP objects. Also owns reading request bodies.
 */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 64 * 1024;

export type RouteRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  /** The parsed JSON body, at most `maxBytes` (64 KiB by default). */
  json(maxBytes?: number): Promise<unknown>;
  /** The raw body, at most `maxBytes`. */
  bytes(maxBytes: number): Promise<Buffer>;
  /** Aborts when the client goes away. */
  signal?: AbortSignal;
};

export type RouteFile = { mimeType: string; data: Buffer; headers: Record<string, string> };

export type JsonResult = { status: number; body: unknown; etag?: string };

export type RouteResult =
  | JsonResult
  | { status: number; html: string }
  | { status: number; file: RouteFile };

/** A request body as bytes, refusing anything past `maxBytes`. */
export async function readBytes(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return JSON.parse((await readBytes(request, maxBytes)).toString("utf8"));
}

export function routeRequest(request: IncomingMessage, response: ServerResponse, path: string): RouteRequest {
  const gone = new AbortController();
  response.once("close", () => gone.abort());
  return {
    method: request.method ?? "GET",
    path,
    query: new URL(request.url ?? "/", "http://localhost").searchParams,
    headers: request.headers,
    json: (maxBytes) => readBody(request, maxBytes),
    bytes: (maxBytes) => readBytes(request, maxBytes),
    signal: gone.signal,
  };
}

/** A file as itself: never sniffed or cached. */
export function sendFile(response: ServerResponse, status: number, file: RouteFile): void {
  response.statusCode = status;
  response.setHeader("content-type", file.mimeType);
  response.setHeader("content-length", String(file.data.length));
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  for (const [name, value] of Object.entries(file.headers)) response.setHeader(name, value);
  response.end(file.data);
}
