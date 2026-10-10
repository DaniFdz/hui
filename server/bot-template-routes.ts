/**
 * Importing and exporting bots over `/__hui/bots` (HUI-18); see docs/api.md#importing-and-exporting-bots. Under the bots'
 * prefix, so Settings → Labs → Bots gates them like every bot route (409 while off).
 *
 *   POST /__hui/bots/import/preview   { source, pick?, worker? } → BotImportPreview; nothing is created
 *   POST /__hui/bots/import           { template, worker? } → 201 BotImportResult
 *   GET  /__hui/bots/:id/export       the bot as `<handle>.hui-bot.zip`; `?memory=1` adds its memory's view
 *
 * `import` is a reserved handle, so no bot's `/__hui/bots/:id` is ever this route.
 */
import type { ServerResponse } from "node:http";
import { AutomationConflictError, AutomationInputError } from "./automation.ts";
import type { BotTemplateService } from "./bot-template-import.ts";
import { botErrorStatus, type BotRouteRequest } from "./bot-routes.ts";
import { BotInputError } from "./bots.ts";
import { TemplateFormatError } from "./bot-templates/common.ts";
import { TemplateFetchError } from "./bot-templates/fetch.ts";

export const BOT_IMPORT_ROUTE = "/__hui/bots/import";
export const BOT_IMPORT_PREVIEW_ROUTE = "/__hui/bots/import/preview";
const EXPORT = /^\/__hui\/bots\/([A-Za-z0-9_-]{1,100})\/export$/u;
/** A source in base64: a folder of 16 MB, a third more, and its paths. */
const SOURCE_BODY_BYTES = 32 * 1024 * 1024;
/** A template as a preview returned it. */
const TEMPLATE_BODY_BYTES = 24 * 1024 * 1024;

export type BotTemplateRouteResult =
  | { status: number; body: unknown }
  | { status: number; file: { name: string; type: string; data: Buffer } };

/** 400 for a source or template HUI can't read, 502 when x.ai can't be fetched; the rest as the bot routes map them. */
export function templateErrorStatus(error: unknown): number {
  if (error instanceof TemplateFormatError || error instanceof AutomationInputError) return 400;
  if (error instanceof TemplateFetchError) return 502;
  if (error instanceof AutomationConflictError) return 409;
  return botErrorStatus(error);
}

export function createBotTemplateRoutes(deps: { service: BotTemplateService }) {
  const { service } = deps;

  async function json(request: BotRouteRequest, maxBytes: number): Promise<unknown> {
    try {
      return await request.body(maxBytes);
    } catch (error) {
      throw new BotInputError(error instanceof SyntaxError ? "The request body must be JSON." : `The request body is larger than ${maxBytes / 1024 / 1024} MB.`);
    }
  }

  async function handle(request: BotRouteRequest): Promise<BotTemplateRouteResult | undefined> {
    const exported = EXPORT.exec(request.path);
    if (request.path !== BOT_IMPORT_ROUTE && request.path !== BOT_IMPORT_PREVIEW_ROUTE && !exported) return undefined;
    try {
      if (exported) {
        if (request.method !== "GET") return { status: 405, body: { error: "method not allowed" } };
        const memory = request.query.get("memory");
        const file = await service.export(exported[1]!, { memory: memory === "1" || memory === "true" });
        return { status: 200, file: { name: file.name, type: "application/zip", data: file.data } };
      }
      if (request.method !== "POST") return { status: 405, body: { error: "method not allowed" } };
      if (request.path === BOT_IMPORT_PREVIEW_ROUTE) return { status: 200, body: await service.preview(await json(request, SOURCE_BODY_BYTES)) };
      return { status: 201, body: await service.create(await json(request, TEMPLATE_BODY_BYTES)) };
    } catch (error) {
      return { status: templateErrorStatus(error), body: { error: error instanceof Error ? error.message : "The import failed." } };
    }
  }

  return { handle };
}

/** A download: the file, named, never sniffed or cached. */
export function sendDownload(response: ServerResponse, status: number, file: { name: string; type: string; data: Buffer }): void {
  const ascii = file.name.replace(/[^A-Za-z0-9._-]/gu, "_");
  response.statusCode = status;
  response.setHeader("content-type", file.type);
  response.setHeader("content-length", String(file.data.length));
  response.setHeader("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(file.data);
}
