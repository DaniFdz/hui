/**
 * Extension panels' files: `<extension>/ui/…` served before the `x-hui` gate at `/__hui/ext-ui/<id>/…`, the way the
 * widget sandbox page is. Every file is contained by realpath, allowlisted by type and size, and carries the sandbox
 * CSP that makes the frame an opaque origin with no network. Assets are cross-origin to the frame's opaque origin, so
 * CORP must allow it to load its own CSS and JS. — the panel's only channel is the parent bridge.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

export const EXTENSION_ASSET_ROUTE = /^\/__hui\/ext-ui\/([a-z][a-z0-9-]{0,31})\/(.+)$/u;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const MIME: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  woff2: "font/woff2",
};

const PERMISSIONS = "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), serial=(), hid=()";

function originOf(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host || !/^[A-Za-z0-9.\-:[\]]+$/u.test(host)) return undefined;
  const forwarded = request.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" && forwarded.split(",")[0]?.trim() === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

/** Every source is the extension's own asset prefix: a panel can reach nothing else, and the frame cannot fetch. */
export function extensionAssetContentSecurityPolicy(origin: string, id: string): string {
  const base = `${origin}/__hui/ext-ui/${id}/`;
  return [
    "default-src 'none'",
    `script-src ${base} 'unsafe-inline'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `media-src ${base}`,
    "connect-src 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join("; ");
}

function fail(response: ServerResponse, status: number, error: string): void {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(`${JSON.stringify({ error })}\n`);
}

/** One file under `root`, or 404. A missing root means the extension is not loaded or has no `ui`. */
export async function serveExtensionAsset(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  relativePath: string,
  root: string | undefined,
): Promise<void> {
  if (!root) {
    fail(response, 404, "unknown extension panel");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    fail(response, 405, "method not allowed");
    return;
  }
  const origin = originOf(request);
  if (!origin) {
    fail(response, 400, "bad host");
    return;
  }
  const segments: string[] = [];
  for (const raw of relativePath.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      fail(response, 404, "asset not found");
      return;
    }
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      fail(response, 404, "asset not found");
      return;
    }
    segments.push(segment);
  }
  const realRoot = await realpath(root).catch(() => undefined);
  if (!realRoot) {
    fail(response, 404, "unknown extension panel");
    return;
  }
  const candidate = resolve(realRoot, ...segments);
  if (!candidate.startsWith(`${realRoot}${sep}`)) {
    fail(response, 404, "asset not found");
    return;
  }
  const real = await realpath(candidate).catch(() => undefined);
  if (!real || !real.startsWith(`${realRoot}${sep}`)) {
    fail(response, 404, "asset not found");
    return;
  }
  const info = await stat(real).catch(() => undefined);
  if (!info?.isFile()) {
    fail(response, 404, "asset not found");
    return;
  }
  if (info.size > MAX_ASSET_BYTES) {
    fail(response, 413, "asset too large");
    return;
  }
  const mime = MIME[extname(real).slice(1).toLowerCase()];
  if (!mime) {
    fail(response, 404, "asset not found");
    return;
  }
  const body = request.method === "HEAD" ? undefined : await readFile(real).catch(() => undefined);
  if (request.method !== "HEAD" && !body) {
    fail(response, 404, "asset not found");
    return;
  }
  response.writeHead(200, {
    "content-type": mime,
    "content-security-policy": extensionAssetContentSecurityPolicy(origin, id),
    "permissions-policy": PERMISSIONS,
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...(body ? { "content-length": String(body.byteLength) } : {}),
  });
  response.end(body ?? undefined);
}
