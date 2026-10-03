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
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Connect, Plugin } from "vite";
import { progressCardFromTranscript, type ProgressCard } from "../shared/progress-card.ts";
import type { SessionPullRequest } from "../shared/pull-requests.ts";
import {
  effectiveSessionStage,
  isSessionStage,
  SESSION_STAGE_LABELS,
  SESSION_STAGES,
  stageRank,
  type SessionStage,
  type SessionStageOrigin,
} from "../shared/session-stages.ts";
import { PullRequestStatuses, pullRequestsFromTranscript } from "./pull-requests.ts";


import { CONFIG_DIR, ATTACHMENTS_DIR, AUTOMATION_FILE, BROWSER_PROFILE_DIR, USER_THEME_DIR, WATCHERS_FILE, WATCHER_LOG_DIR } from "./paths.ts";
import { BrowserToolError, ManagedBrowser } from "./browser/manager.ts";
import { MacPower } from "./power.ts";
import { attachBrowserTransport, browserViewTicket } from "./browser-transport.ts";
import type { EventEmitter } from "node:events";
import type { BrowserStatus } from "../shared/browser.ts";
import { normalizeSettings, type Settings } from "../src/lib/settings.ts";
import { mapTheme, type ShadcnTheme } from "../src/lib/shadcn-theme.ts";
import { ProviderService, ProviderInputError } from "./providers.ts";
import { readPiConfig, invalidateModelCatalog } from "./pi-config.ts";
import { PiResourceNotFoundError, readPiResourceDocument } from "./pi-resource-reader.ts";
import { readToolsCatalog } from "./tools.ts";
import { updates, UpdateConflict } from "./updates.ts";
import { parseClearCommand, parseCompactCommand, parseReloadCommand, parseUpdateCommand } from "../src/lib/slash-commands.ts";
import {
  PiMutationBusyError,
  PiMutationCommandError,
  PiMutationInputError,
  PiMutationService,
} from "./pi-mutations.ts";
import { readGatewayHealth, readWorkspaceInspection } from "./control-surfaces.ts";
import { WorktreeService } from "./worktree-inventory.ts";
import type { WorktreeRisk } from "../shared/worktrees.ts";
import {
  liveSessions,
  SessionBusyError,
  type DeleteToken,
  type SessionStatus,
  type SessionStatusUpdate,
} from "./live-sessions.ts";
import type { PromptAttachment, TranscriptEntry } from "./runtimes/types.ts";
import {
  AutomationConflictError,
  AutomationInputError,
  AutomationNotFoundError,
  AutomationService,
  type AutomationExecution,
} from "./automation.ts";
import type { AutomationTask } from "../src/lib/automation-types.ts";
import { completeLocalPaths, completeWorkingDirectories, displayPath, resolveWorkingDirectory } from "./working-directories.ts";
import { diagnosticPath, mirrorDiagnosticLogs, readObservability, recordDiagnosticEvent } from "./observability.ts";
import { parseUiErrorBatch, UI_ERROR_BODY_LIMIT, uiErrorLog } from "./ui-errors.ts";
import { runtimeMemoryByPid } from "./runtime-resources.ts";
import { checkoutSessionRef, createSessionWorktree, inspectGitCheckout, type WorktreeProgress } from "./worktrees.ts";
import { fallbackBranchName } from "../shared/branch-names.ts";
import { answerSideQuestion, fallbackTitle, generateSessionNames, suggestWorktreeName } from "./model-routing.ts";
import { sessionDigest } from "./session-digest.ts";
import { runPiUtilityPrompt } from "./runtimes/pi.ts";
import type { SessionJiraIssue } from "../shared/jira.ts";
import {
  draftJiraWorkItem,
  findJiraIssues,
  JiraClient,
  jiraKeyFromInput,
  JiraConfigStore,
  jiraConnectionView,
  JiraInputError,
  jiraIssuesFromTranscript,
  JiraIssueStatuses,
  jiraIssueUrl,
  JiraRequestError,
  mergeJiraRefs,
  normalizeJiraSite,
  normalizeProjectKey,
  parentCandidates,
  validateCreateInput,
  type JiraConfig,
  type JiraIssueFetcher,
} from "./jira.ts";
import {
  registerAgentToolHandler,
  stopAgentToolBridge,
} from "./agent-tools-bridge.ts";
import { sessionTreeIds } from "../src/lib/session-tree.ts";
import { SubagentService } from "./subagents.ts";
import { presentMediaForSession, servePresentedMedia } from "./presented-media.ts";
import { GitHubCli, GitHubCliError } from "./github.ts";
import { FIRST_YEAR as GITHUB_FIRST_YEAR, GitHubContributionsReader, latestYear } from "./github-contributions.ts";
import { GitHubPreviews, ghApi, previewPullRequestFetcher } from "./github-previews.ts";
import { MAX_GITHUB_EMBEDS, parseGitHubUrl } from "../shared/github-links.ts";
import { TaskSuggestionInputError, TaskSuggestionNotFoundError, TaskSuggestionStore } from "./task-suggestions.ts";
import { WatcherConflictError, WatcherInputError, WatcherNotFoundError, WatcherService } from "./watchers.ts";
import {
  BacklogInputError,
  BacklogJiraFeed,
  BacklogNotFoundError,
  BacklogStore,
  BacklogStoreError,
  fetchAssignedTodo,
  mergeBacklog,
  splitItemId,
} from "./backlog.ts";
import { backlogItemPrompt, type BacklogItem, type BacklogView } from "../shared/backlog.ts";
import { TASK_SUGGESTION_START_MODES, taskSuggestionJiraDescription, taskSuggestionPrompt, type TaskSuggestionStartMode } from "../shared/task-suggestions.ts";
import { WATCHER_LIMITS } from "../shared/watchers.ts";
import { terminals, TerminalError } from "./terminals.ts";
import { attachSessionTransport, sessionStreamTicket } from "./session-transport.ts";
import { createSessionListHub } from "./session-list.ts";
import { attachTerminalTransport, terminalTicket } from "./terminal-transport.ts";
import {
  createSessionGroup,
  deleteSessionGroup,
  groupSessions,
  readRegistry,
  readSessionRegistry,
  reorderSessionGroups,
  SessionRegistryError,
  updateRegistry,
  updateSessionGroup,
  upsert,
  type SessionRecord,
} from "./sessions.ts";

const PREFIX = "/__hui/";
const SETTINGS_ROUTE = `${PREFIX}settings`;
const BROWSER_ROUTE = `${PREFIX}browser`;
/** An operator preview of one managed-browser tab, as a data URL. */
const BROWSER_TAB_PREVIEW = /^\/__hui\/browser\/tabs\/(t\d{1,6})\/preview$/u;
const THEMES_ROUTE = `${PREFIX}themes`;
const THEME_FILE_ROUTE = `${PREFIX}themes/file/`;
const THEME_IMPORT_ROUTE = `${PREFIX}themes/import`;
const PI_ROUTE = `${PREFIX}pi`;
const PI_PACKAGE_INSTALL_ROUTE = `${PI_ROUTE}/packages/install`;
const PI_PACKAGE_REMOVE_ROUTE = `${PI_ROUTE}/packages/remove`;
const PI_SKILL_INSTALL_ROUTE = `${PI_ROUTE}/skills/install`;
const PI_RESOURCE_READ_ROUTE = /^\/__hui\/pi\/resources\/(skill|plugin)\/([a-f0-9]{24})$/;
const HEALTH_ROUTE = `${PREFIX}health`;
/** macOS sleep prevention status (GET) and the lid switch (PUT { lidAwake }). */
const POWER_ROUTE = `${PREFIX}power`;
const WORKSPACES_ROUTE = `${PREFIX}workspaces`;
const WORKTREES_ROUTE = `${PREFIX}worktrees`;
const WORKTREES_REMOVE_ROUTE = `${PREFIX}worktrees/remove`;
const OBSERVABILITY_ROUTE = `${PREFIX}observability`;
const DIAGNOSTICS_EXPORT_ROUTE = `${PREFIX}diagnostics/export`;
const UI_ERRORS_ROUTE = `${PREFIX}diagnostics/ui-errors`;
const AUTOMATION_ROUTE = `${PREFIX}automation`;
const DIRECTORIES_ROUTE = `${PREFIX}directories`;
const LOCAL_PATHS_ROUTE = `${PREFIX}local-paths`;
const GIT_CHECKOUT_ROUTE = `${PREFIX}git-checkout`;
const AUTOMATION_TASKS_ROUTE = `${AUTOMATION_ROUTE}/tasks`;
const AUTOMATION_TASK_ONE = /^\/__hui\/automation\/tasks\/([^/]+)$/;
const AUTOMATION_TASK_RUN = /^\/__hui\/automation\/tasks\/([^/]+)\/run$/;
const AUTOMATION_RUN_CANCEL = /^\/__hui\/automation\/runs\/([^/]+)\/cancel$/;
const SESSIONS_ROUTE = `${PREFIX}sessions`;
const SESSION_STATUSES_ROUTE = `${SESSIONS_ROUTE}/events`;
const SESSION_GROUPS_ROUTE = `${PREFIX}session-groups`;
const NEW_SESSION_TOOLS = new Set(["pi"]);
const NEW_SESSION_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const SESSION_TITLE_MAX = 200;
const SESSION_GROUP_MAX = 200;
const SESSION_GROUP_ORDER_MAX = 1_000;
/** Session actions and live catalogs, all addressed by HUI's own session id. */
const SESSION_ACTION =
  /^\/__hui\/sessions\/([^/]+)\/(open|prompt|continue|resume|steer|follow-up|btw|queue|events|connect|models|commands|tools|model|thinking|question|abort|clear|reload|compact|rewind)$/;
/** The session itself, for changing it rather than acting on it. */
const SESSION_ONE = /^\/__hui\/sessions\/([^/]+)$/;
const GITHUB_ROUTE = `${PREFIX}github`;
const GITHUB_LOGIN_ROUTE = `${GITHUB_ROUTE}/login`;
const GITHUB_PREVIEWS_ROUTE = `${GITHUB_ROUTE}/previews`;
const GITHUB_CONTRIBUTIONS_ROUTE = `${GITHUB_ROUTE}/contributions`;
const JIRA_ROUTE = `${PREFIX}jira`;
const JIRA_PROJECTS_ROUTE = `${JIRA_ROUTE}/projects`;
/** Create (POST) or draft (POST …/draft) a Jira work item for one session. */
const SESSION_JIRA = /^\/__hui\/sessions\/([^/]+)\/jira(?:\/(draft|link))?$/;
const JIRA_ISSUES_ROUTE = `${JIRA_ROUTE}/issues`;
/** Dismiss (DELETE), start (POST …/start) or save to the backlog (POST
 * …/backlog) one pending `suggest_task` card. */
const SESSION_SUGGESTION = /^\/__hui\/sessions\/([^/]+)\/suggestions\/([^/]+?)(?:\/(start|backlog))?$/;
/** A conversation's background watchers: stop (POST …/stop), restart
 * (POST …/restart), read a bounded log tail (GET …/log) or dismiss one that
 * is not running (DELETE). */
const SESSION_WATCHER = /^\/__hui\/sessions\/([^/]+)\/watchers\/([^/]+?)(?:\/(stop|restart|log))?$/;
const BACKLOG_ROUTE = `${PREFIX}backlog`;
/** One backlog item: PATCH group, DELETE (local), POST …/start, POST
 * …/branch-name (suggested worktree name), and for local tasks POST …/jira
 * (create), …/jira/draft (parents) and …/jira/link. */
const BACKLOG_ITEM = /^\/__hui\/backlog\/items\/([^/]+?)(?:\/(start|branch-name|jira|jira\/draft|jira\/link))?$/;
/** A started suggestion's runtime must boot before its prompt is accepted. */
const SUGGESTION_READY_TIMEOUT_MS = 30_000;
const SESSION_GROUP_ONE = /^\/__hui\/session-groups\/([^/]+)$/;
const PRESENTED_MEDIA_ROUTE = /^\/__hui\/media\/([0-9a-f-]+)\/([^/]+)$/u;

/** How long an event stream may sit idle before a comment proves it is alive. */
const HEARTBEAT_MS = 15_000;
const piMutations = new PiMutationService();
const subagents = new SubagentService(liveSessions);
const taskSuggestions = new TaskSuggestionStore({ onChange: (id) => liveSessions.notifySnapshot(id) });
const watchers = new WatcherService({
  file: WATCHERS_FILE,
  logDir: WATCHER_LOG_DIR,
  onChange: (id) => liveSessions.notifySnapshot(id),
});
/** One managed browser per gateway; its settings are re-read on every call. */
const managedBrowser = new ManagedBrowser({
  profileDir: BROWSER_PROFILE_DIR,
  readSettings: async () => (await readSettings()).browser,
});
/** macOS sleep prevention lives and dies with this gateway process. */
const macPower = process.platform === "darwin" ? new MacPower() : undefined;
liveSessions.setTaskSuggestionProvider((id) => taskSuggestions.list(id));
liveSessions.setWatcherProvider((id) => watchers.list(id));
// A stopped turn must not leave its pages running in the headless browser.
liveSessions.setAbortListener((id) => managedBrowser.closeOwner(id));
registerAgentToolHandler(async (invocation) => {
  if (invocation.action === "suggest_task" || invocation.action === "dismiss_task") {
    const caller = (await readRegistry()).find(({ id }) => id === invocation.callerSessionId);
    if (!caller) throw new TaskSuggestionInputError("Conversation no longer exists.");
    return taskSuggestions.tool(caller.id, invocation.action, invocation.params, caller.cwd);
  }
  if (invocation.action === "set_stage") {
    return setAgentStage(invocation.callerSessionId, invocation.params);
  }
  if (invocation.action === "watcher") {
    const caller = (await readRegistry()).find(({ id }) => id === invocation.callerSessionId);
    if (!caller) throw new WatcherInputError("Conversation no longer exists.");
    return watchers.tool(caller.id, invocation.params, caller.cwd);
  }
  if (invocation.action === "terminal") {
    if (!(await readRegistry()).some(({ id }) => id === invocation.callerSessionId)) throw new TerminalError("Conversation no longer exists.", 404);
    return terminals.tool(invocation.callerSessionId, invocation.params);
  }
  if (invocation.action === "browser") {
    const caller = (await readRegistry()).find(({ id }) => id === invocation.callerSessionId);
    if (!caller) throw new BrowserToolError("Conversation no longer exists.", 404);
    return managedBrowser.tool(caller.id, invocation.params, { cwd: resolveWorkingDirectory(caller.cwd) });
  }
  return invocation.action === "present_media"
    ? presentMediaForSession(invocation.callerSessionId, invocation.params)
    : subagents.handle(invocation.callerSessionId, invocation.action, invocation.params);
});

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

/** Refuse cross-origin callers. A page on any site can reach localhost, but it
 * cannot set a custom header without a preflight, and we answer none. */
const CLIENT_HEADER = "x-hui";

const MAX_BODY_BYTES = 64 * 1024;
/** Prompts may carry images inline, so they get their own, larger ceiling. */
const MAX_PROMPT_BYTES = 24 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 8;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_BYTES = 16 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Browser names remain display metadata; the stored path uses this narrower
 * ASCII form independently. */
const STORAGE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isSafeAttachmentName(name: string): boolean {
  const characters = [...name];
  return (
    characters.length > 0 &&
    characters.length <= 128 &&
    name.trim().length > 0 &&
    name !== "." &&
    name !== ".." &&
    !/[\\/\p{Cc}]/u.test(name)
  );
}

/** Import is the one thing here that reaches the network, so it is tightly
 * bounded: one host, one shape, a size cap and a timeout. */
const TWEAKCN_HOSTS = new Set(["tweakcn.com", "www.tweakcn.com"]);
const TWEAKCN_REGISTRY = "https://tweakcn.com/r/themes/";
const MAX_THEME_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 10_000;
const THEME_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const providerService = new ProviderService(undefined, invalidateModelCatalog);

const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");
const BUILTIN_THEME_DIR = fileURLToPath(new URL("../themes/", import.meta.url));

type ThemeSource = "builtin" | "user";

export type ThemeEntry = {
  id: string;
  name: string;
  source: ThemeSource;
  /** Filename within the source directory. */
  file: string;
};

type ThemeListing = {
  themes: { id: string; name: string; url: string }[];
  /** Route key -> absolute path. Only files we discovered are ever served, so a
   * request can never name a path of its own. */
  files: Map<string, string>;
};

async function readSettings(): Promise<Settings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(SETTINGS_FILE, "utf8")));
  } catch {
    return normalizeSettings(undefined);
  }
}

/** Creating both directories is what gives a fresh install somewhere obvious to
 * drop a theme file. */
async function ensureConfigDir(): Promise<void> {
  await mkdir(USER_THEME_DIR, { recursive: true });
}

async function writeSettings(raw: unknown): Promise<Settings> {
  const settings = normalizeSettings(raw);
  await ensureConfigDir();
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  // A changed browser mode or executable must not leave the old process running.
  await managedBrowser.applySettings(settings.browser);
  macPower?.setKeepAwake(settings.power.keepAwake);
  return settings;
}

async function browserStatus(): Promise<BrowserStatus> {
  const titles = new Map((await readRegistry()).map((record) => [record.id, record.title]));
  return managedBrowser.status((id) => titles.get(id) ?? "");
}

/**
 * A file is a theme if it carries at least one usable mode. Its own `name`
 * labels it, so nothing has to be declared anywhere else.
 */
async function readThemeFile(
  dir: string,
  file: string,
  source: ThemeSource,
): Promise<ThemeEntry | undefined> {
  const id = file.slice(0, -".json".length);
  if (!id) {
    return undefined;
  }
  try {
    const theme = JSON.parse(await readFile(join(dir, file), "utf8")) as ShadcnTheme;
    if (!mapTheme(theme)) {
      return undefined;
    }
    const name = typeof theme.name === "string" && theme.name.trim() ? theme.name.trim() : id;
    return { id, name, source, file };
  } catch {
    // A malformed file is skipped rather than taking the whole list down.
    return undefined;
  }
}

export async function discoverThemes(
  dir: string,
  source: ThemeSource,
): Promise<ThemeEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .toSorted()
      .map((name) => readThemeFile(dir, name, source)),
  );
  return found.filter((entry) => entry !== undefined);
}

/**
 * User themes win on an id collision, which is what makes copying a built-in
 * into the config directory the way to customise one.
 */
export function mergeThemes(
  user: readonly ThemeEntry[],
  builtin: readonly ThemeEntry[],
): ThemeEntry[] {
  const merged: ThemeEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...user, ...builtin]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }
  return merged;
}

export async function listThemes(): Promise<ThemeListing> {
  const [builtin, user] = await Promise.all([
    discoverThemes(BUILTIN_THEME_DIR, "builtin"),
    discoverThemes(USER_THEME_DIR, "user"),
  ]);

  const files = new Map<string, string>();
  const themes: ThemeListing["themes"] = [];
  for (const entry of mergeThemes(user, builtin)) {
    const root = entry.source === "user" ? USER_THEME_DIR : BUILTIN_THEME_DIR;
    const key = `${entry.source}/${entry.file}`;
    files.set(key, join(root, entry.file));
    themes.push({ id: entry.id, name: entry.name, url: `${THEME_FILE_ROUTE}${key}` });
  }
  return { themes, files };
}

/* ── tweakcn import ──────────────────────────────────────────────────────── */

/** Accepts an editor link, a share link, a registry link, a bare theme id, or
 * any of those pasted inside a sentence. */
export function registryUrlFor(input: string): URL {
  // Anything before the link is noise, and a trailing full stop is punctuation.
  const embedded = input.match(/https?:\/\/(?:www\.)?tweakcn\.com\/[^\s<>"')]+/i)?.[0];
  const cleaned = (embedded ?? input).trim().replace(/[.,;:]+$/, "");
  if (!cleaned) {
    throw new Error("Paste a tweakcn theme link or theme id.");
  }
  if (!embedded && THEME_ID.test(cleaned)) {
    return new URL(`${TWEAKCN_REGISTRY}${cleaned}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error("Paste a tweakcn theme link or theme id.");
  }
  if (!TWEAKCN_HOSTS.has(parsed.hostname)) {
    throw new Error("Only tweakcn.com links can be imported.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "editor" && segments[1] === "theme") {
    const editorTheme = parsed.searchParams.get("theme")?.trim() ?? "";
    if (!THEME_ID.test(editorTheme)) {
      throw new Error("That tweakcn editor link does not select a valid theme.");
    }
    return new URL(`${TWEAKCN_REGISTRY}${editorTheme}`);
  }
  const id = segments.at(-1);
  const shaped =
    (segments.length === 2 && segments[0] === "themes") ||
    (segments.length === 3 && segments[0] === "r" && segments[1] === "themes");
  if (!shaped || !id || !THEME_ID.test(id)) {
    throw new Error("That is not a tweakcn theme link.");
  }
  return new URL(`${TWEAKCN_REGISTRY}${id}`);
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("tweakcn returned an empty response.");
  }
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("That theme is too large to import.");
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** Fetches a tweakcn theme and writes it into the config directory. Returns the
 * id it was stored under. */
export async function importTweakcnTheme(input: string): Promise<string> {
  const url = registryUrlFor(input);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`tweakcn returned HTTP ${response.status} for that theme.`);
  }
  // A redirect is the one way this could be pointed somewhere else.
  if (!TWEAKCN_HOSTS.has(new URL(response.url).hostname)) {
    throw new Error("tweakcn redirected off-site; refusing the import.");
  }

  const item = JSON.parse(await readLimited(response, MAX_THEME_BYTES)) as ShadcnTheme;
  const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;

  // Stored in the shape we read: both blocks at the top level, no cssVars
  // wrapper, and nothing the app cannot use.
  const stored: ShadcnTheme = { name };
  const light = item.cssVars?.light;
  const dark = item.cssVars?.dark;
  if (light && typeof light === "object") {
    stored.light = light;
  }
  if (dark && typeof dark === "object") {
    stored.dark = dark;
  }
  if (!mapTheme(stored)) {
    throw new Error("That theme has no usable light or dark palette.");
  }

  await ensureConfigDir();
  await writeFile(join(USER_THEME_DIR, `${id}.json`), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return id;
}

/* ── routes ──────────────────────────────────────────────────────────────── */

/** Error text of failed `/__hui/` responses, kept for their request diagnostic. */
const responseFailures = new WeakMap<ServerResponse, string>();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) {
    return;
  }
  if (status >= 400 && !responseFailures.has(response)) {
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === "string") responseFailures.set(response, error);
  }
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

async function readBody(
  request: Connect.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Writes an uploaded file under the config dir and returns its absolute path. */
export async function storeAttachmentFile(
  sessionId: string,
  name: string,
  dataBase64: string,
  root = ATTACHMENTS_DIR,
): Promise<{ path: string; name: string }> {
  const storedName = STORAGE_FILENAME.test(name) ? name : `attachment-${randomUUID().slice(0, 8)}`;
  const dir = join(root, sessionId.replace(/[^A-Za-z0-9_-]/g, "_"));
  await mkdir(dir, { recursive: true });
  // The UUID makes the path immutable across repeated uploads with the same
  // browser filename. PI may read it after the HTTP request has returned, so a
  // later prompt must never overwrite its bytes.
  const path = join(dir, `${randomUUID()}-${storedName}`);
  await writeFile(path, Buffer.from(dataBase64, "base64"), { flag: "wx" });
  return { path, name };
}

export class AttachmentInputError extends Error {
  override name = "AttachmentInputError";
}

function decodeAttachment(data: unknown): { encoded: string; bytes: Buffer } {
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length % 4 !== 0
  ) {
    throw new AttachmentInputError("Attachment data must be canonical base64.");
  }
  const bytes = Buffer.from(data, "base64");
  // A decode/re-encode check rejects stray characters and non-canonical
  // padding without running one giant regular expression over a 12 MB file.
  if (bytes.toString("base64") !== data) {
    throw new AttachmentInputError("Attachment data must be canonical base64.");
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentInputError("Each attachment must be 12 MB or smaller.");
  }
  return { encoded: data, bytes };
}

export type PreparedAttachments = {
  attachments: PromptAttachment[];
  /** Removes only files written for this rejected request. Accepted prompts
   * retain their immutable paths because PI can read them asynchronously. */
  cleanupRejected(): Promise<void>;
};

/**
 * Attachments arrive as base64 because the client already holds the bytes.
 * Images stay in memory and go to the model natively; files are written down
 * and referenced by path, which is what pi's own `read` tool expects. Invalid
 * shapes fail the whole request before any bytes are handed to PI.
 */
export async function readAttachments(
  sessionId: string,
  raw: unknown,
  store: typeof storeAttachmentFile = storeAttachmentFile,
): Promise<PreparedAttachments> {
  if (raw === undefined) return { attachments: [], cleanupRejected: async () => {} };
  if (!Array.isArray(raw)) throw new AttachmentInputError("Attachments must be a list.");
  if (raw.length > MAX_ATTACHMENT_COUNT) {
    throw new AttachmentInputError(`At most ${MAX_ATTACHMENT_COUNT} attachments may be sent at once.`);
  }

  const staged: Array<{
    kind: "image" | "file";
    name: string;
    mimeType: string;
    encoded: string;
    bytes: Buffer;
  }> = [];
  let total = 0;
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      throw new AttachmentInputError("Every attachment must be an object.");
    }
    const item = entry as Record<string, unknown>;
    if (item["kind"] !== "image" && item["kind"] !== "file") {
      throw new AttachmentInputError("Attachment kind must be image or file.");
    }
    if (typeof item["name"] !== "string" || !isSafeAttachmentName(item["name"])) {
      throw new AttachmentInputError(
        "Attachment names must be 1–128 characters without path separators or controls.",
      );
    }
    const decoded = decodeAttachment(item["dataBase64"]);
    total += decoded.bytes.byteLength;
    if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
      throw new AttachmentInputError("Attachments may total at most 16 MB per prompt.");
    }
    const mimeType = typeof item["mimeType"] === "string" ? item["mimeType"] : "application/octet-stream";
    if (item["kind"] === "image" && !IMAGE_MIME_TYPES.has(mimeType)) {
      throw new AttachmentInputError("Images must be PNG, JPEG, GIF, or WebP.");
    }
    staged.push({ kind: item["kind"], name: item["name"], mimeType, ...decoded });
  }

  const attachments: PromptAttachment[] = [];
  const written: string[] = [];
  const cleanupRejected = async () => {
    await Promise.all(written.map((path) => unlink(path).catch(() => {})));
  };
  try {
    for (const item of staged) {
      if (item.kind === "image") {
        attachments.push({ kind: "image", mimeType: item.mimeType, dataBase64: item.encoded, name: item.name });
      } else {
        const stored = await store(sessionId, item.name, item.encoded);
        written.push(stored.path);
        attachments.push({ kind: "file", ...stored });
      }
    }
  } catch (error) {
    await cleanupRejected();
    throw error;
  }
  return { attachments, cleanupRejected };
}

/* ── sessions ────────────────────────────────────────────────────────────── */

/** The wire shape; `status` is HUI's own and never comes from a record. */
type SessionView = {
  progress?: ProgressCard;
  /** Pull requests this session created; GitHub facts are cached, never stored. */
  pullRequests?: SessionPullRequest[];
  /** Jira work items linked to this session; Jira facts are cached, never stored. */
  jiraIssues?: SessionJiraIssue[];
  id: string;
  title: string;
  group: string;
  cwd: string;
  /** `cwd` with the home directory shortened to `~/`, for display only. */
  displayCwd: string;
  tool: string;
  status: SessionStatus;
  /** Git worktree progress while the session's checkout is still created. */
  creating?: WorktreeProgress;
  /** Why a pending worktree session could not be created, and its unsent prompt. */
  creationError?: string;
  initialPrompt?: string;
  /** Ephemeral process telemetry. Absent when this session is cold or failed. */
  runtime?: {
    active: true;
    memoryBytes?: number;
    bootDurationMs?: number;
  };
  /** A prompt was active when its owning runtime disappeared. */
  interrupted?: true;
  model?: string;
  thinking?: string;
  pinned?: true;
  archived?: true;
  unread?: true;
  icon?: string;
  parentId?: string;
  subagent?: NonNullable<SessionRecord["subagent"]>;
  /** Effective Kanban stage; see `effectiveSessionStage`. */
  stage: SessionStage;
  stageOrigin: SessionStageOrigin;
  createdAt: string;
  updatedAt: string;
};

export class SessionNotFoundError extends Error {
  override name = "SessionNotFoundError";
}

function sessionText(
  body: Record<string, unknown>,
  key: "title" | "group" | "branchName" | "baseRef" | "model" | "thinking" | "initialPrompt",
  maximum: number,
  options: { optional: boolean; allowEmpty: boolean },
): string | undefined {
  if (!(key in body)) {
    return options.optional ? undefined : "";
  }
  if (typeof body[key] !== "string") {
    throw new Error(`${key === "title" ? "Session name" : key === "group" ? "Session group" : key === "branchName" ? "Branch name" : key === "baseRef" ? "Base branch or commit" : key === "model" ? "Session model" : key === "initialPrompt" ? "Initial prompt" : "Thinking level"} must be text.`);
  }
  const value = body[key].trim();
  if (!options.allowEmpty && !value) {
    throw new Error(`${key === "branchName" ? "A branch name" : key === "baseRef" ? "A base branch or commit" : key === "model" ? "A session model" : key === "thinking" ? "A thinking level" : "A session name"} must be 1-${maximum} characters.`);
  }
  if (value.length > maximum) {
    throw new Error(
      `${key === "title" ? "A session name" : key === "group" ? "A session group" : key === "branchName" ? "A branch name" : key === "baseRef" ? "A base branch or commit" : key === "model" ? "A session model" : "A thinking level"} must be ${
        options.allowEmpty ? `at most ${maximum}` : `1-${maximum}`
      } characters.`,
    );
  }
  return value;
}

function sessionGroupName(body: Record<string, unknown>, key = "name"): string {
  if (typeof body[key] !== "string") throw new Error("A group name is required.");
  const value = body[key].trim();
  if (!value || value.length > SESSION_GROUP_MAX) {
    throw new Error(`A group name must be 1-${SESSION_GROUP_MAX} characters.`);
  }
  if (value.toLocaleLowerCase() === "ungrouped") {
    throw new Error('"ungrouped" is reserved for sessions without a group.');
  }
  return value;
}

/** The complete catalog order; registry validation rejects stale lists. */
function sessionGroupOrder(body: Record<string, unknown>): string[] {
  const order = body["order"];
  if (!Array.isArray(order) || order.length > SESSION_GROUP_ORDER_MAX) {
    throw new Error(`A group order must list at most ${SESSION_GROUP_ORDER_MAX} groups.`);
  }
  return order.map((label) => {
    if (typeof label !== "string" || !label || label.length > SESSION_GROUP_MAX) {
      throw new Error(`Group names must be 1-${SESSION_GROUP_MAX} characters.`);
    }
    return label;
  });
}

export async function sessionGroupPatch(body: Record<string, unknown>): Promise<{
  label?: string;
  cwd?: string;
  workspaceMode?: "branch" | "worktree" | "";
  baseRef?: string;
}> {
  const patch: { label?: string; cwd?: string; workspaceMode?: "branch" | "worktree" | ""; baseRef?: string } = {};
  if ("name" in body) patch.label = sessionGroupName(body);
  if ("cwd" in body) {
    if (typeof body["cwd"] !== "string") throw new Error("Working directory must be text.");
    const entered = body["cwd"].trim();
    const cwd = entered ? resolveWorkingDirectory(entered) : "";
    if (cwd) {
      let info;
      try {
        info = await stat(cwd);
      } catch {
        throw new Error(`No such directory: ${cwd}`);
      }
      if (!info.isDirectory()) throw new Error(`Not a directory: ${cwd}`);
    }
    patch.cwd = cwd;
  }
  if ("workspaceMode" in body) {
    const mode = body["workspaceMode"];
    if (mode !== "" && mode !== "branch" && mode !== "worktree") throw new Error("Environment must be branch or worktree.");
    patch.workspaceMode = mode;
  }
  if ("baseRef" in body) patch.baseRef = sessionText(body, "baseRef", SESSION_TITLE_MAX, { optional: false, allowEmpty: true })!;
  if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
  return patch;
}

/** Input/import-source failures are client-visible 400s; registry integrity or
 * storage failures are backend failures and must never be misreported as bad
 * user input. */
export function sessionMutationErrorStatus(error: unknown): 400 | 500 {
  return error instanceof SessionRegistryError ? 500 : 400;
}

/* ── GitHub ── status, device login and previews run through the operator's
 * `gh`; HUI never sees the token. `HUI_GITHUB_CLI` points E2E at a fake executable. */
const GH_COMMAND = process.env["HUI_GITHUB_CLI"] || "gh";
const githubCli = new GitHubCli({ command: GH_COMMAND });
const githubPreviews = new GitHubPreviews(ghApi(GH_COMMAND));
const githubContributions = new GitHubContributionsReader(GH_COMMAND);
const pullRequestStatuses = new PullRequestStatuses(previewPullRequestFetcher(githubPreviews));

const worktreeService = new WorktreeService({
  isRunning: (id) => liveSessions.hasRuntime(id),
  stopSession: (id) => liveSessions.close(id),
});

const WORKTREE_RISKS = new Set(["dirty", "unknown", "locked", "running", "missing", "external"]);

/** Validates `{ paths, mode, acknowledged? }` for worktree removal. */
export function parseWorktreeRemoval(body: unknown): { paths: string[]; mode: "single" | "merged"; acknowledged: WorktreeRisk[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Removal request must be an object.");
  const record = body as Record<string, unknown>;
  const mode = record["mode"];
  if (mode !== "single" && mode !== "merged") throw new Error("mode must be single or merged.");
  const paths = record["paths"];
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200
    || paths.some((path) => typeof path !== "string" || !path.startsWith("/") || path.length > 4096 || path.includes("\0"))) {
    throw new Error("paths must be 1-200 absolute paths.");
  }
  if (mode === "single" && paths.length !== 1) throw new Error("single removal takes exactly one path.");
  const acknowledged = record["acknowledged"] ?? [];
  if (!Array.isArray(acknowledged) || acknowledged.some((risk) => typeof risk !== "string" || !WORKTREE_RISKS.has(risk))) {
    throw new Error("acknowledged must list known worktree risks.");
  }
  if (mode === "merged" && acknowledged.length) throw new Error("merged cleanup never overrides risks.");
  return { paths: [...new Set(paths as string[])], mode, acknowledged: acknowledged as WorktreeRisk[] };
}

/* ── Jira ── the connection is read once and replaced on every write, so the
 * synchronous session view can decide whether Jira lookups are possible. */
const jiraStore = new JiraConfigStore();
let jiraConfig: JiraConfig | undefined;
const jiraConfigReady = jiraStore.read().then((config) => { jiraConfig = config; });
const jiraStatuses = new JiraIssueStatuses();

function jiraClient(): JiraClient {
  if (!jiraConfig) throw new JiraInputError("Connect Jira in Settings → Integrations first.");
  return new JiraClient(jiraConfig);
}

function jiraErrorStatus(error: unknown): number {
  if (error instanceof JiraInputError) return 400;
  if (error instanceof JiraRequestError) return 502;
  return 500;
}

/**
 * Creates a work item from the dialog body and assigns it to the connected
 * account unless `assignToMe: false`. Connections saved before accountId was
 * stored learn it once from /myself. A refusal leaves the item unassigned and
 * is reported as `warning`, but never undoes the creation. The new item's facts
 * are seeded so views show it before the next lookup.
 */
async function createAssignedJiraIssue(client: JiraClient, body: Record<string, unknown>): Promise<{
  ref: { key: string; url: string };
  input: ReturnType<typeof validateCreateInput>;
  warning: string;
}> {
  const input = validateCreateInput(body);
  const { issueTypeId, parents } = await parentCandidates(client, input.project);
  if (input.parent && !parents.some((parent) => parent.key === input.parent)) {
    throw new JiraInputError(`${input.parent} cannot be the parent of a new work item in ${input.project}.`);
  }
  const key = await client.create({ ...input, issueTypeId, ...(input.parent ? { parent: input.parent } : {}) });
  const ref = { key, url: jiraIssueUrl(jiraConfig!.site, key) };
  let warning = "";
  if (body["assignToMe"] !== false) {
    try {
      let accountId = jiraConfig!.accountId ?? "";
      if (!accountId) {
        accountId = (await client.myself()).accountId;
        if (accountId && jiraConfig) {
          jiraConfig = { ...jiraConfig, accountId };
          await jiraStore.write(jiraConfig);
        }
      }
      if (!accountId) throw new JiraRequestError("Jira did not report your account id.");
      await client.assign(key, accountId);
    } catch (error) {
      warning = `${key} was created but could not be assigned to you: ${error instanceof Error ? error.message : "Jira refused."}`;
    }
  }
  jiraStatuses.remember(ref, { summary: input.summary, description: input.description.slice(0, 4_000), status: "To Do", statusCategory: "new" });
  void client.issue(key).then((details) => jiraStatuses.remember(ref, details), () => undefined);
  return { ref, input, warning };
}

function sessionJiraIssues(record: SessionRecord, transcript: readonly TranscriptEntry[]): SessionJiraIssue[] {
  const refs = mergeJiraRefs(record.jiraIssues ?? [], jiraIssuesFromTranscript(transcript));
  const config = jiraConfig;
  const origin = config ? new URL(config.site).origin : "";
  const fetch = config ? (key: string) => new JiraClient(config).issue(key) : undefined;
  // Only work items on the connected site are looked up with its credentials.
  return refs.map((ref) => jiraStatuses.view(ref, origin && new URL(ref.url).origin === origin ? fetch : undefined));
}

function toView(
  record: SessionRecord,
  status: SessionStatus,
  runtime?: SessionView["runtime"],
): SessionView {
  const transcript = liveSessions.transcript(record.id);
  const pullRequests = pullRequestsFromTranscript(transcript).map((ref) => pullRequestStatuses.view(ref));
  const jiraIssues = sessionJiraIssues(record, transcript);
  return {
    id: record.id,
    progress: progressCardFromTranscript(transcript),
    ...(pullRequests.length ? { pullRequests } : {}),
    ...(jiraIssues.length ? { jiraIssues } : {}),
    title: record.title,
    group: record.group,
    cwd: record.cwd,
    displayCwd: record.cwd ? displayPath(record.cwd) : "",
    tool: record.tool,
    status,
    ...(runtime ? { runtime } : {}),
    ...(record.runStartedAt && status !== "running" && status !== "waiting"
      ? { interrupted: true as const }
      : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.thinking ? { thinking: record.thinking } : {}),
    ...(record.pinned ? { pinned: true } : {}),
    ...(record.archived ? { archived: true } : {}),
    ...(record.unread ? { unread: true } : {}),
    ...(record.icon ? { icon: record.icon } : {}),
    ...(record.parentId ? { parentId: record.parentId } : {}),
    ...(record.subagent ? { subagent: record.subagent } : {}),
    ...effectiveSessionStage(record, pullRequests),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Pull-request evidence is only visible while a transcript is loaded. Persist
 * each advance it proves so a cold session keeps its column after a restart.
 * Only a changed stage writes; ordinary polling stays read-only. */
let stagePersistence: Promise<unknown> = Promise.resolve();
function persistInferredStages(records: readonly SessionRecord[], views: readonly SessionView[]): void {
  const stored = new Map(records.map((record) => [record.id, record.stage]));
  const inferred = new Map(views
    .filter((view) => view.stageOrigin === "pullRequest" && stored.get(view.id) !== view.stage)
    .map((view) => [view.id, view.stage]));
  if (!inferred.size) return;
  stagePersistence = stagePersistence.then(() => updateRegistry((current) => current.map((record) => {
    const stage = inferred.get(record.id);
    if (!stage || record.stageSource === "operator" || record.stage === stage) return record;
    return stageRank(stage) > stageRank(effectiveSessionStage(record).stage)
      ? { ...record, stage, stageSource: "pullRequest" }
      : record;
  }))).catch((error: unknown) => {
    recordDiagnosticEvent({
      area: "session",
      level: "error",
      action: "session_stage_persist_failed",
      summary: error instanceof Error ? error.message : "Could not persist an inferred session stage.",
    });
  });
}

function knownPullRequestUrls(sessionId: string): string[] {
  return pullRequestsFromTranscript(liveSessions.transcript(sessionId)).map((ref) => ref.url.toLowerCase()).slice(-20);
}

/** `set_stage` from a session's own agent. An operator placement wins, so the
 * tool reports it instead of silently overriding the board. */
export async function setAgentStage(
  sessionId: string,
  params: Record<string, unknown>,
  registryUpdater: typeof updateRegistry = updateRegistry,
  knownPullRequests: (id: string) => string[] = knownPullRequestUrls,
): Promise<{ stage: SessionStage; applied: boolean; message: string }> {
  const stage = params["stage"];
  if (!isSessionStage(stage)) {
    throw new Error(`stage must be one of: ${SESSION_STAGES.join(", ")}. Backlog holds backlog items, not conversations.`);
  }
  let result: { stage: SessionStage; applied: boolean; message: string } | undefined;
  await registryUpdater((records) => {
    if (!records.some((record) => record.id === sessionId)) {
      throw new SessionNotFoundError("Conversation no longer exists.");
    }
    return records.map((record) => {
      if (record.id !== sessionId) return record;
      if (record.stageSource === "operator" && record.stage) {
        result = {
          stage: record.stage,
          applied: false,
          message: `The operator placed this session in ${SESSION_STAGE_LABELS[record.stage]}; their placement wins until they reset it.`,
        };
        return record;
      }
      result = { stage, applied: true, message: `Stage set to ${SESSION_STAGE_LABELS[stage]}.` };
      const stagePullRequests = knownPullRequests(sessionId);
      return { ...record, stage, stageSource: "agent", stagePullRequests: stagePullRequests.length ? stagePullRequests : undefined };
    });
  });
  if (!result) throw new SessionNotFoundError("Conversation no longer exists.");
  return result;
}

/** The stored record has no idea whether a runtime is booting, so the live
 * status is layered on at read time. */
async function listSessionViews(): Promise<{ label: string; sessions: SessionView[] }[]> {
  // Taken before the registry read: a record is persisted before its pending
  // entry is dropped, so every list contains a finishing session once.
  const pendingSnapshot = [...pendingSessions.values()];
  const registry = await readSessionRegistry();
  const runtimes = liveSessions.runtimeTelemetry();
  const memoryByPid = await runtimeMemoryByPid([...runtimes.values()].flatMap(({ pid }) => pid ? [pid] : []));
  const runtimeViews = new Map([...runtimes].map(([id, runtime]) => [id, {
    active: true as const,
    ...(runtime.pid && memoryByPid.has(runtime.pid) ? { memoryBytes: memoryByPid.get(runtime.pid)! } : {}),
    ...(runtime.bootDurationMs !== undefined ? { bootDurationMs: runtime.bootDurationMs } : {}),
  }]));
  const registered = new Set(registry.sessions.map(({ id }) => id));
  const pending = new Map(pendingSnapshot.filter(({ record }) => !registered.has(record.id)).map((entry) => [entry.record.id, entry]));
  const views = groupSessions([...registry.sessions, ...[...pending.values()].map(({ record }) => record)], registry.groups).map((group) => ({
    label: group.label,
    ...(group.cwd ? { cwd: group.cwd } : {}),
    ...(group.workspaceMode ? { workspaceMode: group.workspaceMode } : {}),
    ...(group.baseRef ? { baseRef: group.baseRef } : {}),
    sessions: group.sessions.map((record) => {
      const entry = pending.get(record.id);
      return entry ? pendingView(entry) : toView(record, liveSessions.status(record.id), runtimeViews.get(record.id));
    }),
  }));
  persistInferredStages(registry.sessions, views.flatMap((group) => group.sessions));
  return views;
}

const sessionList = createSessionListHub(listSessionViews);

function automationErrorStatus(error: unknown): 400 | 404 | 409 | 500 {
  if (error instanceof AutomationNotFoundError) return 404;
  if (error instanceof AutomationConflictError) return 409;
  if (error instanceof AutomationInputError) return 400;
  return 500;
}

function waitForAutomationSession(
  record: SessionRecord,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      watched.unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new DOMException("Run cancelled.", "AbortError"));
    const watched = liveSessions.watch(record.id, (message) => {
      if (message.kind !== "status") return;
      if (message.status === "idle") finish();
      else if (message.status === "running" || message.status === "waiting") {
        finish(new AutomationConflictError("The target session is already running."));
      } else if (message.status === "error") {
        finish(new Error("The target session runtime could not start."));
      }
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else if (watched.snapshot.status === "idle") finish();
    else if (watched.snapshot.status === "running" || watched.snapshot.status === "waiting") {
      finish(new AutomationConflictError("The target session is already running."));
    } else if (watched.snapshot.status === "error") {
      finish(new Error("The target session runtime could not start."));
    }
  });
}

function waitForAutomationRun(
  record: SessionRecord,
  signal: AbortSignal,
): Promise<AutomationExecution> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      watched.unsubscribe();
      if (error) {
        reject(error);
        return;
      }
      const lastAssistant = liveSessions.transcript(record.id)
        .findLast((entry) => entry.kind === "message" && entry.role === "assistant");
      const summary = lastAssistant?.kind === "message" ? lastAssistant.text.trim() : "";
      resolve(summary ? { summary } : {});
    };
    const onAbort = () => {
      void liveSessions.abort(record.id).finally(() => {
        finish(new DOMException("Run cancelled.", "AbortError"));
      });
    };
    const watched = liveSessions.watch(record.id, (message) => {
      if (message.kind === "event" && message.event.type === "settled") finish();
      else if (message.kind === "status" && message.status === "error") {
        finish(new Error("The target session runtime failed."));
      } else if (message.kind === "closed") {
        finish(new Error("The target session runtime exited."));
      }
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function executeAutomationTask(
  task: AutomationTask,
  signal: AbortSignal,
): Promise<AutomationExecution> {
  const record = (await readRegistry()).find((session) => session.id === task.sessionId);
  if (!record) throw new AutomationNotFoundError("The target session no longer exists.");
  if (liveSessions.status(record.id) === "running") {
    throw new AutomationConflictError("The target session is already running.");
  }
  if (!liveSessions.ensure(record)) {
    throw new AutomationNotFoundError("The target session no longer exists.");
  }
  await waitForAutomationSession(record, signal);
  const completion = waitForAutomationRun(record, signal);
  try {
    await liveSessions.prompt(record.id, task.prompt);
  } catch (error) {
    // The completion watcher has not observed a turn yet. Cancelling it keeps
    // the subscription from leaking while the original acceptance error is
    // reported to the automation run.
    if (!signal.aborted) await liveSessions.abort(record.id).catch(() => undefined);
    throw error;
  }
  return completion;
}

const automation = new AutomationService(AUTOMATION_FILE, executeAutomationTask);

/** Registers a session and starts it. The directory is checked before anything
 * is written: a bad cwd would otherwise fail minutes later, inside pi. */
/** A browser-entered working directory, resolved (`~/`) and confirmed to be
 * an existing directory. */
async function existingDirectory(value: unknown): Promise<string> {
  if (typeof value !== "string") throw new Error("Working directory must be text.");
  const cwd = resolveWorkingDirectory(value);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new Error(`No such directory: ${cwd}`);
  }
  if (!info.isDirectory()) throw new Error(`Not a directory: ${cwd}`);
  return cwd;
}

export async function createSession(
  body: Record<string, unknown>,
  sessions: Pick<typeof liveSessions, "accept" | "ensure"> = liveSessions,
  registryUpdater: typeof updateRegistry = updateRegistry,
  onWorktreeProgress?: (progress: WorktreeProgress) => void,
  /** Server-decided fields, never taken from a browser body: an operator
   * stage placement (a started backlog item). `onPending` receives the
   * provisional record once the body is valid, again once it is named.
   * `nameSession` replaces the utility-model call in tests. */
  seed: {
    stage?: SessionStage;
    onPending?: (record: SessionRecord) => void;
    nameSession?: typeof generateSessionNames;
  } = {},
): Promise<SessionRecord> {
  if (typeof body["cwd"] !== "string") throw new Error("Working directory must be text.");
  let cwd = resolveWorkingDirectory(body["cwd"]);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new Error(`No such directory: ${cwd}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Not a directory: ${cwd}`);
  }

  const title = sessionText(body, "title", SESSION_TITLE_MAX, {
    optional: true,
    allowEmpty: false,
  });
  const initialPrompt = sessionText(body, "initialPrompt", 4_000, {
    optional: true,
    allowEmpty: false,
  });
  const group =
    sessionText(body, "group", SESSION_GROUP_MAX, { optional: true, allowEmpty: true }) ?? "";
  if (body["worktree"] !== undefined && typeof body["worktree"] !== "boolean") {
    throw new Error("Create in workspace must be true or false.");
  }
  const requestedWorktree = body["worktree"] === true;
  const branchName = sessionText(body, "branchName", SESSION_TITLE_MAX, {
    optional: true,
    allowEmpty: false,
  });
  const baseRef = sessionText(body, "baseRef", SESSION_TITLE_MAX, {
    optional: true,
    allowEmpty: false,
  });
  if (branchName && !requestedWorktree) {
    throw new Error("A branch name requires Create workspace.");
  }
  // Which runtime drives it. PI is the only adapter; an explicit other name is
  // rejected rather than silently started as PI.
  const tool = typeof body["tool"] === "string" ? body["tool"].trim() : "";
  if (tool && !NEW_SESSION_TOOLS.has(tool)) {
    throw new Error(`Unsupported session tool: ${tool}`);
  }
  const model = sessionText(body, "model", SESSION_TITLE_MAX, {
    optional: true,
    allowEmpty: false,
  });
  // Only the first slash separates the provider; gateway model IDs may
  // themselves be namespaced, e.g. vercel-ai-gateway/anthropic/claude-opus.
  if (model && !/^[^/\s]+\/\S+$/.test(model)) {
    throw new Error("Session model must use provider/id format.");
  }
  const thinking = sessionText(body, "thinking", 16, {
    optional: true,
    allowEmpty: false,
  });
  if (thinking && !NEW_SESSION_THINKING_LEVELS.has(thinking)) {
    throw new Error(`Unsupported thinking level: ${thinking}`);
  }
  const runtimeTool = tool || "pi";
  const settings = await readSettings();
  const id = randomUUID();
  const now = new Date().toISOString();
  const recordNamed = (named: string): SessionRecord => ({
    id,
    title: named,
    group,
    cwd,
    tool: runtimeTool,
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(seed.stage ? { stage: seed.stage, stageSource: "operator" as const } : {}),
    createdAt: now,
    updatedAt: now,
    source: "hui",
  });
  // Without an operator branch name, a new worktree gets a short generated
  // one, asked for in the same utility call that names the session.
  if (initialPrompt && requestedWorktree && !branchName) onWorktreeProgress?.({ phase: "naming" });
  const provisionalTitle = title ?? (initialPrompt ? fallbackTitle(initialPrompt) : basename(cwd));
  seed.onPending?.(recordNamed(provisionalTitle));
  const nameSession = seed.nameSession ?? generateSessionNames;
  // A worktree needs its branch name before Git starts, and its request has
  // already returned. A plain session is registered under the provisional
  // title at once and renamed when the utility model answers, so the request
  // never waits on a model call.
  const namesLater = Boolean(initialPrompt && !title && !requestedWorktree);
  const names = initialPrompt && !namesLater
    ? await nameSession({
        cwd,
        prompt: initialPrompt,
        settings,
        ...(title ? { title } : {}),
        branch: requestedWorktree && !branchName,
      })
    : undefined;
  const effectiveTitle = title ?? names?.title ?? provisionalTitle;
  if (names) seed.onPending?.(recordNamed(effectiveTitle));
  const effectiveBranchName = branchName
    ?? names?.branchName
    ?? (requestedWorktree ? fallbackBranchName(effectiveTitle) : undefined);
  const createdWorktree = requestedWorktree
    ? await createSessionWorktree({
        sourceDirectory: cwd,
        title: effectiveTitle,
        ...(effectiveBranchName ? { branchName: effectiveBranchName } : {}),
        baseRef,
        branchPrefix: settings.branchPrefix,
        onProgress: onWorktreeProgress,
      })
    : undefined;
  if (createdWorktree) cwd = createdWorktree.cwd;
  if (!createdWorktree && baseRef) await checkoutSessionRef(cwd, baseRef);
  const record = recordNamed(effectiveTitle);
  // Persisted before the runtime starts, so a second connection can find it
  // while pi is still booting.
  try {
    await registryUpdater((records) => upsert(records, [record]));
  } catch (error) {
    if (createdWorktree) {
      try {
        await createdWorktree.rollback();
      } catch (rollbackError) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    throw error;
  }
  sessions.accept(record.id);
  sessions.ensure(record);
  if (namesLater && initialPrompt) {
    void renameWithGeneratedTitle(record, () => nameSession({ cwd, prompt: initialPrompt, settings }), registryUpdater);
  }
  return record;
}

/**
 * Replaces a session's provisional title with the utility model's name. An
 * operator rename or a delete in the meantime wins: only a record still
 * carrying the provisional title changes. Open browsers learn the new title
 * from the session status stream.
 */
export async function renameWithGeneratedTitle(
  record: SessionRecord,
  generate: () => Promise<{ title: string }>,
  registryUpdater: typeof updateRegistry = updateRegistry,
  publish: (update: PendingStatusUpdate) => void = publishPendingStatus,
  status: (id: string) => SessionStatus = (id) => liveSessions.status(id),
): Promise<SessionRecord | undefined> {
  try {
    const { title } = await generate();
    if (!title || title === record.title) return undefined;
    let renamed: SessionRecord | undefined;
    await registryUpdater((records) => records.map((current) => {
      if (current.id !== record.id || current.title !== record.title) return current;
      renamed = { ...current, title };
      return renamed;
    }));
    if (renamed) publish({ id: record.id, status: status(record.id), title });
    return renamed;
  } catch (error) {
    recordDiagnosticEvent({
      area: "session",
      level: "warning",
      action: "session_title_failed",
      sessionId: record.id,
      summary: error instanceof Error ? error.message : "Could not store the generated session title.",
    });
    return undefined;
  }
}

/** Worktree sessions whose checkout is still being created, shown in the
 * sidebar before their record exists. Memory only: a restart forgets them. */
type PendingSession = { record: SessionRecord; creating?: WorktreeProgress; error?: string; prompt: string };
type PendingStatusUpdate = Pick<SessionStatusUpdate, "id" | "status">
  & Pick<SessionView, "creating" | "creationError">
  & { title?: string };
const pendingSessions = new Map<string, PendingSession>();
const pendingStatusSubscribers = new Set<(update: PendingStatusUpdate) => void>();

function pendingStatus({ record, creating, error }: PendingSession): PendingStatusUpdate {
  return {
    id: record.id,
    status: error ? "error" : "starting",
    ...(creating ? { creating } : {}),
    ...(error ? { creationError: error } : {}),
  };
}

function publishPendingStatus(update: PendingStatusUpdate): void {
  for (const subscriber of pendingStatusSubscribers) subscriber(update);
}

function pendingView(entry: PendingSession): SessionView {
  const { id: _id, status, ...creation } = pendingStatus(entry);
  return {
    ...toView(entry.record, status),
    ...creation,
    // A failed launch hands its prompt back so dismissing it loses nothing.
    ...(entry.error && entry.prompt ? { initialPrompt: entry.prompt } : {}),
  };
}

/**
 * Returns as soon as a worktree session's input is valid, so the browser can
 * show it and start others while Git works. The gateway sends the first prompt
 * once the runtime is ready: nothing depends on the launching page staying open.
 */
export async function startWorktreeSession(
  body: Record<string, unknown>,
  sessions: Pick<typeof liveSessions, "accept" | "ensure" | "status" | "watch" | "prompt"> = liveSessions,
  registryUpdater: typeof updateRegistry = updateRegistry,
): Promise<SessionView> {
  const prompt = typeof body["initialPrompt"] === "string" ? body["initialPrompt"].trim() : "";
  let entry: PendingSession | undefined;
  let creating: WorktreeProgress = { phase: "preparing" };
  let accept!: (view: SessionView) => void;
  const accepted = new Promise<SessionView>((resolve) => { accept = resolve; });
  const created = createSession(body, sessions, registryUpdater, (progress) => {
    creating = progress;
    if (!entry) return;
    entry.creating = progress;
    publishPendingStatus(pendingStatus(entry));
  }, {
    onPending: (record) => {
      entry = { record, creating, prompt };
      pendingSessions.set(record.id, entry);
      publishPendingStatus(pendingStatus(entry));
      accept(pendingView(entry));
    },
  });
  void created.then(async (record) => {
    pendingSessions.delete(record.id);
    publishPendingStatus({ id: record.id, status: sessions.status(record.id) });
    if (!prompt) return;
    // No browser is waiting on this, so allow a slow runtime boot.
    await waitForSessionReady(record.id, 10 * 60_000, sessions);
    const prepared = await readAttachments(record.id, body["initialAttachments"]);
    await sessions.prompt(record.id, prompt, prepared.attachments).catch(async (error: unknown) => {
      await prepared.cleanupRejected();
      throw error;
    });
  }, (error: unknown) => {
    // Invalid input rejects before `onPending` and is answered by the request.
    if (!entry) return;
    entry.creating = undefined;
    entry.error = error instanceof Error ? error.message : "Could not create the Git worktree.";
    publishPendingStatus(pendingStatus(entry));
  }).catch((error: unknown) => {
    // ponytail: the session shows its runtime error, but this prompt is only logged;
    // hand it back like a failed checkout's `initialPrompt` if runtimes fail here in practice.
    recordDiagnosticEvent({
      area: "session",
      level: "error",
      action: "session_initial_prompt_failed",
      summary: error instanceof Error ? error.message : "Could not send the first prompt.",
    });
  });
  // Invalid input rejects before `onPending`; otherwise the pending view wins.
  await Promise.race([accepted, created]);
  return accepted;
}

/** Resolves once a freshly created session can accept its first prompt. */
function waitForSessionReady(
  id: string,
  timeoutMs = SUGGESTION_READY_TIMEOUT_MS,
  sessions: Pick<typeof liveSessions, "watch"> = liveSessions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watched.unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = (status: SessionStatus) => {
      if (status === "idle") finish();
      else if (status === "error") finish(new Error("The new session runtime could not start."));
    };
    const timer = setTimeout(() => finish(new Error("The new session did not start in time.")), timeoutMs);
    timer.unref();
    const watched = sessions.watch(id, (message) => {
      if (message.kind === "status") inspect(message.status);
      else if (message.kind === "snapshot") inspect(message.snapshot.status);
      else if (message.kind === "closed") finish(new Error("The new session runtime exited."));
    });
    inspect(watched.snapshot.status);
  });
}

/**
 * Starts a suggestion as its own session: same group and runtime as the
 * source, the suggestion's directory and title, and its problem plus proposed
 * fix (or a request to investigate) as the first turn. The card is removed only once that prompt has been accepted; a
 * failure releases it so the operator can retry, and keeps any created
 * session visible rather than deleting it behind their back.
 */
async function startTaskSuggestion(
  source: SessionRecord,
  suggestionId: string,
  mode: TaskSuggestionStartMode = "session",
): Promise<SessionView> {
  const suggestion = taskSuggestions.claim(source.id, suggestionId);
  try {
    if (mode === "current") {
      // Same conversation: prompt when idle, otherwise steer the active run
      // like a composer message, falling back to a queued follow-up.
      if (!liveSessions.ensure(source)) throw new SessionNotFoundError(`unknown session: ${source.id}`);
      if (liveSessions.status(source.id) === "starting") await waitForSessionReady(source.id);
      const text = taskSuggestionPrompt(suggestion);
      if (liveSessions.status(source.id) === "idle") await liveSessions.prompt(source.id, text);
      else {
        try { await liveSessions.steer(source.id, text); }
        catch { await liveSessions.followUp(source.id, text); }
      }
      taskSuggestions.remove(source.id, suggestionId);
      const current = (await readRegistry()).find((session) => session.id === source.id) ?? source;
      return toView(current, liveSessions.status(source.id));
    }
    const record = await createSession({
      cwd: suggestion.cwd,
      title: suggestion.title.slice(0, SESSION_TITLE_MAX),
      group: source.group,
      tool: "pi",
      ...(mode === "worktree" ? { worktree: true } : {}),
    });
    await waitForSessionReady(record.id);
    await liveSessions.prompt(record.id, taskSuggestionPrompt(suggestion));
    taskSuggestions.remove(source.id, suggestionId);
    const current = (await readRegistry()).find((session) => session.id === record.id) ?? record;
    return toView(current, liveSessions.status(record.id));
  } catch (error) {
    taskSuggestions.release(suggestionId);
    throw error;
  }
}

/* ── backlog ── local tasks and HUI metadata in backlog.json; assigned To Do
 * Jira items are read live through a short cache. */
const backlogStore = new BacklogStore();
const backlogFeed = new BacklogJiraFeed();
/** Backlog items whose session is being started, so a double drop cannot
 * start the same item twice. */
const startingBacklogItems = new Set<string>();

function backlogErrorStatus(error: unknown): number {
  if (error instanceof BacklogNotFoundError || error instanceof TaskSuggestionNotFoundError) return 404;
  if (error instanceof BacklogInputError || error instanceof TaskSuggestionInputError || error instanceof JiraInputError) return 400;
  if (error instanceof SessionBusyError) return 409;
  if (error instanceof JiraRequestError) return 502;
  if (error instanceof BacklogStoreError || error instanceof SessionRegistryError) return 500;
  return error instanceof Error ? 400 : 500;
}

/** Jira keys any session already holds (registry links and, for loaded
 * transcripts, work items the session created). */
async function sessionLinkedJiraKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const record of await readRegistry()) {
    for (const ref of mergeJiraRefs(record.jiraIssues ?? [], jiraIssuesFromTranscript(liveSessions.transcript(record.id)))) keys.add(ref.key);
  }
  return keys;
}

function jiraFetcherFor(url: string): JiraIssueFetcher | undefined {
  const config = jiraConfig;
  if (!config || new URL(url).origin !== new URL(config.site).origin) return undefined;
  return (key: string) => new JiraClient(config).issue(key);
}

export async function listBacklog(force = false): Promise<BacklogView> {
  await jiraConfigReady;
  const state = await backlogStore.read();
  const linkedKeys = await sessionLinkedJiraKeys();
  const config = jiraConfig;
  let issues: SessionJiraIssue[] = [];
  let jira: BacklogView["jira"] = { status: "unconfigured" };
  if (config) {
    const result = await backlogFeed.get(`${config.site}\u0000${config.email}`, () => fetchAssignedTodo(new JiraClient(config), config.site), force);
    if ("issues" in result) {
      issues = result.issues;
      jira = { status: "ok" };
    } else {
      jira = { status: "unavailable", message: result.error };
    }
  }
  const items = mergeBacklog({ state, issues, linkedKeys, viewAttached: (ref) => jiraStatuses.view(ref, jiraFetcherFor(ref.url)) });
  return { items, jira };
}

async function findBacklogItem(itemId: string): Promise<BacklogItem> {
  const item = (await listBacklog()).items.find((candidate) => candidate.id === itemId);
  if (!item) throw new BacklogNotFoundError("That item is no longer in the backlog.");
  return item;
}

/**
 * Starts a backlog item as a session: its title, the chosen directory (and
 * optional worktree/base ref), the chosen group and an operator placement in
 * the target column. The first prompt is the Jira summary and description or
 * the local problem and fix. Only once that prompt is accepted does the item
 * leave the backlog: a Jira key is linked to the session, a local task is
 * removed. A failure keeps the item; a session already created is kept.
 */
export async function startBacklogItem(itemId: string, body: Record<string, unknown>): Promise<SessionView> {
  if (!isSessionStage(body["stage"])) throw new BacklogInputError(`stage must be one of: ${SESSION_STAGES.join(", ")}.`);
  const stage = body["stage"];
  if (typeof body["group"] !== "string") throw new BacklogInputError("A group must be text.");
  if (startingBacklogItems.has(itemId)) throw new BacklogInputError("That item is already starting.");
  startingBacklogItems.add(itemId);
  try {
    let item = await findBacklogItem(itemId);
    // The first prompt carries the full description; refresh it when the
    // cached feed copy has none.
    if (item.jira && item.kind === "jira" && !item.jira.description && jiraConfig) {
      try {
        const details = await jiraClient().issue(item.jira.key);
        item = { ...item, jira: { ...item.jira, ...details } };
      } catch { /* Start with what the feed confirmed. */ }
    }
    const record = await createSession({
      cwd: body["cwd"],
      title: item.title.slice(0, SESSION_TITLE_MAX),
      group: body["group"],
      tool: "pi",
      ...(body["worktree"] !== undefined ? { worktree: body["worktree"] } : {}),
      ...(body["branchName"] ? { branchName: body["branchName"] } : {}),
      ...(body["baseRef"] ? { baseRef: body["baseRef"] } : {}),
    }, liveSessions, updateRegistry, undefined, { stage });
    await waitForSessionReady(record.id);
    await liveSessions.prompt(record.id, backlogItemPrompt(item));
    if (item.jira) {
      const ref = { key: item.jira.key, url: item.jira.url };
      await updateRegistry((sessions) => sessions.map((session) => session.id === record.id
        ? { ...session, jiraIssues: mergeJiraRefs(session.jiraIssues ?? [], [ref]) }
        : session));
    }
    const [kind, key] = splitItemId(itemId);
    if (kind === "local") await backlogStore.removeTask(key).catch((error: unknown) => { if (!(error instanceof BacklogNotFoundError)) throw error; });
    else if (kind === "jira") await backlogStore.forgetJira(key);
    const current = (await readRegistry()).find((session) => session.id === record.id) ?? record;
    return toView(current, liveSessions.status(record.id));
  } finally {
    startingBacklogItems.delete(itemId);
  }
}

/** A pending suggestion becomes a local backlog task (group OTHER, same
 * directory) and its card is removed. */
async function saveSuggestionToBacklog(sessionId: string, suggestionId: string) {
  const suggestion = taskSuggestions.claim(sessionId, suggestionId);
  try {
    const task = await backlogStore.addTask({ title: suggestion.title, problem: suggestion.problem, fix: suggestion.fix, cwd: suggestion.cwd, group: "" });
    taskSuggestions.remove(sessionId, suggestionId);
    return task;
  } finally {
    taskSuggestions.release(suggestionId);
  }
}

/** Tombstone first to close stale open/events races. If durable removal fails,
 * roll the tombstone back so the still-existing row can be opened again. */
export async function deleteSession(
  id: string,
  sessions: Pick<
    typeof liveSessions,
    "tombstone" | "finishDelete" | "rollbackDelete"
  > = liveSessions,
  registryUpdater: typeof updateRegistry = updateRegistry,
): Promise<void> {
  const tokens = new Map<string, DeleteToken>([[id, sessions.tombstone(id)]]);
  try {
    await registryUpdater((records) => {
      if (!records.some((record) => record.id === id)) {
        throw new SessionNotFoundError(`unknown session: ${id}`);
      }
      const tree = sessionTreeIds(records, id);
      for (const descendant of tree) {
        if (!tokens.has(descendant)) tokens.set(descendant, sessions.tombstone(descendant));
      }
      return records.filter((record) => !tree.has(record.id));
    });
  } catch (error) {
    for (const [sessionId, token] of tokens) sessions.rollbackDelete(sessionId, token);
    throw error;
  }
  subagents.forgetSessions(new Set(tokens.keys()));
  taskSuggestions.forget(tokens.keys());
  for (const [sessionId, token] of tokens) {
    sessions.finishDelete(sessionId, token);
    terminals.closeOwner(sessionId);
    managedBrowser.closeOwner(sessionId);
  }
  // Watcher cleanup must not fail a deletion that already committed.
  try {
    await watchers.forget(tokens.keys());
  } catch (error) {
    recordDiagnosticEvent({
      area: "session",
      level: "error",
      action: "watcher_forget_failed",
      summary: error instanceof Error ? error.message : "Could not remove deleted conversations' watchers.",
    });
  }
}

export async function updateSession(
  id: string,
  body: Record<string, unknown>,
  registryUpdater: typeof updateRegistry = updateRegistry,
): Promise<SessionRecord> {
  const patch: Partial<SessionRecord> = {};
  const title = sessionText(body, "title", SESSION_TITLE_MAX, {
    optional: true,
    allowEmpty: false,
  });
  if (title !== undefined) patch.title = title;
  const group = sessionText(body, "group", SESSION_GROUP_MAX, {
    optional: true,
    allowEmpty: true,
  });
  if (group !== undefined) patch.group = group;
  if ("pinned" in body) {
    if (typeof body["pinned"] !== "boolean") {
      throw new Error("Pinned must be a boolean.");
    }
    patch.pinned = body["pinned"];
  }
  for (const key of ["archived", "unread"] as const) {
    if (!(key in body)) continue;
    if (typeof body[key] !== "boolean") {
      throw new Error(`${key === "archived" ? "Archived" : "Unread"} must be a boolean.`);
    }
    patch[key] = body[key];
  }
  if ("icon" in body) {
    if (typeof body["icon"] !== "string") throw new Error("Session icon must be text.");
    const icon = body["icon"].trim();
    if (icon.length > 32) throw new Error("Session icon must be at most 32 characters.");
    patch.icon = icon || undefined;
  }
  if ("stage" in body) {
    // An operator placement; `null` hands the column back to the agent and
    // pull-request signals, starting again from Investigation. Backlog holds
    // backlog items, never sessions.
    if (body["stage"] === null) {
      patch.stage = undefined;
      patch.stageSource = undefined;
      patch.stagePullRequests = undefined;
    } else if (body["stage"] === "backlog") {
      throw new Error("Sessions cannot be moved to Backlog; it holds backlog items only.");
    } else if (isSessionStage(body["stage"])) {
      patch.stage = body["stage"];
      patch.stageSource = "operator";
      const known = knownPullRequestUrls(id);
      patch.stagePullRequests = known.length ? known : undefined;
    } else {
      throw new Error(`Session stage must be null or one of: ${SESSION_STAGES.join(", ")}.`);
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("Nothing to change.");
  }

  let updated: SessionRecord | undefined;
  await registryUpdater((records) => {
    if (!records.some((record) => record.id === id)) {
      throw new SessionNotFoundError(`unknown session: ${id}`);
    }
    const tree = patch.archived === undefined ? new Set([id]) : sessionTreeIds(records, id);
    return records.map((record) => {
      if (record.id !== id) {
        return tree.has(record.id) ? { ...record, archived: patch.archived } : record;
      }
      updated = { ...record, ...patch };
      return updated;
    });
  });
  if (!updated) throw new SessionNotFoundError(`unknown session: ${id}`);
  return updated;
}

function writeEvent(response: ServerResponse, event: string, data: unknown): void {
  if (!response.writableEnded) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/**
 * Paints the session once, then forwards everything that happens to it until
 * the returned unsubscribe runs. The caller has already ensured the runtime.
 */
function watchSessionEvents(
  id: string,
  send: (event: string, data: unknown) => void,
  sessions: Pick<typeof liveSessions, "watch"> = liveSessions,
): () => void {
  const watched = sessions.watch(id, (message) => {
    switch (message.kind) {
      case "snapshot":
        send("snapshot", message.snapshot);
        break;
      case "transcript":
        send("transcript", message.entries);
        break;
      case "status":
        send("status", { status: message.status });
        break;
      case "event":
        send("event", message.event);
        break;
      case "model":
        send("model", message.model);
        break;
      case "thinking":
        send("thinking_level", { level: message.level });
        break;
      case "closed":
        send("closed", {});
        break;
    }
  }, { reader: true });
  send("snapshot", watched.snapshot);
  return watched.unsubscribe;
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

async function handleRequest(
  request: Connect.IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const presentedMedia = path.match(PRESENTED_MEDIA_ROUTE);
  // Native img/audio/video elements cannot set x-hui. Their opaque random id is
  // the read capability, and CORP prevents embedding it from another origin.
  if (presentedMedia) {
    if (!await servePresentedMedia(request, response, presentedMedia[1] ?? "", presentedMedia[2] ?? "")) {
      sendJson(response, 404, { error: "media not found" });
    }
    return;
  }
  const attachmentRoute = path.match(/^\/__hui\/sessions\/([^/]+)\/attachments\/(\d{1,9})\/(\d{1,4})$/u);
  if (attachmentRoute) {
    // <img> cannot send x-hui; accept it or a browser-attested same-origin
    // fetch, and refuse everything cross-site.
    const site = request.headers["sec-fetch-site"];
    if (request.headers[CLIENT_HEADER] !== "1" && site !== "same-origin") {
      sendJson(response, 403, { error: `missing ${CLIENT_HEADER} header` });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const id = decodeURIComponent(attachmentRoute[1] ?? "");
    const record = (await readRegistry()).find((session) => session.id === id);
    if (!record) {
      sendJson(response, 404, { error: `unknown session: ${id}` });
      return;
    }
    const image = liveSessions.attachmentImage(id, Number(attachmentRoute[2]), Number(attachmentRoute[3]));
    if (!image) {
      sendJson(response, 404, { error: "attachment not found" });
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", image.mimeType);
    response.setHeader("content-length", String(image.data.length));
    response.setHeader("cache-control", "private, max-age=3600");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.end(image.data);
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

  const terminalRoute = path.match(/^\/__hui\/sessions\/([^/]+)\/terminals(?:\/([^/]+))?(?:\/(connect))?$/u);
  if (terminalRoute) {
    try {
      const owner = terminalRoute[1]!;
      const id = terminalRoute[2];
      const session = (await readRegistry()).find((record) => record.id === owner);
      if (!session) throw new TerminalError("Conversation not found.", 404);
      if (request.method === "GET") {
        if (terminalRoute[3]) throw new TerminalError("Method not allowed.", 405);
        sendJson(response, 200, id ? terminals.read(owner, id) : { terminals: terminals.list(owner) });
      } else if (request.method === "POST") {
        if (terminalRoute[3] && id) {
          sendJson(response, 200, { url: terminalTicket(owner, id) });
        } else {
          let body: unknown;
          try { body = await readBody(request, 128 * 1024); } catch { throw new TerminalError("Invalid terminal request body."); }
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new TerminalError("Terminal request must be an object.");
          const params = body as Record<string, unknown>;
          sendJson(response, id ? 200 : 201, id
            ? terminals.tool(owner, { ...params, sessionId: id })
            : { terminal: terminals.create(owner, session.cwd, params) });
        }
      } else throw new TerminalError("Method not allowed.", 405);
    } catch (error) {
      sendJson(response, error instanceof TerminalError ? error.status : 500, { error: error instanceof Error ? error.message : "Terminal request failed." });
    }
    return;
  }

  // A browser pane's live view of its conversation's managed-browser tabs.
  const browserViewRoute = path.match(/^\/__hui\/sessions\/([^/]+)\/browser\/connect$/u);
  if (browserViewRoute) {
    try {
      if (request.method !== "POST") throw new BrowserToolError("Method not allowed.", 405);
      const owner = browserViewRoute[1]!;
      if (!(await readRegistry()).some((record) => record.id === owner)) throw new BrowserToolError("Conversation not found.", 404);
      sendJson(response, 200, { url: browserViewTicket(owner) });
    } catch (error) {
      sendJson(response, error instanceof BrowserToolError ? error.status : 500, { error: error instanceof Error ? error.message : "Browser view request failed." });
    }
    return;
  }

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

  if (path === `${PREFIX}update` || path === `${PREFIX}update/check`) {
    try {
      if (request.method === "GET" && path === `${PREFIX}update`) {
        sendJson(response, 200, await updates.status());
      } else if ((request.method === "GET" || request.method === "POST") && path === `${PREFIX}update/check`) {
        sendJson(response, 200, await updates.check(request.method === "GET"));
      } else if (request.method === "POST" && path === `${PREFIX}update`) {
        let body: { version?: unknown } | null;
        try { body = await readBody(request) as { version?: unknown } | null; }
        catch { sendJson(response, 400, { error: "Invalid update request body." }); return; }
        if (!body || typeof body.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(body.version) || Object.keys(body).some((key) => key !== "version")) {
          sendJson(response, 400, { error: "Provide only the stable version returned by the update check." });
        } else sendJson(response, 202, await updates.start(body.version));
      } else sendJson(response, 405, { error: "method not allowed" });
    } catch (error) {
      sendJson(response, error instanceof UpdateConflict ? 409 : 500, { error: error instanceof UpdateConflict ? error.message : "Update request failed. Check the gateway log and retry." });
    }
    return;
  }

  if (path === DIRECTORIES_ROUTE) {
    if (request.method === "GET") {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams.get("q") ?? "~/";
      sendJson(response, 200, { directories: await completeWorkingDirectories(query) });
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === LOCAL_PATHS_ROUTE) {
    if (request.method === "GET") {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      const input = query.get("q") ?? "";
      const cwd = query.get("cwd") ?? "~/";
      if (input.length > 4_096 || cwd.length > 4_096) {
        sendJson(response, 400, { error: "path query is too long" });
        return;
      }
      sendJson(response, 200, {
        paths: await completeLocalPaths(input, resolveWorkingDirectory(cwd)),
      });
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === GIT_CHECKOUT_ROUTE) {
    if (request.method === "GET") {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams.get("cwd") ?? "~/";
      sendJson(response, 200, { checkout: await inspectGitCheckout(resolveWorkingDirectory(query)) });
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === BROWSER_ROUTE) {
    try {
      if (request.method === "GET") {
        sendJson(response, 200, await browserStatus());
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "method not allowed" });
        return;
      }
      let body: unknown;
      try { body = await readBody(request); } catch { throw new BrowserToolError("Browser request body must be JSON."); }
      const action = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>)["action"] : undefined;
      if (action === "start") await managedBrowser.start();
      else if (action === "stop") await managedBrowser.stop();
      else throw new BrowserToolError("action must be start or stop.");
      sendJson(response, 200, await browserStatus());
    } catch (error) {
      sendJson(response, error instanceof BrowserToolError ? error.status : 500, {
        error: error instanceof Error ? error.message : "The browser request failed.",
      });
    }
    return;
  }

  const browserPreview = path.match(BROWSER_TAB_PREVIEW);
  if (browserPreview) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      const image = await managedBrowser.preview(browserPreview[1] ?? "");
      sendJson(response, 200, { image: `data:${image.mimeType};base64,${image.data}` });
    } catch (error) {
      sendJson(response, error instanceof BrowserToolError ? error.status : 500, {
        error: error instanceof Error ? error.message : "The tab could not be captured.",
      });
    }
    return;
  }

  if (path === SETTINGS_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, await readSettings());
      return;
    }
    if (request.method === "PUT") {
      sendJson(response, 200, await writeSettings(await readBody(request)));
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (
    path === PI_PACKAGE_INSTALL_ROUTE ||
    path === PI_PACKAGE_REMOVE_ROUTE ||
    path === PI_SKILL_INSTALL_ROUTE
  ) {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      const body = (await readBody(request)) as Record<string, unknown>;
      const result = path === PI_PACKAGE_INSTALL_ROUTE
        ? await piMutations.installPackage(typeof body["url"] === "string" ? body["url"] : "")
        : path === PI_PACKAGE_REMOVE_ROUTE
          ? await piMutations.removePackage(typeof body["source"] === "string" ? body["source"] : "")
          : await piMutations.installSkill(typeof body["url"] === "string" ? body["url"] : "");
      sendJson(response, 200, result);
    } catch (error) {
      const status = error instanceof PiMutationBusyError
        ? 409
        : error instanceof PiMutationInputError
          ? 400
          : error instanceof PiMutationCommandError
            ? 502
            : 500;
      sendJson(response, status, {
        error: error instanceof Error ? error.message : "PI operation failed.",
      });
    }
    return;
  }

  if (path === `${PREFIX}tools`) {
    if (request.method === "GET") sendJson(response, 200, await readToolsCatalog());
    else sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  const resourceRead = path.match(PI_RESOURCE_READ_ROUTE);
  if (resourceRead) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      sendJson(response, 200, await readPiResourceDocument(
        resourceRead[1] as "skill" | "plugin",
        resourceRead[2] ?? "",
      ));
    } catch (error) {
      sendJson(response, error instanceof PiResourceNotFoundError ? 404 : 500, {
        error: error instanceof Error ? error.message : "Could not read the resource.",
      });
    }
    return;
  }

  if (path === `${PREFIX}providers` || path.startsWith(`${PREFIX}providers/`)) {
    try {
      const parts = path.slice(`${PREFIX}providers`.length).split("/").filter(Boolean);
      const [id, action] = parts;
      if (!id && request.method === "GET") sendJson(response, 200, await providerService.snapshot());
      else if (id === "login" && action && parts.length === 2 && request.method === "DELETE") {
        providerService.cancel(action); sendJson(response, 200, { ok: true });
      } else if (id === "login" && action && parts.length === 2 && request.method === "POST") {
        const body = await readBody(request) as Record<string, unknown>;
        providerService.answer(action, body["promptId"], body["value"]); sendJson(response, 200, { ok: true });
      } else if (id && action === "login" && parts.length === 2 && request.method === "POST") {
        const body = await readBody(request) as Record<string, unknown>;
        sendJson(response, 200, await providerService.start(id, body["method"], { accountId: body["accountId"], name: body["name"] }));
      } else if (id && action === "accounts" && parts.length === 2 && request.method === "PUT") {
        const body = await readBody(request) as Record<string, unknown>;
        await providerService.reorder(id, body["order"]); sendJson(response, 200, { ok: true });
      } else if (id && action === "accounts" && parts[2] && parts.length === 3 && request.method === "DELETE") {
        await providerService.removeAccount(id, parts[2]); sendJson(response, 200, { ok: true });
      } else if (id && action === "accounts" && parts[2] && parts[3] === "quota" && parts.length === 4 && request.method === "GET") {
        sendJson(response, 200, await providerService.quota(id, parts[2]));
      } else if (id && action === "quota" && parts.length === 2 && request.method === "GET") {
        sendJson(response, 200, await providerService.quota(id));
      } else if (id && !action && request.method === "PUT") {
        const body = await readBody(request) as Record<string, unknown>;
        await providerService.save(id, body["models"]); sendJson(response, 200, { ok: true });
      } else if (id && !action && request.method === "DELETE") {
        await providerService.disconnect(id); sendJson(response, 200, { ok: true });
      } else sendJson(response, 405, { error: "method not allowed" });
    } catch (error) {
      sendJson(response, error instanceof ProviderInputError ? 400 : 500, {
        error: error instanceof ProviderInputError ? error.message : "Provider operation failed. Check the gateway and retry.",
      });
    }
    return;
  }

  // PI remains the writer: mutations above delegate to PI's own CLI or a
  // short-lived PI installer agent, then this route reports the refreshed view.
  if (path === PI_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, await readPiConfig());
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === POWER_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, { power: macPower?.status() ?? null });
      return;
    }
    if (request.method === "PUT") {
      const body = await readBody(request);
      const lidAwake = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["lidAwake"] : undefined;
      if (typeof lidAwake !== "boolean") {
        sendJson(response, 400, { error: "lidAwake must be a boolean" });
        return;
      }
      if (!macPower) {
        sendJson(response, 404, { error: "sleep prevention is only available on macOS" });
        return;
      }
      // Not awaited: turning it on waits on a macOS password dialog.
      void macPower.setLidAwake(lidAwake);
      sendJson(response, 200, { power: macPower.status() });
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === HEALTH_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, await readGatewayHealth());
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === WORKTREES_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, await worktreeService.inventory(await readRegistry()));
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === WORKTREES_REMOVE_ROUTE) {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    let removal: ReturnType<typeof parseWorktreeRemoval>;
    try {
      removal = parseWorktreeRemoval(await readBody(request));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid removal request." });
      return;
    }
    const results = await worktreeService.remove(await readRegistry(), removal.paths, removal.mode, removal.acknowledged);
    sendJson(response, 200, { results, inventory: await worktreeService.inventory(await readRegistry()) });
    return;
  }

  if (path === WORKSPACES_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, await readWorkspaceInspection());
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === UI_ERRORS_ROUTE) {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    let batch: ReturnType<typeof parseUiErrorBatch>;
    try {
      batch = parseUiErrorBatch(await readBody(request, UI_ERROR_BODY_LIMIT));
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid UI error report." });
      return;
    }
    sendJson(response, 202, uiErrorLog.record(batch));
    return;
  }

  if (path === OBSERVABILITY_ROUTE || path === DIAGNOSTICS_EXPORT_ROUTE) {
    if (request.method === "GET") {
      const snapshot = await readObservability(await readRegistry());
      if (path === DIAGNOSTICS_EXPORT_ROUTE) {
        response.setHeader("content-disposition", `attachment; filename="hui-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`);
      }
      sendJson(response, 200, snapshot);
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === AUTOMATION_ROUTE && request.method === "GET") {
    try {
      sendJson(response, 200, await automation.snapshot());
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Could not read automation state.",
      });
    }
    return;
  }

  if (path === AUTOMATION_TASKS_ROUTE && request.method === "POST") {
    try {
      const task = await automation.create(await readBody(request));
      sendJson(response, 201, { task, snapshot: await automation.snapshot() });
    } catch (error) {
      sendJson(response, automationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not create that task.",
      });
    }
    return;
  }

  const automationTask = path.match(AUTOMATION_TASK_ONE);
  if (automationTask && (request.method === "PUT" || request.method === "DELETE")) {
    const id = decodeURIComponent(automationTask[1] ?? "");
    try {
      if (request.method === "DELETE") await automation.remove(id);
      else await automation.update(id, await readBody(request));
      sendJson(response, 200, { snapshot: await automation.snapshot() });
    } catch (error) {
      sendJson(response, automationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not update that task.",
      });
    }
    return;
  }

  const automationRun = path.match(AUTOMATION_TASK_RUN);
  if (automationRun && request.method === "POST") {
    try {
      const run = await automation.run(decodeURIComponent(automationRun[1] ?? ""));
      sendJson(response, 202, { run });
    } catch (error) {
      sendJson(response, automationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not run that task.",
      });
    }
    return;
  }

  const automationCancel = path.match(AUTOMATION_RUN_CANCEL);
  if (automationCancel && request.method === "POST") {
    try {
      await automation.cancel(decodeURIComponent(automationCancel[1] ?? ""));
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, automationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not cancel that run.",
      });
    }
    return;
  }

  if (path === THEMES_ROUTE && request.method === "GET") {
    sendJson(response, 200, { themes: (await listThemes()).themes });
    return;
  }

  if (path === THEME_IMPORT_ROUTE && request.method === "POST") {
    const body = (await readBody(request)) as { url?: unknown };
    if (typeof body.url !== "string") {
      sendJson(response, 400, { error: "Expected a url." });
      return;
    }
    try {
      const id = await importTweakcnTheme(body.url);
      sendJson(response, 200, { id, themes: (await listThemes()).themes });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Import failed." });
    }
    return;
  }

  if (path === GITHUB_ROUTE) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    sendJson(response, 200, await githubCli.connection());
    return;
  }

  if (path === GITHUB_PREVIEWS_ROUTE) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const urls = new URL(request.url ?? "/", "http://localhost").searchParams.getAll("url");
    if (urls.length === 0 || urls.length > MAX_GITHUB_EMBEDS || urls.some((url) => url.length > 500 || !parseGitHubUrl(url))) {
      sendJson(response, 400, { error: `Pass 1-${MAX_GITHUB_EMBEDS} github.com repository, pull request or issue URLs.` });
      return;
    }
    sendJson(response, 200, { previews: await Promise.all(urls.map((url) => githubPreviews.lookup(url))) });
    return;
  }

  if (path === GITHUB_CONTRIBUTIONS_ROUTE) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const params = new URL(request.url ?? "/", "http://localhost").searchParams;
    const year = params.has("year") ? Number(params.get("year")) : undefined;
    if (year !== undefined && !(Number.isInteger(year) && year >= GITHUB_FIRST_YEAR && year <= latestYear())) {
      sendJson(response, 400, { error: `year must be ${GITHUB_FIRST_YEAR}-${latestYear()}.` });
      return;
    }
    try {
      sendJson(response, 200, await githubContributions.read(year, params.get("refresh") === "1"));
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error ? error.message : "GitHub activity could not be read." });
    }
    return;
  }

  if (path === GITHUB_LOGIN_ROUTE) {
    if (request.method !== "POST" && request.method !== "DELETE") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      const result = request.method === "POST" ? await githubCli.startLogin() : await githubCli.cancelLogin();
      if (result.status === "connected") githubPreviews.clearFailures();
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error instanceof GitHubCliError ? error.status : 500, { error: error instanceof Error ? error.message : "Could not sign in to GitHub." });
    }
    return;
  }

  if (path === JIRA_ROUTE) {
    await jiraConfigReady;
    if (request.method === "GET") {
      sendJson(response, 200, jiraConnectionView(jiraConfig));
      return;
    }
    if (request.method === "PUT") {
      try {
        const body = (await readBody(request)) as Record<string, unknown>;
        const site = normalizeJiraSite(body["site"]);
        const email = typeof body["email"] === "string" ? body["email"].trim() : "";
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/u.test(email)) throw new JiraInputError("Enter the email address of your Atlassian account.");
        const entered = typeof body["token"] === "string" ? body["token"].trim() : "";
        // An empty token keeps the stored one, but only for the same site and account.
        const token = entered || (jiraConfig && jiraConfig.site === site && jiraConfig.email === email ? jiraConfig.token : "");
        if (!token) throw new JiraInputError("Paste an Atlassian API token.");
        if (token.length > 1_000) throw new JiraInputError("That API token is too long.");
        const defaultProject = normalizeProjectKey(body["defaultProject"]);
        const client = new JiraClient({ site, email, token });
        const me = await client.myself();
        const next: JiraConfig = {
          site, email, token, defaultProject,
          ...(me.displayName ? { accountName: me.displayName } : {}),
          ...(me.accountId ? { accountId: me.accountId } : {}),
        };
        await jiraStore.write(next);
        if (jiraConfig?.site !== site || jiraConfig?.email !== email) jiraStatuses.clear();
        jiraConfig = next;
        sendJson(response, 200, jiraConnectionView(next));
      } catch (error) {
        sendJson(response, jiraErrorStatus(error), { error: error instanceof Error ? error.message : "Could not connect Jira." });
      }
      return;
    }
    if (request.method === "PATCH") {
      try {
        if (!jiraConfig) throw new JiraInputError("Connect Jira in Settings → Integrations first.");
        const body = (await readBody(request)) as Record<string, unknown>;
        const next = { ...jiraConfig, defaultProject: normalizeProjectKey(body["defaultProject"]) };
        await jiraStore.write(next);
        jiraConfig = next;
        sendJson(response, 200, jiraConnectionView(next));
      } catch (error) {
        sendJson(response, jiraErrorStatus(error), { error: error instanceof Error ? error.message : "Could not save the default project." });
      }
      return;
    }
    if (request.method === "DELETE") {
      await jiraStore.remove();
      jiraConfig = undefined;
      jiraStatuses.clear();
      sendJson(response, 200, jiraConnectionView(undefined));
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === JIRA_PROJECTS_ROUTE) {
    await jiraConfigReady;
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams.get("query") ?? "";
      if (query.length > 100) throw new JiraInputError("A project search must be at most 100 characters.");
      sendJson(response, 200, await jiraClient().projects(query));
    } catch (error) {
      sendJson(response, jiraErrorStatus(error), { error: error instanceof Error ? error.message : "Could not list Jira projects." });
    }
    return;
  }

  if (path === JIRA_ISSUES_ROUTE) {
    await jiraConfigReady;
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams.get("query") ?? "";
      if (query.length > 200) throw new JiraInputError("A work item search must be at most 200 characters.");
      const client = jiraClient();
      sendJson(response, 200, { issues: await findJiraIssues(client, jiraConfig!.site, query) });
    } catch (error) {
      sendJson(response, jiraErrorStatus(error), { error: error instanceof Error ? error.message : "Could not search Jira." });
    }
    return;
  }

  const jiraSession = path.match(SESSION_JIRA);
  if (jiraSession) {
    await jiraConfigReady;
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const id = decodeURIComponent(jiraSession[1] ?? "");
    const record = (await readRegistry()).find((session) => session.id === id);
    if (!record) {
      sendJson(response, 404, { error: `unknown session: ${id}` });
      return;
    }
    try {
      const body = (await readBody(request)) as Record<string, unknown>;
      const client = jiraClient();
      if (jiraSession[2] === "link") {
        const key = typeof body["key"] === "string" ? jiraKeyFromInput(body["key"]) : undefined;
        if (!key) throw new JiraInputError("Enter a Jira work item key such as CI-123.");
        // Confirm it exists and is visible before storing the reference.
        const details = await client.issue(key);
        const ref = { key, url: jiraIssueUrl(jiraConfig!.site, key) };
        const records = await updateRegistry((sessions) => sessions.map((session) => session.id === id
          ? { ...session, jiraIssues: mergeJiraRefs((session.jiraIssues ?? []).filter((item) => item.key !== key), [ref]) }
          : session));
        jiraStatuses.remember(ref, details);
        const next = records.find((session) => session.id === id);
        sendJson(response, 200, { issue: ref, ...(next ? { session: toView(next, liveSessions.status(id)) } : {}) });
        return;
      }
      if (jiraSession[2] === "draft") {
        const project = normalizeProjectKey(body["project"]) || jiraConfig!.defaultProject;
        if (!project) throw new JiraInputError("Choose a Jira project.");
        const { parents } = await parentCandidates(client, project);
        // A suggestion card is drafted from its own text, not the whole session.
        const suggestion = typeof body["suggestionId"] === "string" && body["suggestionId"]
          ? taskSuggestions.get(id, body["suggestionId"])
          : undefined;
        // A session is drafted from a goal-anchored digest, not a tail slice.
        const digest = suggestion ? undefined : sessionDigest(liveSessions.transcript(id));
        const draft = await draftJiraWorkItem({
          project,
          parents,
          title: suggestion?.title ?? record.title,
          cwd: record.cwd,
          context: suggestion ? taskSuggestionJiraDescription(suggestion) : digest?.text ?? "",
          ...(digest?.goal ? { goal: digest.goal } : {}),
          model: (await readSettings()).models.utility,
          run: runPiUtilityPrompt,
        });
        sendJson(response, 200, { draft });
        return;
      }
      const { ref, warning: assignWarning } = await createAssignedJiraIssue(client, body);
      // Filing a suggestion resolves its card; it may already have been dismissed.
      if (typeof body["suggestionId"] === "string" && body["suggestionId"]) {
        try { taskSuggestions.remove(id, body["suggestionId"]); } catch (error) { if (!(error instanceof TaskSuggestionNotFoundError)) throw error; }
      }
      const records = await updateRegistry((sessions) => sessions.map((session) => session.id === id
        ? { ...session, jiraIssues: mergeJiraRefs(session.jiraIssues ?? [], [ref]) }
        : session));
      const next = records.find((session) => session.id === id);
      sendJson(response, 200, {
        issue: ref,
        ...(next ? { session: toView(next, liveSessions.status(id)) } : {}),
        ...(assignWarning ? { warning: assignWarning } : {}),
      });
    } catch (error) {
      if (error instanceof TaskSuggestionNotFoundError) {
        sendJson(response, 404, { error: error.message });
        return;
      }
      sendJson(response, jiraErrorStatus(error), { error: error instanceof Error ? error.message : "Could not create the Jira work item." });
    }
    return;
  }

  if (path === SESSION_STATUSES_ROUTE) {
    if (request.method === "GET") {
      streamSessionStatuses(response);
    } else {
      sendJson(response, 405, { error: "method not allowed" });
    }
    return;
  }

  if (path === SESSION_GROUPS_ROUTE && request.method === "POST") {
    try {
      const body = (await readBody(request)) as Record<string, unknown>;
      await createSessionGroup(sessionGroupName(body));
      sendJson(response, 200, await sessionList.refresh());
    } catch (error) {
      sendJson(response, sessionMutationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not create that group.",
      });
    }
    return;
  }

  if (path === SESSION_GROUPS_ROUTE && request.method === "PUT") {
    try {
      const body = (await readBody(request)) as Record<string, unknown>;
      await reorderSessionGroups(sessionGroupOrder(body));
      sendJson(response, 200, await sessionList.refresh());
    } catch (error) {
      sendJson(response, sessionMutationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not reorder the groups.",
      });
    }
    return;
  }

  const groupOne = path.match(SESSION_GROUP_ONE);
  if (groupOne && (request.method === "PATCH" || request.method === "DELETE")) {
    const label = decodeURIComponent(groupOne[1] ?? "");
    try {
      if (request.method === "DELETE") {
        await deleteSessionGroup(label);
      } else {
        await updateSessionGroup(
          label,
          await sessionGroupPatch((await readBody(request)) as Record<string, unknown>),
        );
      }
      sendJson(response, 200, await sessionList.refresh());
    } catch (error) {
      sendJson(response, sessionMutationErrorStatus(error), {
        error: error instanceof Error ? error.message : "Could not update that group.",
      });
    }
    return;
  }

  if (path === SESSIONS_ROUTE) {
    if (request.method === "GET") {
      sendJson(response, 200, await sessionList.refresh());
      return;
    }
    if (request.method === "POST") {
      let body: Record<string, unknown>;
      try {
        // A worktree launch may carry its first prompt's attachments.
        body = (await readBody(request, MAX_PROMPT_BYTES)) as Record<string, unknown>;
      } catch (error) {
        sendJson(response, sessionMutationErrorStatus(error), {
          error: error instanceof Error ? error.message : "Could not read that session request.",
        });
        return;
      }
      if (body["worktree"] === true) {
        try {
          sendJson(response, 200, { session: await startWorktreeSession(body) });
        } catch (error) {
          sendJson(response, sessionMutationErrorStatus(error), {
            error: error instanceof Error ? error.message : "Could not start that session.",
          });
        }
        return;
      }
      try {
        const record = await createSession(body);
        sendJson(response, 200, { session: toView(record, liveSessions.status(record.id)) });
      } catch (error) {
        sendJson(response, sessionMutationErrorStatus(error), {
          error: error instanceof Error ? error.message : "Could not start that session.",
        });
      }
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (path === BACKLOG_ROUTE) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      const force = new URL(request.url ?? "/", "http://localhost").searchParams.get("refresh") === "1";
      sendJson(response, 200, await listBacklog(force));
    } catch (error) {
      sendJson(response, backlogErrorStatus(error), { error: error instanceof Error ? error.message : "Could not read the backlog." });
    }
    return;
  }

  const backlogItem = path.match(BACKLOG_ITEM);
  if (backlogItem) {
    const itemId = decodeURIComponent(backlogItem[1] ?? "");
    const action = backlogItem[2] ?? "";
    const [kind, key] = splitItemId(itemId);
    const allowed = action ? "POST" : request.method === "PATCH" || (request.method === "DELETE" && kind === "local") ? request.method : "";
    if (!kind || !key) {
      sendJson(response, 404, { error: "That item is no longer in the backlog." });
      return;
    }
    if (request.method !== allowed) {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    try {
      if (!action && request.method === "PATCH") {
        const body = (await readBody(request)) as Record<string, unknown>;
        // A Jira item must still be in the backlog; its metadata is keyed by it.
        await findBacklogItem(itemId);
        await backlogStore.setGroup(itemId, body["group"]);
        sendJson(response, 200, await listBacklog());
        return;
      }
      if (!action) {
        await backlogStore.removeTask(key);
        sendJson(response, 200, await listBacklog());
        return;
      }
      if (action === "start") {
        const body = (await readBody(request)) as Record<string, unknown>;
        const session = await startBacklogItem(itemId, body);
        sendJson(response, 200, { session, backlog: await listBacklog() });
        return;
      }
      if (action === "branch-name") {
        const body = (await readBody(request)) as Record<string, unknown>;
        const item = await findBacklogItem(itemId);
        const cwd = await existingDirectory(body["cwd"]);
        sendJson(response, 200, await suggestWorktreeName({ cwd, item, settings: await readSettings() }));
        return;
      }
      // Jira actions only apply to local tasks without a key yet.
      await jiraConfigReady;
      if (kind !== "local") throw new BacklogInputError("Only local tasks can be filed in or linked to Jira.");
      const task = (await backlogStore.read()).tasks.find((candidate) => candidate.id === key);
      if (!task) throw new BacklogNotFoundError("That task is no longer in the backlog.");
      if (task.jira) throw new BacklogInputError(`That task is already linked to ${task.jira.key}.`);
      const body = (await readBody(request)) as Record<string, unknown>;
      const client = jiraClient();
      if (action === "jira/draft") {
        const project = normalizeProjectKey(body["project"]) || jiraConfig!.defaultProject;
        if (!project) throw new JiraInputError("Choose a Jira project.");
        const { parents } = await parentCandidates(client, project);
        const draft = await draftJiraWorkItem({
          project,
          parents,
          title: task.title,
          cwd: task.cwd ?? CONFIG_DIR,
          context: taskSuggestionJiraDescription(task),
          model: (await readSettings()).models.utility,
          run: runPiUtilityPrompt,
        });
        sendJson(response, 200, { draft });
        return;
      }
      if (action === "jira/link") {
        const linkKey = typeof body["key"] === "string" ? jiraKeyFromInput(body["key"]) : undefined;
        if (!linkKey) throw new JiraInputError("Enter a Jira work item key such as CI-123.");
        const details = await client.issue(linkKey);
        const ref = { key: linkKey, url: jiraIssueUrl(jiraConfig!.site, linkKey) };
        await backlogStore.attachJira(key, ref);
        jiraStatuses.remember(ref, details);
        sendJson(response, 200, { issue: ref, backlog: await listBacklog() });
        return;
      }
      const { ref, warning } = await createAssignedJiraIssue(client, body);
      try {
        await backlogStore.attachJira(key, ref);
      } catch (error) {
        // The work item exists; report where it went instead of hiding it.
        throw new BacklogInputError(`${ref.key} was created but could not be attached to the task: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      backlogFeed.invalidate();
      sendJson(response, 200, { issue: ref, backlog: await listBacklog(), ...(warning ? { warning } : {}) });
    } catch (error) {
      sendJson(response, backlogErrorStatus(error), { error: error instanceof Error ? error.message : "Could not update the backlog." });
    }
    return;
  }

  const suggestionRoute = path.match(SESSION_SUGGESTION);
  if (suggestionRoute) {
    const starting = suggestionRoute[3] === "start";
    const saving = suggestionRoute[3] === "backlog";
    if (request.method !== (starting || saving ? "POST" : "DELETE")) {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const id = decodeURIComponent(suggestionRoute[1] ?? "");
    const suggestionId = decodeURIComponent(suggestionRoute[2] ?? "");
    const source = (await readRegistry()).find((session) => session.id === id);
    if (!source) {
      sendJson(response, 404, { error: `unknown session: ${id}` });
      return;
    }
    if (saving) {
      try {
        const task = await saveSuggestionToBacklog(id, suggestionId);
        sendJson(response, 200, { taskId: `local:${task.id}`, suggestions: taskSuggestions.list(id) });
      } catch (error) {
        sendJson(response, backlogErrorStatus(error), {
          error: error instanceof Error ? error.message : "Could not add that suggestion to the backlog.",
        });
      }
      return;
    }
    if (starting) {
      try {
        const body = (await readBody(request)) as Record<string, unknown>;
        const mode = body["mode"] ?? "session";
        if (typeof mode !== "string" || !TASK_SUGGESTION_START_MODES.includes(mode as TaskSuggestionStartMode)) {
          throw new TaskSuggestionInputError("mode must be session, worktree or current.");
        }
        const session = await startTaskSuggestion(source, suggestionId, mode as TaskSuggestionStartMode);
        sendJson(response, 200, { session, suggestions: taskSuggestions.list(id) });
      } catch (error) {
        sendJson(response, error instanceof TaskSuggestionNotFoundError ? 404 : error instanceof SessionBusyError ? 409 : sessionMutationErrorStatus(error), {
          error: error instanceof Error ? error.message : "Could not start that suggestion.",
        });
      }
      return;
    }
    try {
      taskSuggestions.remove(id, suggestionId);
      sendJson(response, 200, { suggestions: taskSuggestions.list(id) });
    } catch (error) {
      sendJson(response, error instanceof TaskSuggestionNotFoundError ? 404 : 400, {
        error: error instanceof Error ? error.message : "Could not dismiss that suggestion.",
      });
    }
    return;
  }

  const watcherRoute = path.match(SESSION_WATCHER);
  if (watcherRoute) {
    const verb = watcherRoute[3] ?? "";
    const method = verb === "log" ? "GET" : verb === "stop" || verb === "restart" ? "POST" : "DELETE";
    if (request.method !== method) {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const id = decodeURIComponent(watcherRoute[1] ?? "");
    const watcherId = decodeURIComponent(watcherRoute[2] ?? "");
    if (!(await readRegistry()).some((session) => session.id === id)) {
      sendJson(response, 404, { error: `unknown session: ${id}` });
      return;
    }
    try {
      if (verb === "log") {
        const requested = new URL(request.url ?? "/", "http://localhost").searchParams.get("lines");
        const lines = requested === null ? 100 : Number(requested);
        if (!Number.isInteger(lines) || lines < 1 || lines > WATCHER_LIMITS.logLines) {
          sendJson(response, 400, { error: `lines must be between 1 and ${WATCHER_LIMITS.logLines}` });
          return;
        }
        sendJson(response, 200, await watchers.log(id, watcherId, lines));
        return;
      }
      if (verb === "stop") await watchers.stop(id, watcherId);
      else if (verb === "restart") await watchers.restart(id, watcherId);
      else await watchers.remove(id, watcherId);
      sendJson(response, 200, { watchers: watchers.list(id) });
    } catch (error) {
      const status = error instanceof WatcherNotFoundError ? 404 : error instanceof WatcherConflictError ? 409 : 400;
      sendJson(response, status, {
        error: error instanceof Error ? error.message : "The watcher request failed.",
      });
    }
    return;
  }

  const one = path.match(SESSION_ONE);
  if (one && (request.method === "PATCH" || request.method === "DELETE")) {
    const id = decodeURIComponent(one[1] ?? "");

    const pending = pendingSessions.get(id);
    if (pending) {
      if (request.method === "DELETE" && pending.error) {
        pendingSessions.delete(id);
        sendJson(response, 200, { ok: true });
      } else {
        sendJson(response, 409, { error: pending.error ?? "The Git worktree is still being created." });
      }
      return;
    }

    if (request.method === "DELETE") {
      // Block stale opens first, but keep the runtime and streams alive until
      // registry removal commits. A storage failure rolls the tombstone back.
      try {
        await deleteSession(id);
      } catch (error) {
        sendJson(response, error instanceof SessionNotFoundError ? 404 : 500, {
          error: error instanceof Error ? error.message : "Could not remove that session.",
        });
        return;
      }
      // The conversation file under ~/.pi is pi's and is deliberately left
      // alone; losing a transcript because you tidied a list is unforgivable.
      sendJson(response, 200, { ok: true });
      return;
    }

    const body = (await readBody(request)) as Record<string, unknown>;
    try {
      const next = await updateSession(id, body);
      sendJson(response, 200, { session: toView(next, liveSessions.status(id)) });
    } catch (error) {
      sendJson(
        response,
        error instanceof SessionNotFoundError
          ? 404
          : error instanceof SessionRegistryError
            ? 500
            : 400,
        { error: error instanceof Error ? error.message : "Could not update that session." },
      );
    }
    return;
  }

  const action = path.match(SESSION_ACTION);
  if (action) {
    const id = decodeURIComponent(action[1] ?? "");
    const record = (await readRegistry()).find((session) => session.id === id);
    if (!record) {
      const pending = pendingSessions.get(id);
      sendJson(response, pending ? 409 : 404, {
        error: pending ? pending.error ?? "The Git worktree is still being created." : `unknown session: ${id}`,
      });
      return;
    }
    if (action[2] === "open" && request.method === "POST") {
      if (!liveSessions.ensure(record)) {
        sendJson(response, 404, { error: `unknown session: ${id}` });
        return;
      }
      const openedRecord = await liveSessions.markRead(id);
      sendJson(response, 200, {
        session: toView(openedRecord, liveSessions.status(id)),
        transcript: liveSessions.transcript(id),
        snapshot: liveSessions.snapshot(id),
      });
      return;
    }
    if (
      (action[2] === "prompt" || action[2] === "steer" || action[2] === "follow-up") &&
      request.method === "POST"
    ) {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(request, MAX_PROMPT_BYTES)) as Record<string, unknown>;
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid prompt body." });
        return;
      }
      const text = typeof body["text"] === "string" ? body["text"] : "";
      if (parseUpdateCommand(text)) {
        sendJson(response, 400, { error: "/update is a HUI command. Use the update dialog, not the model prompt or queue." });
        return;
      }
      if (parseClearCommand(text)) {
        sendJson(response, 400, { error: "/clear is a HUI command. Use the clear endpoint, not the model prompt or queue." });
        return;
      }
      if (parseReloadCommand(text)) {
        sendJson(response, 400, { error: "/reload is a HUI command. Use the reload endpoint, not the model prompt or queue." });
        return;
      }
      if (parseCompactCommand(text)) {
        sendJson(response, 400, { error: "/compact is a HUI command. Use the compact endpoint, not the model prompt or queue." });
        return;
      }
      let prepared: PreparedAttachments | undefined;
      try {
        prepared = await readAttachments(id, body["attachments"]);
        const attachments = prepared.attachments;
        // An image on its own is a valid prompt; a file on its own is not,
        // because the agent needs to be told what to do with it.
        if (!text.trim() && !attachments.some((item) => item.kind === "image")) {
          throw new AttachmentInputError("A prompt is required.");
        }
        if (!liveSessions.ensure(record)) {
          sendJson(response, 404, { error: `unknown session: ${id}` });
          await prepared.cleanupRejected();
          return;
        }
        if (action[2] === "prompt") await liveSessions.prompt(id, text, attachments);
        else if (action[2] === "steer") await liveSessions.steer(id, text, attachments);
        else await liveSessions.followUp(id, text, attachments);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        await prepared?.cleanupRejected();
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "pi refused the message.",
        });
      }
      return;
    }
    if (action[2] === "continue" && request.method === "POST") {
      try {
        if (!liveSessions.ensure(record)) {
          sendJson(response, 404, { error: `unknown session: ${id}` });
          return;
        }
        await liveSessions.continueInterrupted(id);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "Could not continue that run.",
        });
      }
      return;
    }
    if (action[2] === "clear" && request.method === "POST") {
      try {
        if (!liveSessions.ensure(record)) {
          sendJson(response, 404, { error: `unknown session: ${id}` });
          return;
        }
        const snapshot = await liveSessions.clear(id);
        sendJson(response, 200, { snapshot });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : error instanceof SessionRegistryError ? 500 : 400, {
          error: error instanceof Error ? error.message : "Could not clear that session.",
        });
      }
      return;
    }
    if (action[2] === "compact" && request.method === "POST") {
      try {
        if (!liveSessions.ensure(record)) {
          sendJson(response, 404, { error: `unknown session: ${id}` });
          return;
        }
        const body = (await readBody(request)) as Record<string, unknown> | null;
        const raw = body?.["instructions"];
        if (raw !== undefined && typeof raw !== "string") throw new Error("Compaction focus must be text.");
        const instructions = raw?.trim();
        if (instructions && instructions.length > 2_000) throw new Error("Keep the compaction focus under 2,000 characters.");
        await liveSessions.compact(id, instructions || undefined);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "Could not compact that session.",
        });
      }
      return;
    }
    if (action[2] === "reload" && request.method === "POST") {
      try {
        if (!liveSessions.ensure(record)) {
          sendJson(response, 404, { error: `unknown session: ${id}` });
          return;
        }
        await liveSessions.reload(id);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "Could not reload that session.",
        });
      }
      return;
    }
    if (action[2] === "btw" && request.method === "POST") {
      try {
        const body = (await readBody(request, MAX_PROMPT_BYTES)) as Record<string, unknown>;
        const question = typeof body["question"] === "string" ? body["question"].trim() : "";
        if (!question) throw new Error("A side question is required.");
        const result = await answerSideQuestion({
          cwd: record.cwd,
          question,
          transcript: liveSessions.transcript(id),
          settings: await readSettings(),
        });
        sendJson(response, 200, { question, ...result });
      } catch (error) {
        sendJson(response, 502, {
          error: error instanceof Error ? error.message : "The side question failed.",
        });
      }
      return;
    }
    if (action[2] === "queue" && request.method === "POST") {
      try {
        const body = (await readBody(request, MAX_PROMPT_BYTES)) as Record<string, unknown>;
        const itemId = typeof body["itemId"] === "string" ? body["itemId"] : "";
        if (!itemId) throw new Error("A queued message id is required.");
        if (body["operation"] === "edit") {
          const text = typeof body["text"] === "string" ? body["text"].trim() : "";
          if (!text) throw new Error("A queued message cannot be empty.");
          liveSessions.editFollowUp(id, itemId, text);
        } else if (body["operation"] === "remove") {
          liveSessions.removeFollowUp(id, itemId);
        } else if (body["operation"] === "move") {
          if (!Number.isInteger(body["toIndex"])) throw new Error("A queue position is required.");
          liveSessions.moveFollowUp(id, itemId, Number(body["toIndex"]));
        } else if (body["operation"] === "steer") {
          await liveSessions.steerFollowUp(id, itemId);
        } else {
          throw new Error("Unknown queue operation.");
        }
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "Could not update the queue.",
        });
      }
      return;
    }
    if (action[2] === "tools" && request.method === "GET") {
      try {
        sendJson(response, 200, await liveSessions.inspect(id));
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : "Runtime inspection failed." });
      }
      return;
    }
    if ((action[2] === "models" || action[2] === "commands") && request.method === "GET") {
      try {
        if (!liveSessions.ensure(record)) {
          sendJson(response, 404, { error: `unknown session: ${id}` });
          return;
        }
        sendJson(response, 200, action[2] === "commands"
          ? { commands: await liveSessions.commands(id) }
          : { models: await liveSessions.models(id) });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : `The runtime could not list its ${action[2]}.`,
        });
      }
      return;
    }
    if (action[2] === "model" && request.method === "POST") {
      const body = (await readBody(request)) as Record<string, unknown>;
      const provider = typeof body["provider"] === "string" ? body["provider"] : "";
      const modelId = typeof body["modelId"] === "string" ? body["modelId"] : "";
      if (!modelId) {
        sendJson(response, 400, { error: "A model id is required." });
        return;
      }
      try {
        const model = await liveSessions.setModel(id, provider, modelId);
        sendJson(response, 200, { model: model ?? null });
      } catch (error) {
        sendJson(
          response,
          error instanceof SessionBusyError ? 409 : sessionMutationErrorStatus(error),
          {
            error: error instanceof Error ? error.message : "pi refused that model.",
          },
        );
      }
      return;
    }
    if (action[2] === "abort" && request.method === "POST") {
      try {
        await liveSessions.abort(id);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "pi refused to stop.",
        });
      }
      return;
    }
    if (action[2] === "rewind" && request.method === "POST") {
      try {
        const body = (await readBody(request)) as Record<string, unknown>;
        const entryId = typeof body["entryId"] === "string" ? body["entryId"].trim() : "";
        const userFromEnd = body["userFromEnd"];
        const excludeUserMessage = body["excludeUserMessage"] === true;
        const target = entryId || (Number.isSafeInteger(userFromEnd) && (userFromEnd as number) >= 0 ? { userFromEnd: userFromEnd as number } : undefined);
        if (!target) throw new Error("A rewind point is required.");
        await liveSessions.rewind(id, target, { excludeUserMessage });
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "PI could not rewind that session.",
        });
      }
      return;
    }
    if (action[2] === "resume" && request.method === "POST") {
      try {
        await liveSessions.continueRun(id);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "PI could not continue that session.",
        });
      }
      return;
    }
    if (action[2] === "thinking" && request.method === "GET") {
      sendJson(response, 200, { level: liveSessions.currentThinking(id) ?? null });
      return;
    }
    if (action[2] === "thinking" && request.method === "POST") {
      const body = (await readBody(request)) as Record<string, unknown>;
      const level = typeof body["level"] === "string" ? body["level"].trim() : "";
      if (!new Set(["off", "minimal", "low", "medium", "high", "xhigh"]).has(level)) {
        sendJson(response, 400, { error: "Unknown thinking level." });
        return;
      }
      try {
        await liveSessions.setThinking(id, level);
        sendJson(response, 200, { level: liveSessions.currentThinking(id) ?? level });
      } catch (error) {
        sendJson(
          response,
          error instanceof SessionBusyError ? 409 : sessionMutationErrorStatus(error),
          {
            error: error instanceof Error ? error.message : "pi refused that thinking level.",
          },
        );
      }
      return;
    }
    if (action[2] === "question" && request.method === "POST") {
      const body = (await readBody(request)) as Record<string, unknown>;
      const questionId = typeof body["id"] === "string" ? body["id"].trim() : "";
      if (!questionId) {
        sendJson(response, 400, { error: "A question id is required." });
        return;
      }
      try {
        if (body["cancelled"] === true) {
          await liveSessions.cancelQuestion(id, questionId);
        } else if (typeof body["value"] === "string") {
          await liveSessions.respondQuestion(id, questionId, { value: body["value"] });
        } else if (typeof body["confirmed"] === "boolean") {
          await liveSessions.respondQuestion(id, questionId, { confirmed: body["confirmed"] });
        } else {
          sendJson(response, 400, { error: "A question response or cancellation is required." });
          return;
        }
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, error instanceof SessionBusyError ? 409 : 400, {
          error: error instanceof Error ? error.message : "pi refused that question response.",
        });
      }
      return;
    }
    if (action[2] === "events" && request.method === "GET") {
      streamSession(response, record);
      return;
    }
    if (action[2] === "connect" && request.method === "POST") {
      const url = sessionStreamTicket(id);
      sendJson(response, url ? 200 : 429, url ? { url } : { error: "Too many pending session connections." });
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

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

export async function startBackend(): Promise<void> {
  // Warnings, errors and lifecycle events also go to stderr: the managed
  // gateway appends it to gateway.log and a development server prints it.
  mirrorDiagnosticLogs((line) => process.stderr.write(line));
  await ensureConfigDir();
  void macPower?.start((await readSettings()).power.keepAwake);
  await automation.start();
  initializeWatchers();
  initializeSubagents();
  recoverInterruptedSessions(await readRegistry());
  // Auto-star the HUI repo when GitHub is connected.
  void githubCli.starHuiRepo().catch(() => {}); // best-effort, non-blocking
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

export function stopBackend(): void {
  macPower?.dispose();
  managedBrowser.dispose();
  terminals.dispose();
  githubCli.dispose();
  automation.dispose();
  subagents.dispose();
  watchers.dispose();
  stopAgentToolBridge();
  liveSessions.disposeAll();
}

/** Upgrade handlers for browser panes and session views; the gateway and Vite
 * servers attach them next to terminals. */
export function attachLiveStreams(server: EventEmitter, allowedHosts?: ReadonlySet<string>): () => void {
  const detachBrowser = attachBrowserTransport(server, managedBrowser, allowedHosts);
  const detachSessions = attachSessionTransport(server, async (id, send) => {
    const record = (await readRegistry()).find((session) => session.id === id);
    return record && liveSessions.ensure(record) ? watchSessionEvents(id, send) : undefined;
  }, allowedHosts);
  return () => { detachBrowser(); detachSessions(); };
}

export function huiConfig(): Plugin {
  return {
    name: "hui-config",
    configureServer(server) {
      void startBackend();
      if (server.httpServer) {
        const detach = attachTerminalTransport(server.httpServer);
        const detachStreams = attachLiveStreams(server.httpServer);
        server.httpServer.once("close", () => { detach(); detachStreams(); });
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
    closeBundle() {
      stopBackend();
    },
  };
}
