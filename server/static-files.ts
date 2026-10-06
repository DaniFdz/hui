import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { isAppRoutePath } from "../shared/app-routes.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
};

export async function serveStatic(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
  let path: string;
  try { path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }
  if (path.includes("\\") || /[\p{Cc}]/u.test(path) || path.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404).end(); return;
  }
  // Home, top-level pages (`/skills`, `/kanban`, …) and the app's deep links load
  // the app (shared/app-routes.ts); anything else is a file request.
  const spa = isAppRoutePath(path);
  try {
    const target = await realpath(join(root, spa ? "index.html" : path));
    const delta = relative(await realpath(root), target);
    if (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta) || !(await stat(target)).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.setHeader("Content-Type", MIME[extname(target)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", spa ? "no-store" : "public, max-age=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(request.method === "HEAD" ? undefined : await readFile(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") response.writeHead(404).end();
    else throw error;
  }
}
