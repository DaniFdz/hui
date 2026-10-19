/**
 * The gateway's services, built once at import time in the order they depend on each other: PI, workers and
 * sessions first, then bots, tools, integrations, automation and the backlog, with the route modules that serve them.
 */
import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { homedir, hostname, userInfo } from "node:os";

import { workers } from "./workers.ts";
import { createWorkerRoutes } from "./routes/workers.ts";
import { BOT_CLEANUP_FILE, BOTS_DIR, BotInputError, BotRegistry } from "./bots.ts";
import { BotService } from "./bot-service.ts";
import { remoteBots } from "./bot-remote.ts";
import { createBotRoutes } from "./routes/bots.ts";
import { createGatewayTriggers } from "./bot-triggers-gateway.ts";
import { accountFullName, BotExportService } from "./bot-export.ts";
import { nameFromUsername } from "./bot-templates/cleanup.ts";
import { BotTemplateService } from "./bot-template-import.ts";
import { createBotTemplateRoutes } from "./routes/bot-templates.ts";
import { fetchGrokBotPage } from "./bot-templates/fetch.ts";
import { localBotSkills } from "./bot-skills.ts";
import { durableBotConversations } from "./bot-conversations.ts";
import { CallBroker, providerCallAccounts } from "./calls.ts";
import { createCallRoutes } from "./routes/calls.ts";
import { buildCallRecord, callCompletion, callSettings, createCallDelegate, reportCall } from "./call-helper.ts";
import { optChatBotMemory } from "./bot-memory.ts";
import { botHome, localBotSouls, operatorName as soulOperatorName } from "./bot-souls.ts";
import { type BotReply, type BotView } from "../shared/bots.ts";
import { PullRequestStatuses } from "./pull-requests.ts";

import { botsOn, readHuiSettings, writeHuiSettings } from "./hui-settings.ts";
import { AUTOMATION_FILE, BROWSER_PROFILE_DIR, VSCODE_DIR, VSCODE_SERVER_DIR, WATCHERS_FILE, WATCHER_LOG_DIR } from "./paths.ts";
import { VscodeService } from "./vscode.ts";
import { VscodeInstaller } from "./vscode-install.ts";
import { verifyVscodeServer } from "./vscode-providers.ts";
import { BrowserToolError, ManagedBrowser } from "./browser/manager.ts";
import { MacPower } from "./power.ts";
import type { BrowserStatus } from "../shared/browser.ts";
import { botsEnabled, type Settings } from "../src/lib/settings.ts";
import { ProviderService } from "./providers.ts";
import { invalidateModelCatalog } from "./pi-config.ts";
import { PiMutationService } from "./pi-mutations.ts";
import { WorktreeService } from "./worktree-inventory.ts";
import { liveSessions } from "./live-sessions.ts";
import type { TranscriptEntry } from "./runtimes/types.ts";
import { AutomationService, automationStoreFailure, executeAutomationTask } from "./automation.ts";
import { BotRoutines } from "./bot-routines.ts";
import { ROUTINES_TOOL } from "./runtimes/durable-bot-routines.ts";
import { resolveWorkingDirectory } from "./working-directories.ts";
import { readObservability, recordDiagnosticEvent } from "./observability.ts";
import { durableHost } from "./runtimes/durable-host.ts";
import { createDurableBots } from "./runtimes/durable-bot-access.ts";
import type { SessionJiraIssue } from "../shared/jira.ts";
import {
  JiraClient,
  JiraConfigStore,
  JiraInputError,
  jiraIssuesFromTranscript,
  JiraIssueStatuses,
  jiraIssueUrl,
  JiraRequestError,
  mergeJiraRefs,
  parentCandidates,
  validateCreateInput,
  type JiraConfig,
} from "./jira.ts";
import { registerAgentToolHandler } from "./agent-tools-bridge.ts";
import { SubagentService } from "./subagents.ts";
import { presentMediaForSession } from "./presented-media.ts";
import { GitHubCli } from "./github.ts";
import { GitHubContributionsReader } from "./github-contributions.ts";
import { GitHubPreviews, ghGraphQL, previewPullRequestFetcher } from "./github-previews.ts";
import { DatadogOrgs } from "./datadog.ts";
import { DatadogPreviews } from "./datadog-previews.ts";
import { TaskSuggestionInputError, TaskSuggestionStore } from "./task-suggestions.ts";
import { WatcherInputError, WatcherService } from "./watchers.ts";
import { SecretFiles, SecretRequests } from "./secret-requests.ts";
import { Questionnaires } from "./questionnaires.ts";
import { BacklogJiraFeed, BacklogStore, createBacklogLifecycle } from "./backlog.ts";
import { TASK_SUGGESTION_START_MODES, taskSuggestionJiraDescription } from "../shared/task-suggestions.ts";
import { terminals, TerminalError } from "./terminals.ts";
import { createSessionListHub } from "./session-list.ts";
import { createFileRoutes } from "./routes/files.ts";
import { createDiffRoutes } from "./routes/diff.ts";
import { createAttachmentRoutes } from "./routes/attachments.ts";
import { createThemeRoutes } from "./routes/themes.ts";
import { createLocalPathRoutes } from "./routes/local-paths.ts";
import { createAutomationRoutes } from "./routes/automation.ts";
import { createBacklogRoutes } from "./routes/backlog.ts";
import { createTaskSuggestionRoutes } from "./routes/task-suggestions.ts";
import { createWatcherRoutes } from "./routes/watchers.ts";
import { createPiRoutes } from "./routes/pi.ts";
import { createPowerRoutes } from "./routes/power.ts";
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
import { createDiagnosticsRoutes } from "./routes/diagnostics.ts";
import { ensureConfigDir } from "./themes.ts";
import { AttachmentInputError, readAttachments } from "./sessions/attachments.ts";
import {
  readRegistry,
  SessionNotFoundError,
  updateRegistry,
  type SessionRecord,
} from "./sessions.ts";
import { createSessionLifecycle, defaultSessionTool, SESSION_TITLE_MAX } from "./sessions/lifecycle.ts";
import { setAgentStage } from "./sessions/stages.ts";
import { createSessionViews } from "./sessions/views.ts";

const piMutations = new PiMutationService();
export const piRoutes = createPiRoutes({ piMutations });
export const workerRoutes = createWorkerRoutes({ service: workers, readRegistry });
export const localPathRoutes = createLocalPathRoutes({ workers });
export const terminalRoutes = createTerminalRoutes({ readRegistry });
export const fileRoutes = createFileRoutes({ session: async (id) => (await readRegistry()).find((record) => record.id === id) });
export const diffRoutes = createDiffRoutes({ session: async (id) => (await readRegistry()).find((record) => record.id === id) });
export const themeRoutes = createThemeRoutes();
export const updateRoutes = createUpdateRoutes();
export const settingsRoutes = createSettingsRoutes({ writeSettings });
export const diagnosticsRoutes = createDiagnosticsRoutes({
  observability: async () => readObservability(await readRegistry(), async (conversationId) => durableHost().conversationUsage(conversationId as never)),
});
export const attachmentRoutes = createAttachmentRoutes({ session: async (id) => (await readRegistry()).find((record) => record.id === id), liveSessions });
// Sessions a lost connection interrupted reattach once their worker is back,
// and stop showing a reconnect once HUI no longer tries.
function forWorkerSessions(workerId: string, act: (record: SessionRecord) => void): void {
  void readRegistry().then((records) => {
    for (const record of records) if (record.worker === workerId && liveSessions.isLive(record.id)) act(record);
  }).catch(() => undefined);
}
workers.onConnected((workerId) => forWorkerSessions(workerId, (record) => liveSessions.ensure(record, true)));
workers.onStopped((workerId) => forWorkerSessions(workerId, (record) => liveSessions.stopReconnecting(record.id)));

/** Bots (HUI-18): their registry, and the service that runs each one's forever chat as an ordinary Durable session
 * whose memory is OptChat's (docs/optchat.md). */
const botMemory = optChatBotMemory(durableHost());
export const botRegistry = new BotRegistry(undefined, (count) => recordDiagnosticEvent({
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
export const bots = new BotService({
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
export const botStreams = new Set<ServerResponse>();
export const botRoutes = createBotRoutes({
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
export const botTemplateRoutes = createBotTemplateRoutes({
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
export const botList = createSessionListHub<BotView>(async () => [{ label: "bots", sessions: await bots.list({ archived: "all" }) }]);
export const subagents = new SubagentService(liveSessions);
const taskSuggestions = new TaskSuggestionStore({ onChange: (id) => liveSessions.notifySnapshot(id) });
export const watchers = new WatcherService({
  file: WATCHERS_FILE,
  logDir: WATCHER_LOG_DIR,
  onChange: (id) => liveSessions.notifySnapshot(id),
});
export const watcherRoutes = createWatcherRoutes({ watchers, readRegistry });
/** One managed browser per gateway; its settings are re-read on every call. */
export const managedBrowser = new ManagedBrowser({
  profileDir: BROWSER_PROFILE_DIR,
  readSettings: async () => (await readHuiSettings()).browser,
});
/** One VS Code server per gateway for every VS Code view, started on the first open (`vscode.ts`). Nothing runs or
 * downloads before that; an openvscode-server install happens only when the operator asks for it. */
export const vscode = new VscodeService({
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
export const browserRoutes = createBrowserRoutes({ managedBrowser, browserStatus, readRegistry });
export const vscodeRoutes = createVscodeRoutes({ vscode, readRegistry });
/** macOS sleep prevention lives and dies with this gateway process. */
export const macPower = process.platform === "darwin" ? new MacPower() : undefined;
export const powerRoutes = createPowerRoutes({ macPower });
liveSessions.setTaskSuggestionProvider((id) => taskSuggestions.list(id));
liveSessions.setWatcherProvider((id) => watchers.list(id));
export const secretRequests = new SecretRequests({ onChange: (id) => liveSessions.notifySnapshot(id) });
export const secretFiles = new SecretFiles();
export const questionnaires = new Questionnaires({ onChange: (id) => liveSessions.notifySnapshot(id) });
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

const providerService = new ProviderService(undefined, invalidateModelCatalog);
export const providerRoutes = createProviderRoutes({ providerService });

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
export const callRoutes = createCallRoutes({
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

/* ── GitHub ── status, device login and previews run through the operator's
 * `gh`; HUI never sees the token. `HUI_GITHUB_CLI` points E2E at a fake executable. */
const GH_COMMAND = process.env["HUI_GITHUB_CLI"] || "gh";
export const githubCli = new GitHubCli({ command: GH_COMMAND });
/** Bots' triggers (HUI-18): what listeners the operator runs report, with the pull requests it links to read through the
 * same `gh`. */
export const triggers = createGatewayTriggers({
  send: (botId, message) => bots.send(botId, message),
  listBots: () => botRegistry.list(),
  active: botsOn,
  ghCommand: GH_COMMAND,
  report: (event) => recordDiagnosticEvent({ area: "session", ...event }),
});
const githubPreviews = new GitHubPreviews(ghGraphQL(GH_COMMAND));
const githubContributions = new GitHubContributionsReader(GH_COMMAND);
export const githubRoutes = createGitHubRoutes({ githubCli, githubPreviews, githubContributions, bots });

/* ── Datadog ── orgs, sign-in and previews run through the operator's `pup`; HUI never sees a token.
 * `HUI_PUP_CLI` points E2E at a fake executable. A sign-in or an org change drops cached previews. */
export const datadogOrgs = new DatadogOrgs({ command: process.env["HUI_PUP_CLI"] || "pup", onChange: () => datadogPreviews.clear() });
const datadogPreviews = new DatadogPreviews(datadogOrgs);
export const datadogRoutes = createDatadogRoutes({ datadogOrgs, datadogPreviews });
const pullRequestStatuses = new PullRequestStatuses(previewPullRequestFetcher(githubPreviews));

const worktreeService = new WorktreeService({
  isRunning: (id) => liveSessions.hasRuntime(id),
  stopSession: (id) => liveSessions.close(id),
});
export const worktreeRoutes = createWorktreeRoutes({ worktreeService, readRegistry });

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

export const jiraRoutes = createJiraRoutes({
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

export const sessionList = createSessionListHub(listSessionViews);
export const sessionRoutes = createSessionRoutes({
  sessionList,
  lifecycle: { createSession, startWorktreeSession, deleteSession, updateSession },
  views: sessionViews,
  bots,
  isDormantBotChat,
});
export const sessionActionRoutes = createSessionActionRoutes({
  lifecycle: { updateSession, forkRequest, forkFromSession },
  views: sessionViews,
  bots,
  isDormantBotChat,
  subagents,
  secretRequests,
  questionnaires,
});

export const automation = new AutomationService(AUTOMATION_FILE, (task, signal, context) => executeAutomationTask(task, signal, context, { liveSessions, bots, botsOn }));
export const automationRoutes = createAutomationRoutes({ automation });
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

export const taskSuggestionRoutes = createTaskSuggestionRoutes({
  taskSuggestions,
  readRegistry,
  startTaskSuggestion,
  saveSuggestionToBacklog,
  sessionMutationErrorStatus,
  TASK_SUGGESTION_START_MODES,
});
export const backlogRoutes = createBacklogRoutes({
  listBacklog,
  findBacklogItem,
  startBacklogItem,
  backlogStore,
  backlogFeed,
  jiraConfigReady,
  jiraConfig: () => jiraConfig,
  jiraClient,
  jiraStatuses,
  createAssignedJiraIssue,
  taskSuggestionJiraDescription,
});

/** A bot's chat while bots are off: no session route reaches it, since opening or prompting it would resume it. The
 * bot registry decides, as for its forever chat; a registry that cannot be read refuses. */
export async function isDormantBotChat(record: SessionRecord): Promise<boolean> {
  if (!record.bot || await botsOn()) return false;
  return bots.botForSession(record.id).then((bot) => Boolean(bot), () => true);
}
