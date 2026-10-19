/**
 * HUI's local backend.
 *
 * Everything the app remembers lives in one directory: `~/.config/hui`, or
 * `$XDG_CONFIG_HOME/hui` when that is set.
 *
 *   settings.json    theme, color mode, interface/chat fonts, text size
 *   themes/*.json    shadcn/tweakcn themes; drop one in and it shows up
 *
 * Registered as a Vite plugin so the dev server and `vite preview` both serve
 * it, and the app needs no second process. Built-in themes stay in the repo and
 * are merged with the user's, so they keep receiving fixes; a user theme with
 * the same id wins.
 *
 * A theme file carries both modes, so there is no pairing to describe and no
 * manifest to keep in step.
 */
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";

import type { Connect, Plugin } from "vite";
import { workers } from "./workers.ts";
import { WORKERS_ROUTE } from "./routes/workers.ts";
import { BOT_MEMORY_PAGE, BOTS_EVENTS_ROUTE, BOTS_ROUTE } from "./routes/bots.ts";
import { BOT_TRIGGERS_ROUTE } from "./routes/bot-triggers.ts";
import { isHookPath } from "./bot-triggers-listener.ts";
import { CLIENT_HEADER, responseFailures, routeRequest, sendFile, sendJson, type RouteResult } from "./http/route.ts";
import { HEARTBEAT_MS, watchSessionEvents, writeEvent } from "./http/events.ts";
import { CALLS_ROUTE } from "./routes/calls.ts";
import { BOTS_OFF_MESSAGE, type BotsUpdate } from "../shared/bots.ts";

import { botsOn, readHuiSettings } from "./hui-settings.ts";
import { attachVscodeTransport, isVscodeProxyPath, proxyVscodeHttp, serveVscodeEnter } from "./vscode-proxy.ts";
import { VSCODE_ENTER_PATH } from "../shared/vscode.ts";
import { attachBrowserTransport } from "./browser-transport.ts";
import type { EventEmitter } from "node:events";
import { liveSessions } from "./live-sessions.ts";
import { diagnosticPath, mirrorDiagnosticLogs, recordDiagnosticEvent } from "./observability.ts";
import { durableHost } from "./runtimes/durable-host.ts";
import { stopAgentToolBridge } from "./agent-tools-bridge.ts";
import { servePresentedMedia } from "./presented-media.ts";
import { serveWidgetSandbox } from "./widget-sandbox.ts";
import { WIDGET_SANDBOX_PATH } from "../shared/widgets.ts";
import { terminals } from "./terminals.ts";
import { attachSessionTransport } from "./session-transport.ts";
import { attachTerminalTransport } from "./terminal-transport.ts";
import { FILES_ROUTE } from "./routes/files.ts";
import { DIFF_ROUTE } from "./routes/diff.ts";
import { ATTACHMENT_ROUTE } from "./routes/attachments.ts";
import { THEMES_ROUTE } from "./routes/themes.ts";
import { AUTOMATION_ROUTE } from "./routes/automation.ts";
import { handleApiSchemaRoute } from "./routes/api-schema.ts";
import { DIAGNOSTICS_EXPORT_ROUTE, HEALTH_ROUTE, OBSERVABILITY_ROUTE, UI_ERRORS_ROUTE } from "./routes/diagnostics.ts";
import { ensureConfigDir, listThemes, THEME_FILE_ROUTE } from "./themes.ts";
import { readRegistry, type SessionRecord } from "./sessions.ts";
import { pendingSessions, pendingStatus, pendingStatusSubscribers, type PendingStatusUpdate } from "./sessions/views.ts";
import {
  attachmentRoutes,
  automation,
  automationRoutes,
  backlogRoutes,
  botList,
  botRegistry,
  botRoutes,
  bots,
  botStreams,
  botTemplateRoutes,
  browserRoutes,
  callRoutes,
  datadogOrgs,
  datadogRoutes,
  diagnosticsRoutes,
  diffRoutes,
  fileRoutes,
  githubCli,
  githubRoutes,
  isDormantBotChat,
  jiraRoutes,
  localPathRoutes,
  macPower,
  managedBrowser,
  piRoutes,
  powerRoutes,
  providerRoutes,
  questionnaires,
  secretFiles,
  secretRequests,
  sessionActionRoutes,
  sessionList,
  sessionRoutes,
  settingsRoutes,
  subagents,
  taskSuggestionRoutes,
  terminalRoutes,
  themeRoutes,
  triggers,
  updateRoutes,
  vscode,
  vscodeRoutes,
  watcherRoutes,
  watchers,
  workerRoutes,
  worktreeRoutes,
} from "./services.ts";

const PREFIX = "/__hui/";
const SESSIONS_ROUTE = `${PREFIX}sessions`;
const SESSION_STATUSES_ROUTE = `${SESSIONS_ROUTE}/events`;
const PRESENTED_MEDIA_ROUTE = /^\/__hui\/media\/([0-9a-f-]+)\/([^/]+)$/u;

durableHost().storeFailed = async () => reattachAfterStoreFailure(await readRegistry());

const BOT_CALLS = /^\/__hui\/bots\/[^/]+\/calls(?:\/|$)/u;

/* ── routes ──────────────────────────────────────────────────────────────── */

/** A page HUI renders itself (a bot's memory). Its text comes from a chat, so it may run nothing, load nothing but its
 * inline styles, submit nothing, and be framed by no page, HUI's own included. */
const BOT_PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function sendHtml(response: ServerResponse, status: number, html: string): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-security-policy", BOT_PAGE_POLICY);
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.end(html);
}

/** A route module's answer, or its 404 when no route of the module matched. */
function sendRouteResult(response: ServerResponse, path: string, result: RouteResult | undefined): void {
  if (!result) sendJson(response, 404, { error: `unknown route: ${path}` });
  else if ("file" in result) sendFile(response, result.status, result.file);
  else if ("html" in result) sendHtml(response, result.status, result.html);
  else {
    if (result.etag) response.setHeader("etag", `"${result.etag}"`);
    sendJson(response, result.status, result.body);
  }
}

function answered(response: ServerResponse, path: string, result: RouteResult | undefined): boolean {
  if (result) sendRouteResult(response, path, result);
  return Boolean(result);
}

/** The SSE form of a session's events, for scripts and other HTTP clients.
 * The heartbeat keeps a proxy from dropping an idle stream, and is unref'd so
 * it never keeps the process alive by itself. */
export function streamSession(
  response: ServerResponse,
  record: SessionRecord,
  sessions: Pick<
    typeof liveSessions,
    "ensure" | "watch"
  > = liveSessions,
): void {
  if (!sessions.ensure(record)) {
    sendJson(response, 404, { error: `unknown session: ${record.id}` });
    return;
  }
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();

  const unsubscribe = watchSessionEvents(record.id, (event, data) => {
    writeEvent(response, event, data);
    if (event === "closed") response.end();
  }, sessions);

  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(": heartbeat\n\n");
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  response.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/** Multiplexes the small lifecycle surface for every live session over one
 * browser connection. Transcript and model traffic remains scoped to the
 * selected session's detailed stream. */
export function streamSessionStatuses(
  response: ServerResponse,
  sessions: Pick<typeof liveSessions, "watchStatuses"> = liveSessions,
  list: Pick<typeof sessionList, "subscribe"> = sessionList,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();

  const write = (update: PendingStatusUpdate) => writeEvent(response, "status", update);
  const watched = sessions.watchStatuses(write);
  pendingStatusSubscribers.add(write);
  writeEvent(response, "snapshot", { statuses: [...watched.statuses, ...[...pendingSessions.values()].map(pendingStatus)] });
  const unlist = list.subscribe((update) => writeEvent(response, "sessions", update));

  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  response.on("close", () => {
    clearInterval(heartbeat);
    watched.unsubscribe();
    pendingStatusSubscribers.delete(write);
    unlist();
  });
}

/** `GET /__hui/bots/events`: the complete bot list first, then only the bots whose views changed. */
export function streamBots(response: ServerResponse, list: Pick<typeof botList, "subscribe"> = botList): void {
  botStreams.add(response);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
  const unlist = list.subscribe((update) => writeEvent(response, "bots", {
    revision: update.revision,
    ...(update.groups ? { ids: update.groups.flatMap((group) => group.ids) } : {}),
    upserts: update.upserts,
  } satisfies BotsUpdate));
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();
  response.on("close", () => {
    botStreams.delete(response);
    clearInterval(heartbeat);
    unlist();
  });
}

/** Bots off: every bot route, call route and bot chat's session route answers 409 with `BOTS_OFF_MESSAGE`, which names
 * the setting. 409, not 404: the gateway's settings refuse the request, and the bots and their data are all still
 * there (404 is a bot that does not exist). True when it answered. */
async function refusedWhileBotsOff(response: ServerResponse): Promise<boolean> {
  if (await botsOn()) return false;
  sendJson(response, 409, { error: BOTS_OFF_MESSAGE });
  return true;
}

/** `/__hui/calls` and `/__hui/bots/:id/calls…` (`routes/calls.ts`). */
async function serveCallRoute(request: Connect.IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  sendRouteResult(response, path, await callRoutes.handle(routeRequest(request, response, path)));
}

/** `/__hui/bots` and everything under it but the events stream (`routes/bots.ts`). */
async function serveBotRoute(request: Connect.IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const routed = routeRequest(request, response, path);
  // Importing and exporting first: `import` is a reserved handle, and `export` no bot route's action.
  sendRouteResult(response, path, await botTemplateRoutes.handle(routed) ?? await botRoutes.handle(routed));
}

/** `/__hui/bots/:id/triggers…` (`routes/bot-triggers.ts`). */
async function serveTriggerRoute(request: Connect.IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  sendRouteResult(response, path, await triggers.routes.handle(routeRequest(request, response, path)));
}

async function handleRequest(
  request: Connect.IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  // An iframe navigation cannot send x-hui. The page is static and holds no
  // data; its own policy keeps it opaque and embeddable only by HUI.
  if (path === WIDGET_SANDBOX_PATH) {
    serveWidgetSandbox(request, response);
    return;
  }
  const presentedMedia = path.match(PRESENTED_MEDIA_ROUTE);
  // Native img/audio/video elements cannot set x-hui. Their opaque random id is
  // the read capability, and CORP prevents embedding it from another origin.
  if (presentedMedia) {
    if (!await servePresentedMedia(request, response, presentedMedia[1] ?? "", presentedMedia[2] ?? "")) {
      sendJson(response, 404, { error: "media not found" });
    }
    return;
  }
  // <img> cannot send x-hui; the route accepts it or a browser-attested same-origin fetch (`routes/attachments.ts`).
  if (ATTACHMENT_ROUTE.test(path)) {
    sendRouteResult(response, path, await attachmentRoutes.handle(routeRequest(request, response, path)));
    return;
  }

  if (BOT_MEMORY_PAGE.test(path)) {
    // A link (a bot's memory in a new tab) cannot send x-hui either: like an
    // attachment, accept it or a browser-attested same-origin load, and refuse
    // everything cross-site.
    if (request.headers[CLIENT_HEADER] !== "1" && request.headers["sec-fetch-site"] !== "same-origin") {
      sendJson(response, 403, { error: `missing ${CLIENT_HEADER} header` });
      return;
    }
    if (await refusedWhileBotsOff(response)) return;
    await serveBotRoute(request, response, path);
    return;
  }

  // A VS Code frame cannot send x-hui either. Its one-use ticket (minted below, behind x-hui) becomes a cookie scoped
  // to /__hui/vscode, which only the proxy accepts; no other route reads it (`vscode-proxy.ts`).
  if (path === VSCODE_ENTER_PATH) {
    serveVscodeEnter(request, response, vscode);
    return;
  }
  if (isVscodeProxyPath(path)) {
    proxyVscodeHttp(request, response, vscode);
    return;
  }

  // A trigger's listener is another program: its token is the credential, not x-hui (`bot-triggers-listener.ts`).
  if (isHookPath(path)) {
    const result = await triggers.hook(request, path);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "OPTIONS") {
    sendJson(response, 403, { error: "cross-origin requests are not accepted" });
    return;
  }
  if (request.headers[CLIENT_HEADER] !== "1") {
    sendJson(response, 403, { error: `missing ${CLIENT_HEADER} header` });
    return;
  }

  const routed = routeRequest(request, response, path);

  if (answered(response, path, await terminalRoutes.handle(routed))) return;

  // The Files view: the conversation's working directory, never another path (`routes/files.ts`).
  if (FILES_ROUTE.test(path)) {
    sendRouteResult(response, path, await fileRoutes.handle(routeRequest(request, response, path)));
    return;
  }

  // The Diff view: Git comparisons of the conversation's working directory, read-only (`routes/diff.ts`).
  if (DIFF_ROUTE.test(path)) {
    sendRouteResult(response, path, await diffRoutes.handle(routeRequest(request, response, path)));
    return;
  }

  if (answered(response, path, await vscodeRoutes.handle(routed))) return;

  if (answered(response, path, await browserRoutes.connect(routed))) return;

  const started = performance.now();
  response.once("finish", () => {
    if (path === OBSERVABILITY_ROUTE || path === DIAGNOSTICS_EXPORT_ROUTE || path === HEALTH_ROUTE) return;
    // An accepted UI error report is already its own diagnostic.
    if (path === UI_ERRORS_ROUTE && response.statusCode < 400) return;
    if (request.method === "GET" && response.statusCode < 400) return;
    const safePath = diagnosticPath(path);
    recordDiagnosticEvent({
      area: path.startsWith(AUTOMATION_ROUTE) ? "automation" : path.startsWith(SESSIONS_ROUTE) ? "session" : "gateway",
      level: response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warning" : "info",
      action: `${request.method ?? "GET"} ${safePath}`,
      summary: `HTTP ${response.statusCode} in ${Math.max(0, Math.round(performance.now() - started))} ms`,
      detail: responseFailures.get(response),
    });
  });

  if (answered(response, path, await updateRoutes.handle(routed))) return;

  if (answered(response, path, await localPathRoutes.handle(routed))) return;

  if (answered(response, path, await browserRoutes.handle(routed))) return;

  if (answered(response, path, await settingsRoutes.handle(routed))) return;

  if (answered(response, path, await piRoutes.handle(routed))) return;

  if (path === WORKERS_ROUTE || path.startsWith(`${WORKERS_ROUTE}/`)) {
    const result = await workerRoutes.handle(routeRequest(request, response, path));
    if (result) sendRouteResult(response, path, result);
    else sendJson(response, 404, { error: "not found" });
    return;
  }

  if (path === BOTS_EVENTS_ROUTE) {
    if (request.method !== "GET") sendJson(response, 405, { error: "method not allowed" });
    else if (!await refusedWhileBotsOff(response)) streamBots(response);
    return;
  }

  // Calls are with bots only, so their status route goes with them.
  if (path === CALLS_ROUTE || BOT_CALLS.test(path)) {
    if (!await refusedWhileBotsOff(response)) await serveCallRoute(request, response, path);
    return;
  }

  if (path === BOTS_ROUTE || path.startsWith(`${BOTS_ROUTE}/`)) {
    if (!await refusedWhileBotsOff(response)) await (BOT_TRIGGERS_ROUTE.test(path) ? serveTriggerRoute(request, response, path) : serveBotRoute(request, response, path));
    return;
  }

  if (answered(response, path, await providerRoutes.handle(routed))) return;

  if (answered(response, path, await powerRoutes.handle(routed))) return;
  if (answered(response, path, await handleApiSchemaRoute(routed))) return;

  if (answered(response, path, await diagnosticsRoutes.handle(routed, response))) return;

  if (answered(response, path, await worktreeRoutes.handle(routed))) return;

  if (answered(response, path, await automationRoutes.handle(routed))) return;

  if (path.startsWith(THEMES_ROUTE)) {
    const result = await themeRoutes.handle(routed);
    if (result) {
      sendRouteResult(response, path, result);
      return;
    }
  }

  if (answered(response, path, await githubRoutes.handle(routed))) return;

  if (answered(response, path, await datadogRoutes.handle(routed))) return;

  if (answered(response, path, await jiraRoutes.handle(routed))) return;

  if (path === SESSION_STATUSES_ROUTE) {
    if (request.method === "GET") {
      streamSessionStatuses(response);
    } else {
      sendJson(response, 405, { error: "method not allowed" });
    }
    return;
  }

  if (answered(response, path, await sessionRoutes.handle(routed))) return;

  if (answered(response, path, await backlogRoutes.handle(routed))) return;

  if (answered(response, path, await taskSuggestionRoutes.handle(routed))) return;

  if (answered(response, path, await watcherRoutes.handle(routed))) return;

  const sessionAction = await sessionActionRoutes.handle(routed);
  if (sessionAction && "stream" in sessionAction) {
    streamSession(response, sessionAction.stream);
    return;
  }
  if (answered(response, path, sessionAction)) return;

  if (path.startsWith(THEME_FILE_ROUTE) && request.method === "GET") {
    const key = decodeURIComponent(path.slice(THEME_FILE_ROUTE.length));
    const file = (await listThemes()).files.get(key);
    if (!file) {
      sendJson(response, 404, { error: `unknown theme file: ${key}` });
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(await readFile(file));
    return;
  }

  sendJson(response, 404, { error: `unknown route: ${path}` });
}

export const middleware: Connect.NextHandleFunction = (request, response, next) => {
  if (!request.url?.startsWith(PREFIX)) {
    next();
    return;
  }
  handleRequest(request, response).catch((error: unknown) => {
    // The browser gets a generic message; the request's diagnostic keeps the cause.
    if (error instanceof Error && error.message) responseFailures.set(response, error.message);
    sendJson(response, 500, { error: "config backend failed" });
  });
};

function initializeSubagents(): void {
  void subagents.initialize().catch((error: unknown) => {
    recordDiagnosticEvent({
      area: "session",
      level: "error",
      action: "subagent_recovery_failed",
      summary: error instanceof Error ? error.message : "Could not recover subagent state.",
    });
  });
}

/** A corrupt watcher registry must not stop the gateway, and a watcher whose
 * conversation no longer exists is stopped and forgotten once. */
function initializeWatchers(): void {
  void watchers
    .initialize()
    .then(async () => watchers.prune(new Set((await readRegistry()).map((record) => record.id))))
    .catch((error: unknown) => {
      recordDiagnosticEvent({
        area: "session",
        level: "error",
        action: "watcher_recovery_failed",
        summary: error instanceof Error ? error.message : "Could not recover watchers.",
      });
    });
}

export async function startBackend(): Promise<void> {
  // Warnings, errors and lifecycle events also go to stderr: the managed
  // gateway appends it to gateway.log and a development server prints it.
  mirrorDiagnosticLogs((line) => process.stderr.write(line));
  await ensureConfigDir();
  void macPower?.start((await readHuiSettings()).power.keepAwake);
  await automation.start();
  // Session views name bots' chats from this list; a broken bots.json is reported by the bot routes.
  await botRegistry.list().catch(() => undefined);
  // Bots from before SOUL.md: their instructions become SOUL.md once (bots.json keeps them until then).
  void bots.migrate().then((moved) => {
    if (moved.souls || moved.cleared) {
      recordDiagnosticEvent({
        area: "session", level: "info", action: "bots_souls_migrated",
        summary: `${moved.souls} bot${moved.souls === 1 ? "" : "s"} got their instructions as SOUL.md; ${moved.cleared} conversation${moved.cleared === 1 ? "" : "s"} no longer carry instructions`,
      });
    }
  }, (error: unknown) => recordDiagnosticEvent({
    area: "session", level: "warning", action: "bots_souls_migration_failed",
    summary: "Bots' instructions could not become SOUL.md; HUI tries again at its next start",
    detail: error instanceof Error ? error.message : String(error),
  }));
  // The roster's copy of each bot's tool and skill lists follows its chat's document, which may have moved without it.
  void bots.reconcileAccess().then((repaired) => {
    if (repaired) {
      recordDiagnosticEvent({
        area: "session", level: "info", action: "bots_access_reconciled",
        summary: `${repaired} bot${repaired === 1 ? "'s" : "s'"} tool and skill lists were copied again from their chats`,
      });
    }
  }, (error: unknown) => recordDiagnosticEvent({
    area: "session", level: "warning", action: "bots_access_reconcile_failed",
    summary: "Bots' tool and skill lists could not be checked against their chats; HUI tries again at its next start",
    detail: error instanceof Error ? error.message : String(error),
  }));
  initializeWatchers();
  initializeSubagents();
  // Triggers: what waited for a cooldown across the restart goes out once its cooldown ends.
  void triggers.start().catch((error: unknown) => recordDiagnosticEvent({
    area: "session", level: "warning", action: "triggers_start_failed", summary: "Bots' triggers did not start",
    detail: error instanceof Error ? error.message : String(error),
  }));
  void secretFiles.sweep();
  await workers.list().catch(() => undefined);
  // Opening the Durable store resumes its interrupted runs, including those of
  // sessions no browser has reopened yet, once those sessions have loaded their
  // PI extensions again. Another gateway owning it is reported.
  durableHost().beforeResume = async (conversations) => reopenDurableSessions(conversations, await readRegistry());
  void durableHost().open().catch((error: unknown) => recordDiagnosticEvent({
    area: "runtime", level: "warning", action: "durable_open_failed",
    summary: "The Durable session store did not open",
    detail: error instanceof Error ? error.message : String(error),
  }));
  recoverInterruptedSessions(await readRegistry());
  // Auto-star the HUI repo when GitHub is connected.
  void githubCli.starHuiRepo().catch(() => {}); // best-effort, non-blocking
}

/** The sessions of Durable conversations with unfinished work, whose runs
 * resume once they are open (the store, not HUI's run marker, knows them all). */
export async function reopenDurableSessions(
  conversations: readonly unknown[],
  records: readonly SessionRecord[],
  sessions: Pick<typeof liveSessions, "ensure" | "booted"> = liveSessions,
): Promise<void> {
  const references = new Set(conversations.map((id) => `durable:${String(id)}`));
  const owners = records.filter((record) => record.piSessionFile && references.has(record.piSessionFile));
  await Promise.all(owners.map((record) => sessions.ensure(record) ? sessions.booted(record.id) : undefined));
}

/** A failed Durable store is about to open again (`DurableHost.storeFailed`): the sessions on this machine it ended
 * reattach, once a boot underway settles (one that got the failed store ends then too). Their boots open the store;
 * the host opens it anyway, which resumes the runs of sessions nobody has open, as at startup. */
export async function reattachAfterStoreFailure(
  records: readonly SessionRecord[],
  sessions: Pick<typeof liveSessions, "ensure" | "booted" | "isLive"> = liveSessions,
): Promise<void> {
  await Promise.all(records.filter((record) => !record.worker && sessions.isLive(record.id)).map(async (record) => {
    await sessions.booted(record.id);
    sessions.ensure(record, true);
  }));
}

/** Startup recovery is eager: interrupted work resumes even when no browser
 * has reopened that conversation yet. */
export function recoverInterruptedSessions(
  records: readonly SessionRecord[],
  sessions: Pick<typeof liveSessions, "ensure"> = liveSessions,
): number {
  let started = 0;
  for (const record of records) {
    if (record.runStartedAt && sessions.ensure(record)) started += 1;
  }
  return started;
}

/** Settles once the Durable store is released, so a backend started next in
 * this process (a development server restart) can open it. */
export async function stopBackend(): Promise<void> {
  try {
    macPower?.dispose();
    managedBrowser.dispose();
    // Signals openvscode-server and returns: a gateway stop never waits for it.
    vscode.dispose();
    terminals.dispose();
    githubCli.dispose();
    datadogOrgs.dispose();
    // Before the sessions close: a delivery still going out reaches its bot, and every trigger write has settled.
    await triggers.stop();
    automation.dispose();
    subagents.dispose();
    watchers.dispose();
    secretRequests.dispose();
    questionnaires.dispose();
    secretFiles.dispose();
    stopAgentToolBridge();
    // Closed first: remote sessions then keep running on their hosts instead of
    // receiving a kill from the disposal below.
    workers.disconnectAll();
    liveSessions.disposeAll();
  } finally {
    // Closing records no outcome: running Durable work resumes on the next start.
    // A failed step above must not leave the store locked.
    await durableHost().close();
  }
}

/** Upgrade handlers for browser panes and session views; the gateway and Vite
 * servers attach them next to terminals. */
export function attachLiveStreams(server: EventEmitter, allowedHosts?: ReadonlySet<string>): () => void {
  const detachBrowser = attachBrowserTransport(server, managedBrowser, allowedHosts);
  const detachVscode = attachVscodeTransport(server, vscode, allowedHosts);
  const detachSessions = attachSessionTransport(server, async (id, send) => {
    const record = (await readRegistry()).find((session) => session.id === id);
    if (!record || await isDormantBotChat(record)) return undefined;
    return liveSessions.ensure(record) ? watchSessionEvents(id, send) : undefined;
  }, allowedHosts);
  return () => { detachBrowser(); detachVscode(); detachSessions(); };
}

const GESPENST_NODE_STUB = "\0hui:gespenst-node-builtin";

export function huiConfig(): Plugin {
  return {
    name: "hui-config",
    // Gespenst (the terminal renderer) loads its worker and WebAssembly relative to its own module; pre-bundling
    // would move the module away from them. Every entry point (vite.config.ts, hui-dev, the visual-verification
    // server) shares this plugin.
    config: () => ({ optimizeDeps: { exclude: ["@gespenst/core"] }, worker: { format: "es" as const } }),
    // Its WebAssembly loader reads file: URLs through node:fs/promises and node:url when it runs under Node; the
    // browser only fetches. An empty module replaces those two imports instead of Vite's externalization warning.
    resolveId: {
      order: "pre",
      handler(id, importer) {
        if ((id === "node:fs/promises" || id === "node:url") && importer?.includes("/node_modules/@gespenst/core/")) return GESPENST_NODE_STUB;
        return undefined;
      },
    },
    load(id) { return id === GESPENST_NODE_STUB ? "export {};" : undefined; },
    configureServer(server) {
      if (server.httpServer) {
        // Vite restarts by creating this server, closing the previous one (its
        // `closeBundle` stops that backend and releases the Durable store) and
        // only then listening. Starting here keeps the two backends apart.
        server.httpServer.once("listening", () => { void startBackend(); });
        const detach = attachTerminalTransport(server.httpServer);
        const detachStreams = attachLiveStreams(server.httpServer);
        server.httpServer.once("close", () => { detach(); detachStreams(); });
      } else {
        void startBackend();
      }
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      void startBackend();
      const detach = attachTerminalTransport(server.httpServer);
      const detachStreams = attachLiveStreams(server.httpServer);
      server.httpServer.once("close", () => { detach(); detachStreams(); });
      server.middlewares.use(middleware);
    },
    // Called once per Vite environment; the calls share one store close. Vite
    // discards a failed hook, so the failure is reported instead.
    async closeBundle() {
      await stopBackend().catch((error: unknown) => recordDiagnosticEvent({
        area: "gateway", level: "error", action: "stop_failed",
        summary: "The development backend did not stop cleanly",
        detail: error instanceof Error ? error.message : String(error),
      }));
    },
  };
}
