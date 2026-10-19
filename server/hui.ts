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
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { homedir, hostname, userInfo } from "node:os";

import type { Connect, Plugin } from "vite";
import { workers } from "./workers.ts";
import { createWorkerRoutes, WORKERS_ROUTE } from "./routes/workers.ts";
import { BOT_CLEANUP_FILE, BOTS_DIR, BotInputError, BotRegistry } from "./bots.ts";
import { BotService } from "./bot-service.ts";
import { remoteBots } from "./bot-remote.ts";
import { BOT_MEMORY_PAGE, BOTS_EVENTS_ROUTE, BOTS_ROUTE, createBotRoutes } from "./routes/bots.ts";
import { BOT_TRIGGERS_ROUTE } from "./routes/bot-triggers.ts";
import { createGatewayTriggers } from "./bot-triggers-gateway.ts";
import { isHookPath } from "./bot-triggers-listener.ts";
import { accountFullName, BotExportService } from "./bot-export.ts";
import { nameFromUsername } from "./bot-templates/cleanup.ts";
import { BotTemplateService } from "./bot-template-import.ts";
import { createBotTemplateRoutes } from "./routes/bot-templates.ts";
import { CLIENT_HEADER, readBody, responseFailures, routeRequest, sendFile, sendJson, type RouteResult } from "./http/route.ts";
import { HEARTBEAT_MS, watchSessionEvents, writeEvent } from "./http/events.ts";
import { fetchGrokBotPage } from "./bot-templates/fetch.ts";
import { localBotSkills } from "./bot-skills.ts";
import { durableBotConversations } from "./bot-conversations.ts";
import { CallBroker, providerCallAccounts } from "./calls.ts";
import { CALLS_ROUTE, createCallRoutes } from "./routes/calls.ts";
import { buildCallRecord, callCompletion, callSettings, createCallDelegate, reportCall } from "./call-helper.ts";
import { optChatBotMemory } from "./bot-memory.ts";
import { botHome, localBotSouls, operatorName as soulOperatorName } from "./bot-souls.ts";
import { BOTS_OFF_MESSAGE, type BotReply, type BotsUpdate, type BotView } from "../shared/bots.ts";
import { PullRequestStatuses } from "./pull-requests.ts";


import { botsOn, readHuiSettings, writeHuiSettings } from "./hui-settings.ts";
import { CONFIG_DIR, AUTOMATION_FILE, BROWSER_PROFILE_DIR, VSCODE_DIR, VSCODE_SERVER_DIR, WATCHERS_FILE, WATCHER_LOG_DIR } from "./paths.ts";
import { VscodeService } from "./vscode.ts";
import { VscodeInstaller } from "./vscode-install.ts";
import { verifyVscodeServer } from "./vscode-providers.ts";
import { attachVscodeTransport, isVscodeProxyPath, proxyVscodeHttp, serveVscodeEnter } from "./vscode-proxy.ts";
import { VSCODE_ENTER_PATH } from "../shared/vscode.ts";
import { BrowserToolError, ManagedBrowser } from "./browser/manager.ts";
import { MacPower } from "./power.ts";
import { attachBrowserTransport } from "./browser-transport.ts";
import type { EventEmitter } from "node:events";
import type { BrowserStatus } from "../shared/browser.ts";
import { botsEnabled, type Settings } from "../src/lib/settings.ts";
import { ProviderService } from "./providers.ts";
import { invalidateModelCatalog } from "./pi-config.ts";
import { PiMutationService } from "./pi-mutations.ts";
import { WorktreeService } from "./worktree-inventory.ts";
import { liveSessions, SessionBusyError } from "./live-sessions.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import {
  AutomationService,
  automationStoreFailure,
  executeAutomationTask,
} from "./automation.ts";
import { BotRoutines } from "./bot-routines.ts";
import { ROUTINES_TOOL } from "./runtimes/durable-bot-routines.ts";
import { existingDirectory, resolveWorkingDirectory } from "./working-directories.ts";
import { diagnosticPath, mirrorDiagnosticLogs, readObservability, recordDiagnosticEvent } from "./observability.ts";
import { durableHost } from "./runtimes/durable-host.ts";
import { createDurableBots } from "./runtimes/durable-bot-access.ts";
import { suggestWorktreeName } from "./model-routing.ts";
import { runPiUtilityPrompt } from "./runtimes/pi.ts";
import type { SessionJiraIssue } from "../shared/jira.ts";
import {
  draftJiraWorkItem,
  JiraClient,
  jiraKeyFromInput,
  JiraConfigStore,
  JiraInputError,
  jiraIssuesFromTranscript,
  JiraIssueStatuses,
  jiraIssueUrl,
  JiraRequestError,
  mergeJiraRefs,
  normalizeProjectKey,
  parentCandidates,
  validateCreateInput,
  type JiraConfig,
} from "./jira.ts";
import {
  registerAgentToolHandler,
  stopAgentToolBridge,
} from "./agent-tools-bridge.ts";
import { SubagentService } from "./subagents.ts";
import { presentMediaForSession, servePresentedMedia } from "./presented-media.ts";
import { serveWidgetSandbox } from "./widget-sandbox.ts";
import { WIDGET_SANDBOX_PATH } from "../shared/widgets.ts";
import { GitHubCli } from "./github.ts";
import { GitHubContributionsReader } from "./github-contributions.ts";
import { GitHubPreviews, ghGraphQL, previewPullRequestFetcher } from "./github-previews.ts";
import { DatadogOrgs } from "./datadog.ts";
import { DatadogPreviews } from "./datadog-previews.ts";
import { TaskSuggestionInputError, TaskSuggestionNotFoundError, TaskSuggestionStore } from "./task-suggestions.ts";
import { WatcherConflictError, WatcherInputError, WatcherNotFoundError, WatcherService } from "./watchers.ts";
import { SecretFiles, SecretRequests } from "./secret-requests.ts";
import { Questionnaires } from "./questionnaires.ts";
import {
  BacklogInputError,
  BacklogJiraFeed,
  BacklogNotFoundError,
  BacklogStore,
  BacklogStoreError,
  createBacklogLifecycle,
  splitItemId,
} from "./backlog.ts";
import { TASK_SUGGESTION_START_MODES, taskSuggestionJiraDescription, type TaskSuggestionStartMode } from "../shared/task-suggestions.ts";
import { WATCHER_LIMITS } from "../shared/watchers.ts";
import { terminals, TerminalError } from "./terminals.ts";
import { attachSessionTransport } from "./session-transport.ts";
import { createSessionListHub } from "./session-list.ts";
import { attachTerminalTransport } from "./terminal-transport.ts";
import { createFileRoutes, FILES_ROUTE } from "./routes/files.ts";
import { createDiffRoutes, DIFF_ROUTE } from "./routes/diff.ts";
import { ATTACHMENT_ROUTE, createAttachmentRoutes } from "./routes/attachments.ts";
import { createThemeRoutes, THEMES_ROUTE } from "./routes/themes.ts";
import { createLocalPathRoutes } from "./routes/local-paths.ts";
import { createAutomationRoutes, AUTOMATION_ROUTE } from "./routes/automation.ts";
import { createPiRoutes } from "./routes/pi.ts";
import { createPowerRoutes } from "./routes/power.ts";
import { handleApiSchemaRoute } from "./routes/api-schema.ts";
import { createProviderRoutes } from "./routes/providers.ts";
import { createUpdateRoutes } from "./routes/updates.ts";
import { createWorktreeRoutes } from "./routes/worktrees.ts";
import { createSettingsRoutes } from "./routes/settings.ts";
import { createTerminalRoutes } from "./routes/terminals.ts";
import { createBrowserRoutes } from "./routes/browser.ts";
import { createVscodeRoutes } from "./routes/vscode.ts";
import { createGitHubRoutes } from "./routes/github.ts";
import { createDatadogRoutes } from "./routes/datadog.ts";
import { createJiraRoutes } from "./routes/jira.ts";
import { createSessionRoutes, sessionMutationErrorStatus } from "./routes/sessions.ts";
import { createSessionActionRoutes } from "./routes/session-actions.ts";
import { createDiagnosticsRoutes, DIAGNOSTICS_EXPORT_ROUTE, HEALTH_ROUTE, OBSERVABILITY_ROUTE, UI_ERRORS_ROUTE } from "./routes/diagnostics.ts";
import { ensureConfigDir, listThemes, THEME_FILE_ROUTE } from "./themes.ts";
import { AttachmentInputError, readAttachments } from "./sessions/attachments.ts";
import {
  readRegistry,
  SessionNotFoundError,
  SessionRegistryError,
  updateRegistry,
  type SessionRecord,
} from "./sessions.ts";
import {
  createSessionLifecycle,
  defaultSessionTool,
  SESSION_TITLE_MAX,
} from "./sessions/lifecycle.ts";
import { setAgentStage } from "./sessions/stages.ts";
import { createSessionViews, pendingSessions, pendingStatus, pendingStatusSubscribers, type PendingStatusUpdate } from "./sessions/views.ts";

const PREFIX = "/__hui/";
const SESSIONS_ROUTE = `${PREFIX}sessions`;
const SESSION_STATUSES_ROUTE = `${SESSIONS_ROUTE}/events`;
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
const PRESENTED_MEDIA_ROUTE = /^\/__hui\/media\/([0-9a-f-]+)\/([^/]+)$/u;

const piMutations = new PiMutationService();
const piRoutes = createPiRoutes({ piMutations });
const workerRoutes = createWorkerRoutes({ service: workers, readRegistry });
const localPathRoutes = createLocalPathRoutes({ workers });
const terminalRoutes = createTerminalRoutes({ readRegistry });
const fileRoutes = createFileRoutes({ session: async (id) => (await readRegistry()).find((record) => record.id === id) });
const diffRoutes = createDiffRoutes({ session: async (id) => (await readRegistry()).find((record) => record.id === id) });
const themeRoutes = createThemeRoutes();
const updateRoutes = createUpdateRoutes();
const settingsRoutes = createSettingsRoutes({ writeSettings });
const diagnosticsRoutes = createDiagnosticsRoutes({
  observability: async () => readObservability(await readRegistry(), async (conversationId) => durableHost().conversationUsage(conversationId as never)),
});
const attachmentRoutes = createAttachmentRoutes({ session: async (id) => (await readRegistry()).find((record) => record.id === id), liveSessions });
// Sessions a lost connection interrupted reattach once their worker is back,
// and stop showing a reconnect once HUI no longer tries.
function forWorkerSessions(workerId: string, act: (record: SessionRecord) => void): void {
  void readRegistry().then((records) => {
    for (const record of records) if (record.worker === workerId && liveSessions.isLive(record.id)) act(record);
  }).catch(() => undefined);
}
workers.onConnected((workerId) => forWorkerSessions(workerId, (record) => liveSessions.ensure(record, true)));
workers.onStopped((workerId) => forWorkerSessions(workerId, (record) => liveSessions.stopReconnecting(record.id)));
durableHost().storeFailed = async () => reattachAfterStoreFailure(await readRegistry());
/** Bots (HUI-18): their registry, and the service that runs each one's forever chat as an ordinary Durable session
 * whose memory is OptChat's (docs/optchat.md). */
const botMemory = optChatBotMemory(durableHost());
const botRegistry = new BotRegistry(undefined, (count) => recordDiagnosticEvent({
  area: "session", level: "warning", action: "bots_invalid_records",
  summary: `bots.json holds ${count} invalid bot record${count === 1 ? "" : "s"}; HUI keeps them in the file but does not show them.`,
}));
/** The Durable side of bots' chats here, and their remote workers' half: the bot service's, and what a bot import
 * checks a new bot against. */
const botConversations = durableBotConversations(durableHost(), botMemory, { primaryModel: async () => (await readHuiSettings()).models.primary || undefined });
const botWorkers = remoteBots(workers, {
  cleanupFile: BOT_CLEANUP_FILE,
  report: (action, summary, error) => recordDiagnosticEvent({
    area: "session", level: "warning", action, summary, detail: error instanceof Error ? error.message : String(error),
  }),
});
const sessionViews = createSessionViews({
  bots: () => bots,
  botRegistry,
  pullRequestStatuses: () => pullRequestStatuses,
  jiraIssues: sessionJiraIssues,
  watchers: () => watchers,
});
const { toView, listSessionViews } = sessionViews;
const { createSession, forkRequest, forkFromSession, startWorktreeSession, waitForSessionReady, deleteSession, updateSession } = createSessionLifecycle({
  views: sessionViews,
  readAttachments,
  subagents: () => subagents,
  taskSuggestions: () => taskSuggestions,
  watchers: () => watchers,
  managedBrowser: () => managedBrowser,
});
const bots = new BotService({
  registry: botRegistry,
  sessions: liveSessions,
  readSessions: readRegistry,
  updateSessions: updateRegistry,
  createSession: (body, bot) => createSession(body, liveSessions, updateRegistry, undefined, { bot }),
  removeSession: (id) => deleteSession(id),
  // A bot without a model of its own starts on Settings' primary model, as a new session does.
  conversations: botConversations,
  memory: botMemory,
  // A bot made on a worker keeps its conversation, memory and SOUL.md there, where its chat runs; what deleting one
  // leaves there while it is offline waits in BOT_CLEANUP_FILE for its next connection.
  workers: botWorkers,
  souls: localBotSouls(),
  routines: {
    // A broken automation store is a storage failure (500), not the caller's.
    tasks: async () => (await automation.snapshot().catch(automationStoreFailure)).tasks,
    disable: async (task) => {
      await automation.update(task.id, {
        name: task.name, description: task.description, sessionId: task.sessionId, prompt: task.prompt,
        schedule: task.schedule, enabled: false, timeoutSeconds: task.timeoutSeconds,
      }).catch(automationStoreFailure);
    },
    remove: async (task) => {
      await automation.remove(task.id).catch(automationStoreFailure);
    },
  },
  // Bots are a preview: off (Settings → Labs → Bots), nothing starts a bot's turn, and a chat that starts one anyway
  // (Durable resuming an interrupted run, a worker reattaching) goes quiet again.
  active: botsOn,
  statuses: liveSessions,
  report: (event) => recordDiagnosticEvent({ area: "session", ...event }),
});
/** Open `GET /__hui/bots/events` streams, ended as bots are turned off so every screen hears it. */
const botStreams = new Set<ServerResponse>();
const botRoutes = createBotRoutes({
  service: bots,
  readAttachments: async (sessionId, raw) => {
    try {
      return await readAttachments(sessionId, raw);
    } catch (error) {
      throw error instanceof AttachmentInputError ? new BotInputError(error.message) : error;
    }
  },
});
/** Bots imported from other platforms' templates (`bot-template-import.ts`), and exported as templates reviewed for
 * personal information (`bot-export.ts`): under `/__hui/bots`, so Labs → Bots gates them too. */
const localSkills = localBotSkills();
// What a new bot would be offered: the tools every chat has and the skills of a new home folder, here or there.
const newBotOffer = (worker?: string) => worker ? botWorkers.conversations(worker).offer(undefined, undefined, randomUUID()) : botConversations.offer(undefined, BOTS_DIR);
const botSkillFiles = (worker?: string) => worker ? (botWorkers.keepsSkills(worker) ? botWorkers.skills(worker) : undefined) : localSkills;
const botTemplateRoutes = createBotTemplateRoutes({
  service: new BotTemplateService({
    bots,
    offer: newBotOffer,
    models: async () => {
      const host = durableHost();
      await host.open();
      await host.refreshModels();
      return (await host.models.getAvailable()).map((model) => ({ provider: model.provider, id: model.id }));
    },
    routines: { tasks: async () => (await automation.snapshot()).tasks, create: (input) => automation.create(input) },
    triggers: { create: (botId, input) => triggers.service.create(botId, input) },
    skills: botSkillFiles,
    findWorker: (target) => botWorkers.find(target),
    operator: async () => soulOperatorName((await readHuiSettings()).profileName),
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    fetchPage: (url) => fetchGrokBotPage(url),
    skillsWritten: (cwd) => durableHost().prompt.reload(cwd),
    report: (event) => recordDiagnosticEvent({ area: "session", ...event }),
  }),
  exports: new BotExportService({
    bots,
    offer: newBotOffer,
    routines: { tasks: async () => (await automation.snapshot()).tasks },
    triggers: { list: async (botId) => (await triggers.service.list(botId)).triggers },
    skills: botSkillFiles,
    utilityModel: async () => (await readHuiSettings()).models.utility || undefined,
    // A plain completion, as a call's helper makes: the reviewer has no tools, whatever the text it reads asks for.
    completion: (model, request) => callCompletion(model, request),
    identity: async (worker) => {
      const operator = soulOperatorName((await readHuiSettings()).profileName);
      const remote = await workers.list().catch(() => []);
      // A bot on a worker: that machine's home and host name are its owner's too.
      const there = remote.find((each) => each.id === worker)?.host;
      const username = userInfo().username;
      const fullName = await accountFullName(username);
      const names = [fullName, nameFromUsername(username, fullName)].filter((name): name is string => Boolean(name));
      return {
        ...(operator ? { operator } : {}), ...(names.length ? { names } : {}), username,
        homes: [homedir(), ...there ? [there.home] : []], hostnames: [hostname(), ...there ? [there.hostname] : []],
        workers: remote.map((each) => each.name),
      };
    },
  }),
});
// A bot's chat lists the other bots in its `bots` prompt section, and a session the bots it may tag while bots are on (a
// worker's host asks for those of its sessions and bots, and learns each bot's name with it), and a bot reads its
// SOUL.md (or has its first conversation) in its `soul` section, from its home folder in HUI's configuration; a worker's
// host reads the home folders it keeps itself.
durableHost().configureDurableBots(createDurableBots(durableHost(), {
  section: (botId) => bots.section(botId),
  souls: {
    home: (botId) => botHome(botId),
    operator: async () => soulOperatorName((await readHuiSettings()).profileName),
    // From the last registry read: a bot still called "New Bot" asks for a name first.
    name: (botId) => bots.identity(botId)?.name,
  },
  // A bot's chat that turns tools back on (the operator allowed a request there) updates the roster's copy of its lists.
  recorded: (botId, access) => bots.accessRecorded(botId, access),
}));
workers.serve("bot.section", async (workerId, params) => {
  const botId = typeof params["botId"] === "string" ? params["botId"] : undefined;
  const section = await bots.workerSection(workerId, botId);
  return { section: section ?? null, name: botId === undefined ? null : bots.identity(botId)?.name ?? null };
});
/** The bot list every Bots screen shares, recomputed while one listens, like the session list. */
const botList = createSessionListHub<BotView>(async () => [{ label: "bots", sessions: await bots.list({ archived: "all" }) }]);
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
  readSettings: async () => (await readHuiSettings()).browser,
});
/** One VS Code server per gateway for every VS Code view, started on the first open (`vscode.ts`). Nothing runs or
 * downloads before that; an openvscode-server install happens only when the operator asks for it. */
const vscode = new VscodeService({
  dir: VSCODE_DIR,
  settings: async () => (await readHuiSettings()).vscode,
  saveLicense: async (licenseAcceptedAt) => {
    const current = await readHuiSettings();
    await writeSettings({ ...current, vscode: { ...current.vscode, licenseAcceptedAt } });
  },
  installer: new VscodeInstaller({
    dir: VSCODE_SERVER_DIR,
    verify: verifyVscodeServer,
    nixos: existsSync("/etc/NIXOS"),
    // A mirror serving the same release files; the pinned checksums still decide what installs.
    ...(process.env["HUI_OPENVSCODE_SERVER_MIRROR"] ? { downloads: process.env["HUI_OPENVSCODE_SERVER_MIRROR"] } : {}),
  }),
});
const browserRoutes = createBrowserRoutes({ managedBrowser, browserStatus, readRegistry });
const vscodeRoutes = createVscodeRoutes({ vscode, readRegistry });
/** macOS sleep prevention lives and dies with this gateway process. */
const macPower = process.platform === "darwin" ? new MacPower() : undefined;
const powerRoutes = createPowerRoutes({ macPower });
liveSessions.setTaskSuggestionProvider((id) => taskSuggestions.list(id));
liveSessions.setWatcherProvider((id) => watchers.list(id));
const secretRequests = new SecretRequests({ onChange: (id) => liveSessions.notifySnapshot(id) });
const secretFiles = new SecretFiles();
const questionnaires = new Questionnaires({ onChange: (id) => liveSessions.notifySnapshot(id) });
liveSessions.setHuiQuestionProvider((id) => [...secretRequests.questions(id), ...questionnaires.questions(id)]);
// A stopped turn must not leave its pages running in the headless browser.
liveSessions.setAbortListener((id) => managedBrowser.closeOwner(id));
registerAgentToolHandler(async (invocation) => {
  // Behind the check where a bot's chat runs: HUI's own refusal of a tool the operator turned off in that chat.
  await bots.checkToolAllowed(invocation.callerSessionId, invocation.action);
  // A bot's chat, or any session while bots are on: the service decides who may tag whom.
  if (invocation.action === "message_bot") return bots.messageBot(invocation.callerSessionId, invocation.params);
  // A bot's gated tools judge its run by every input it took, as the host running the chat saw them (`runOrigins`).
  if (invocation.action === "set_profile") return bots.setProfile(invocation.callerSessionId, invocation.params, invocation.runOrigins);
  if (invocation.action === ROUTINES_TOOL) return botRoutines.handle(invocation.callerSessionId, invocation.params, invocation.runOrigins);
  if (invocation.action === "triggers") return triggers.service.tool(invocation.callerSessionId, invocation.params);
  if (invocation.action === "suggest_task" || invocation.action === "dismiss_task") {
    const caller = (await readRegistry()).find(({ id }) => id === invocation.callerSessionId);
    if (!caller) throw new TaskSuggestionInputError("Conversation no longer exists.");
    return taskSuggestions.tool(caller.id, invocation.action, invocation.params, caller.cwd, caller.worker);
  }
  if (invocation.action === "set_stage") {
    return setAgentStage(invocation.callerSessionId, invocation.params);
  }
  if (invocation.action === "secret_request") {
    const caller = (await readRegistry()).find(({ id }) => id === invocation.callerSessionId);
    if (!caller) throw new Error("Conversation no longer exists.");
    // The answer itself only goes back over the connection to the caller's
    // own worker, whose host writes the file where the session's commands run.
    if (caller.worker !== invocation.fromWorker) throw new Error("A secret request must come from the machine its session runs on.");
    const answer = await secretRequests.request(caller.id, invocation.params, invocation.signal);
    return invocation.fromWorker ? answer : secretFiles.deliver(answer);
  }
  if (invocation.action === "ask_user_question") {
    if (!(await readRegistry()).some(({ id }) => id === invocation.callerSessionId)) throw new Error("Conversation no longer exists.");
    const { timeoutMinutes } = (await readHuiSettings()).questions;
    return questionnaires.request(invocation.callerSessionId, invocation.params, invocation.signal, timeoutMinutes);
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
    : subagents.handle(invocation.callerSessionId, invocation.action, invocation.params, invocation.signal);
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

const providerService = new ProviderService(undefined, invalidateModelCatalog);
const providerRoutes = createProviderRoutes({ providerService });

/** GPT-Live calls with bots over the ChatGPT login (HUI-18): the credential stays here, audio goes browser ↔ ChatGPT.
 * A call's quick questions go to the bot's helper (its utility model); its record goes to the bot's chat at the end. */
const callBroker = new CallBroker({
  accounts: providerCallAccounts(providerService.accounts),
  report: ({ status, detail }) => recordDiagnosticEvent({
    area: "runtime", level: "warning", action: "call_refused", summary: `ChatGPT refused a GPT-Live call (${status})`, ...(detail ? { detail } : {}),
  }),
  // A call's record is one passive entry in the bot's chat (no turn runs for it), so it is written even when the call
  // ended because bots were turned off.
  onEnd: (call, endedAt) => void (async () => {
    const bot = await bots.resolve(call.botId);
    const record = await buildCallRecord({ bot, call, endedAt, settings: await callSettings(), completion: callCompletion, report: reportCall });
    if (record) await bots.recordCall(bot.id, record);
  })().catch((error: unknown) => reportCall("A call's record could not be written", error instanceof Error ? error.message : String(error))),
});
const callRoutes = createCallRoutes({
  broker: callBroker,
  bots,
  delegate: createCallDelegate({
    view: async (botId) => (await bots.callContext(botId)).view,
    soul: async (botId) => (await bots.soul(botId)) ?? undefined,
    facts: async (botId) => bots.facts(botId),
    settings: callSettings,
    completion: callCompletion,
    // Real work goes to the bot's own chat, as any message: a prompt, or a follow-up behind its running turn.
    handOff: async (botId, text) => await bots.send(botId, { text }, { timeoutMs: 600_000 }) as BotReply,
    report: reportCall,
  }),
  settings: () => readHuiSettings(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
});
const BOT_CALLS = /^\/__hui\/bots\/[^/]+\/calls(?:\/|$)/u;

async function writeSettings(raw: unknown): Promise<Settings> {
  const before = await readHuiSettings();
  const botsWereOn = botsEnabled(before);
  await ensureConfigDir();
  const settings = await writeHuiSettings(raw);
  // A changed browser mode or executable must not leave the old process running.
  await managedBrowser.applySettings(settings.browser);
  // Off withdraws every VS Code frame's access and stops the server; a new executable applies to the next start.
  await vscode.applySettings(settings.vscode);
  macPower?.setKeepAwake(settings.power.keepAwake);
  if (botsWereOn && !botsEnabled(settings)) quietBots();
  // Codemode, and while bots are on every session's message_bot, are offered per conversation.
  if (before.codemode.enabled !== settings.codemode.enabled || botsWereOn !== botsEnabled(settings)) await durableHost().applyTools();
  return settings;
}

/**
 * Bots were just turned off (Settings → Labs → Bots). Their routes already refuse, as each reads the setting; what
 * they were doing stops too: every bot goes quiet (queued messages withdrawn, a running turn stopped), calls end and
 * are recorded, and open bot streams end, so each screen learns it. Nothing is deleted: turning bots on again finds
 * them as they were.
 */
function quietBots(): void {
  for (const response of botStreams) response.end();
  const calls = callBroker.endAll();
  recordDiagnosticEvent({
    area: "session", level: "info", action: "bots_turned_off",
    summary: `Bots were turned off in Settings → Labs${calls ? `; ${calls} call${calls === 1 ? "" : "s"} ended` : ""}`,
  });
  void bots.quietAll().catch((error: unknown) => recordDiagnosticEvent({
    area: "session", level: "warning", action: "bots_off_stop_failed",
    summary: "Bots were turned off, but HUI could not read them all to stop their turns",
    detail: error instanceof Error ? error.message : String(error),
  }));
}

async function browserStatus(): Promise<BrowserStatus> {
  const titles = new Map((await readRegistry()).map((record) => [record.id, record.title]));
  return managedBrowser.status((id) => titles.get(id) ?? "");
}

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

/* ── GitHub ── status, device login and previews run through the operator's
 * `gh`; HUI never sees the token. `HUI_GITHUB_CLI` points E2E at a fake executable. */
const GH_COMMAND = process.env["HUI_GITHUB_CLI"] || "gh";
const githubCli = new GitHubCli({ command: GH_COMMAND });
/** Bots' triggers (HUI-18): what listeners the operator runs report, with the pull requests it links to read through the
 * same `gh`. */
const triggers = createGatewayTriggers({
  send: (botId, message) => bots.send(botId, message),
  listBots: () => botRegistry.list(),
  active: botsOn,
  ghCommand: GH_COMMAND,
  report: (event) => recordDiagnosticEvent({ area: "session", ...event }),
});
const githubPreviews = new GitHubPreviews(ghGraphQL(GH_COMMAND));
const githubContributions = new GitHubContributionsReader(GH_COMMAND);
const githubRoutes = createGitHubRoutes({ githubCli, githubPreviews, githubContributions, bots });

/* ── Datadog ── orgs, sign-in and previews run through the operator's `pup`; HUI never sees a token.
 * `HUI_PUP_CLI` points E2E at a fake executable. A sign-in or an org change drops cached previews. */
const datadogOrgs = new DatadogOrgs({ command: process.env["HUI_PUP_CLI"] || "pup", onChange: () => datadogPreviews.clear() });
const datadogPreviews = new DatadogPreviews(datadogOrgs);
const datadogRoutes = createDatadogRoutes({ datadogOrgs, datadogPreviews });
const pullRequestStatuses = new PullRequestStatuses(previewPullRequestFetcher(githubPreviews));

const worktreeService = new WorktreeService({
  isRunning: (id) => liveSessions.hasRuntime(id),
  stopSession: (id) => liveSessions.close(id),
});
const worktreeRoutes = createWorktreeRoutes({ worktreeService, readRegistry });

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

const jiraRoutes = createJiraRoutes({
  jiraStore,
  jiraConfig: () => jiraConfig,
  setJiraConfig: (config) => { jiraConfig = config; },
  jiraConfigReady,
  jiraStatuses,
  jiraClient,
  createAssignedJiraIssue,
  toView,
  taskSuggestions,
});

function sessionJiraIssues(record: SessionRecord, transcript: readonly TranscriptEntry[]): SessionJiraIssue[] {
  const refs = mergeJiraRefs(record.jiraIssues ?? [], jiraIssuesFromTranscript(transcript));
  const config = jiraConfig;
  const origin = config ? new URL(config.site).origin : "";
  const fetch = config ? (key: string) => new JiraClient(config).issue(key) : undefined;
  // Only work items on the connected site are looked up with its credentials.
  return refs.map((ref) => jiraStatuses.view(ref, origin && new URL(ref.url).origin === origin ? fetch : undefined));
}

const sessionList = createSessionListHub(listSessionViews);
const sessionRoutes = createSessionRoutes({
  sessionList,
  lifecycle: { createSession, startWorktreeSession, deleteSession, updateSession },
  views: sessionViews,
  bots,
  isDormantBotChat,
});
const sessionActionRoutes = createSessionActionRoutes({
  lifecycle: { updateSession, forkRequest, forkFromSession },
  views: sessionViews,
  bots,
  isDormantBotChat,
  subagents,
  secretRequests,
  questionnaires,
});

const automation = new AutomationService(AUTOMATION_FILE, (task, signal, context) => executeAutomationTask(task, signal, context, { liveSessions, bots, botsOn }));
const automationRoutes = createAutomationRoutes({ automation });
/** A bot's `routines` tool: its own chat's Automation tasks, behind its guards. */
const botRoutines = new BotRoutines({
  botForSession: (sessionId) => bots.botForSession(sessionId),
  readSessions: readRegistry,
  automation,
  active: botsOn,
});

/* ── backlog ── local tasks and HUI metadata in backlog.json; assigned To Do
 * Jira items are read live through a short cache. */
const backlogStore = new BacklogStore();
const backlogFeed = new BacklogJiraFeed();
const { startTaskSuggestion, saveSuggestionToBacklog, listBacklog, findBacklogItem, startBacklogItem } = createBacklogLifecycle({
  liveSessions,
  lifecycle: { createSession, waitForSessionReady },
  views: sessionViews,
  taskSuggestions,
  backlogStore,
  backlogFeed,
  jiraConfig: () => jiraConfig,
  jiraConfigReady,
  jiraClient,
  jiraStatuses,
  defaultSessionTool,
  SESSION_TITLE_MAX,
  SessionNotFoundError,
});

function backlogErrorStatus(error: unknown): number {
  if (error instanceof BacklogNotFoundError || error instanceof TaskSuggestionNotFoundError) return 404;
  if (error instanceof BacklogInputError || error instanceof TaskSuggestionInputError || error instanceof JiraInputError) return 400;
  if (error instanceof SessionBusyError) return 409;
  if (error instanceof JiraRequestError) return 502;
  if (error instanceof BacklogStoreError || error instanceof SessionRegistryError) return 500;
  return error instanceof Error ? 400 : 500;
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

/** A bot's chat while bots are off: no session route reaches it, since opening or prompting it would resume it. The
 * bot registry decides, as for its forever chat; a registry that cannot be read refuses. */
async function isDormantBotChat(record: SessionRecord): Promise<boolean> {
  if (!record.bot || await botsOn()) return false;
  return bots.botForSession(record.id).then((bot) => Boolean(bot), () => true);
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
        sendJson(response, 200, await suggestWorktreeName({ cwd, item, settings: await readHuiSettings() }));
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
          model: (await readHuiSettings()).models.utility,
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
