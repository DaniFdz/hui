/**
 * HUI's managed browser: `GET/POST /__hui/browser` (its status, start and stop, over `browser/manager.ts`),
 * `POST /__hui/browser/cookies` (the cookies of an exported login, read from an absolute path and handed to the
 * browser, or parked for its next start), `GET /__hui/browser/tabs/:tab/preview` (an operator preview of one tab,
 * as a data URL) and, dispatched earlier with the routes no diagnostic records,
 * `POST /__hui/sessions/:id/browser/connect` (a browser pane's one-use ticket, from `browser-transport.ts`). `hui.ts`
 * applies the `x-hui` guard before dispatching here.
 */
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { reply, type JsonResult, type RouteRequest } from "../http/route.ts";
import { BrowserCookieImportReport, BrowserError, BrowserPreview, BrowserSecrets, BrowserStatus, BrowserViewConnection } from "../api/browser.ts";
export { routeSchemas } from "../api/browser.ts";
import { browserViewTicket } from "../browser/transport.ts";
import { CookieImportError, MAX_COOKIE_IMPORT_BYTES, cookieImportReport, parseCookieImport } from "../browser/cookie-import.ts";
import { BrowserToolError, type ManagedBrowser } from "../browser/manager.ts";
import { SiteSecretError, type SiteSecrets } from "../browser/secrets.ts";
import type { SessionRecord } from "../sessions/sessions.ts";

const BROWSER_ROUTE = "/__hui/browser";
const BROWSER_COOKIES_ROUTE = "/__hui/browser/cookies";
const BROWSER_SECRETS_ROUTE = "/__hui/browser/secrets";
const BROWSER_SECRET_REMOVE_ROUTE = "/__hui/browser/secrets/remove";
const BROWSER_TAB_PREVIEW = /^\/__hui\/browser\/tabs\/(t\d{1,6})\/preview$/u;
const BROWSER_VIEW_ROUTE = /^\/__hui\/sessions\/([^/]+)\/browser\/connect$/u;

/** The one sentence every bad path gets: empty, `-`, relative, or carrying a NUL. It says nothing about the file. */
const COOKIE_PATH_REFUSAL = "Give an absolute path to the cookie file.";

/** A refusal of the file behind an import. Its message names the path's problem, never what any cookie held. */
class CookieFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieFileError";
  }
}

/** The absolute path an import reads; `-` means stdin to half the tools that write one, so it is refused as a path. */
function cookieFilePath(value: unknown): string {
  if (typeof value !== "string" || value === "") throw new CookieFileError(COOKIE_PATH_REFUSAL);
  if (value === "-") throw new CookieFileError(COOKIE_PATH_REFUSAL);
  if (!isAbsolute(value)) throw new CookieFileError(COOKIE_PATH_REFUSAL);
  if (value.includes("\u0000")) throw new CookieFileError(COOKIE_PATH_REFUSAL);
  return value;
}

/** The file's text, read from one open handle: the path is opened once, the bound is checked on that handle, and at
 * most one byte past it is read from the same handle, so a file that grows or is replaced between the check and the
 * read cannot cost more memory than the limit. The open never waits for a writer, so a FIFO is refused by the stat
 * that follows instead of blocking the import until the caller gives up. */
async function cookieFileText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => undefined);
  if (!handle) throw new CookieFileError("No readable file at that path.");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new CookieFileError("No readable file at that path.");
    if (stats.size > MAX_COOKIE_IMPORT_BYTES) throw new CookieFileError("That file is larger than 4 MiB.");
    const buffer = Buffer.alloc(MAX_COOKIE_IMPORT_BYTES + 1);
    const size = await readAtMost(handle, buffer);
    if (size > MAX_COOKIE_IMPORT_BYTES) throw new CookieFileError("That file is larger than 4 MiB.");
    return buffer.subarray(0, size).toString("utf8");
  } catch (error) {
    if (error instanceof CookieFileError) throw error;
    throw new CookieFileError("That cookie file could not be read.");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Fills a buffer from the start of a file, stopping at its end: one read is not a whole file. */
async function readAtMost(handle: FileHandle, buffer: Buffer): Promise<number> {
  let size = 0;
  while (size < buffer.length) {
    const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
    if (bytesRead === 0) break;
    size += bytesRead;
  }
  return size;
}

export function createBrowserRoutes(deps: {
  managedBrowser: ManagedBrowser;
  secrets: SiteSecrets;
  browserStatus(): Promise<BrowserStatus>;
  readRegistry(): Promise<SessionRecord[]>;
}) {
  async function connect(request: RouteRequest): Promise<JsonResult | undefined> {
    const browserViewRoute = request.path.match(BROWSER_VIEW_ROUTE);
    if (!browserViewRoute) return undefined;
    try {
      if (request.method !== "POST") throw new BrowserToolError("Method not allowed.", 405);
      const owner = browserViewRoute[1]!;
      if (!(await deps.readRegistry()).some((record) => record.id === owner)) throw new BrowserToolError("Conversation not found.", 404);
      return reply(BrowserViewConnection, { url: browserViewTicket(owner) });
    } catch (error) {
      return reply(BrowserError, { error: error instanceof Error ? error.message : "Browser view request failed." }, error instanceof BrowserToolError ? error.status : 500);
    }
  }

  async function handle(request: RouteRequest): Promise<JsonResult | undefined> {
    const { managedBrowser, browserStatus, secrets } = deps;
    if (request.path === BROWSER_SECRETS_ROUTE || request.path === BROWSER_SECRET_REMOVE_ROUTE) {
      const removing = request.path === BROWSER_SECRET_REMOVE_ROUTE;
      try {
        if (removing ? request.method !== "POST" : request.method !== "GET" && request.method !== "POST") {
          return reply(BrowserError, { error: "method not allowed" }, 405);
        }
        if (request.method === "GET") return reply(BrowserSecrets, { secrets: await secrets.list() });
        let body: unknown;
        try { body = await request.json(); } catch { throw new SiteSecretError("The secret request body must be JSON."); }
        const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
        return reply(BrowserSecrets, { secrets: removing ? await secrets.remove(record["name"]) : await secrets.save({ name: record["name"], origin: record["origin"], value: record["value"] }) });
      } catch (error) {
        return reply(BrowserError, { error: error instanceof Error ? error.message : "The secret request failed." }, error instanceof SiteSecretError ? 400 : 500);
      }
    }
    if (request.path === BROWSER_COOKIES_ROUTE) {
      try {
        if (request.method !== "POST") return reply(BrowserError, { error: "method not allowed" }, 405);
        // A body that is not JSON has no path either, and gets the same sentence: its text is never repeated back.
        const body = await request.json().catch(() => undefined);
        const path = cookieFilePath(body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)["path"] : undefined);
        const result = parseCookieImport(await cookieFileText(path), Date.now());
        const applied = await managedBrowser.importCookies(result.cookies);
        return reply(BrowserCookieImportReport, {
          imported: result.cookies.length,
          expired: result.expired,
          domains: [...new Set(result.cookies.map((cookie) => cookie.domain))].sort(),
          applied,
          message: applied === "next-start" ? `${cookieImportReport(result)}\nThey apply when the managed browser next starts.` : cookieImportReport(result),
        });
      } catch (error) {
        if (error instanceof CookieImportError || error instanceof CookieFileError) return reply(BrowserError, { error: error.message }, 400);
        if (error instanceof BrowserToolError) return reply(BrowserError, { error: error.message }, error.status);
        return reply(BrowserError, { error: "The cookie import failed." }, 500);
      }
    }
    if (request.path === BROWSER_ROUTE) {
      try {
        if (request.method === "GET") return reply(BrowserStatus, await browserStatus());
        if (request.method !== "POST") return reply(BrowserError, { error: "method not allowed" }, 405);
        let body: unknown;
        try { body = await request.json(); } catch { throw new BrowserToolError("Browser request body must be JSON."); }
        const action = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)["action"] : undefined;
        if (action === "start") await managedBrowser.start();
        else if (action === "stop") await managedBrowser.stop();
        else throw new BrowserToolError("action must be start or stop.");
        return reply(BrowserStatus, await browserStatus());
      } catch (error) {
        return reply(BrowserError, { error: error instanceof Error ? error.message : "The browser request failed." }, error instanceof BrowserToolError ? error.status : 500);
      }
    }
    const browserPreview = request.path.match(BROWSER_TAB_PREVIEW);
    if (browserPreview) {
      if (request.method !== "GET") return reply(BrowserError, { error: "method not allowed" }, 405);
      try {
        const image = await managedBrowser.preview(browserPreview[1] ?? "");
        return reply(BrowserPreview, { image: `data:${image.mimeType};base64,${image.data}` });
      } catch (error) {
        return reply(BrowserError, { error: error instanceof Error ? error.message : "The tab could not be captured." }, error instanceof BrowserToolError ? error.status : 500);
      }
    }
    return undefined;
  }

  return { connect, handle };
}
