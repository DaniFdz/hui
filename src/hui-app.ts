/**
 * The root application element, also reused as the embedded chat pane inside splits and bot views. As the shell it
 * holds the browser-side state (route, session list, layout, drafts, bots, settings and the polls that refresh them)
 * and passes it to the view render functions as props. Durable state lives behind the gateway's `/__hui/` routes;
 * this element mirrors it and sends requests, it never reads files or runs processes.
 */
import { renderPicker } from "./views/settings-picker.ts";
import { groupCheckoutDefaults } from "./lib/group-session-defaults.ts";
import { renderDirectoryPicker } from "./views/directory-picker.ts";
import { sessionTreeIds } from "./lib/session-tree.ts";
import { applySessionListUpdate, type SessionListUpdate } from "../shared/session-list.ts";
import { html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { property, state } from "lit/decorators.js";
import { HuiElement } from "./lit/hui-element.ts";
import {
  abortSession,
  askSideQuestion,
  answerQuestion,
  clearSession,
  reloadSession,
  createSession,
  createSessionGroup,
  reorderSessionGroups,
  continueSession,
  sessionGroupLabel,
  deleteSession,
  deleteSessionGroup,
  followUpSession,
  loadGitCheckout,
  loadModels,
  loadCommands,
  mutateQueuedMessage,
  loadSessions,
  openSession,
  renameSession,
  resumeSession,
  rewindSession,
  type RewindTarget,
  type TranscriptAttachment,
  cancelCompaction,
  compactSession,
  sendPrompt,
  setSessionThinking,
  steerSession,
  setSessionModel,
  subscribeSession,
  subscribeSessionStatuses,
  transcriptAsMarkdown,
  updateSessionGroup,
  type Attachment,
  type RuntimeEvent,
  type RuntimeModel,
  type RuntimeCommand,
  type RuntimeUsage,
  type RuntimeCompaction,
  type RuntimeQuestion,
  type PromptMode,
  type QueueSnapshot,
  type SessionConnection,
  type SessionSnapshot,
  type SubagentTaskView,
  type SessionGroup,
  type SessionStatus,
  type SessionStatusUpdate,
  type SessionView,
  type TranscriptItem,
  type GitCheckoutInfo,
  type WorktreeProgress,
} from "./lib/sessions-store.ts";
import { readAttachment, readTranscriptAttachments, validateAttachmentTotal } from "./lib/attachments.ts";
import { resolveLaunchModel } from "./lib/model-selection.ts";
import { botChatCommandRefusal, completeCommandReference, composerCommands, filterSlashCommands, parseClearCommand, parseCompactCommand, parseReloadCommand, parseUpdateCommand, slashCommandQuery, type ComposerCommand } from "./lib/slash-commands.ts";
import {
  applyBotsUpdate,
  archiveBot,
  deleteBot,
  botChangePatch,
  botMemoryPageUrl,
  botSettingChange,
  isNewBotsFrame,
  createBot,
  botSoulKey,
  loadBotMemory,
  loadBotSoul,
  loadBots,
  restoreBot,
  saveBotSoul,
  subscribeBots,
  updateBot,
  upsertBot,
  withoutBotSessions,
  zoomBotMemory,
  type BotView,
} from "./lib/bots.ts";
import { archivedBotCount, hiddenBotCount, isBotSettingsShortcut, readBotPanel, readSidebarTab, writeBotPanel, writeSidebarTab, type BotPanelState, type BotPanelTab, type SidebarTab } from "./lib/bot-roster.ts";
import { BotToolsController } from "./lib/bot-tools.ts";
import { BotTriggersController } from "./lib/bot-triggers.ts";
import { memoryStatusChanged, parseMemoryView, parseMemoryZoom, type MemoryLine } from "./lib/bot-memory.ts";
import { renderBotArchiveDialog, renderBotDeleteDialog, renderBotPanel, renderBotPlaceholder, type BotMemoryState, type BotSoulState, type MemoryZoomState } from "./views/bots.ts";
import { renderBotExportDialog, renderBotImportDialog } from "./views/bot-import.ts";
import { BotImportController } from "./lib/bot-import-controller.ts";
import { NO_BOT_SETTINGS_SAVES, type BotSettingKey, type BotSettingsProps, type BotSettingsSaves, type BotSettingValue } from "./views/bot-settings.ts";
import { checkUpdate, checkUpdateInBackground, installUpdate, loadUpdate } from "./lib/update-store.ts";
import { availableUpdate, watchUpdateAvailability } from "./lib/update-notice.ts";
import type { UpdateSnapshot } from "./lib/update-types.ts";
import { renderUpdateDialog } from "./views/update-dialog.ts";
import { renderUpdateNotice } from "./views/update-notice.ts";
import { renderPowerNotice } from "./views/power-notice.ts";
import {
  completeLocalPath,
  loadLocalPathSuggestions,
  type LocalPathQuery,
  type LocalPathSuggestion,
} from "./lib/local-paths.ts";
import { customGroupOrder, moveGroupLabel, readSidebarSessionOptions, writeSidebarSessionOptions, type SidebarSessionOptions } from "./lib/sidebar-sessions.ts";
import { disconnectTextareaOverflowObserver, observeTextareaOverflow, scheduleTextareaHeightAdjustment } from "./lib/composer-textarea.ts";
import {
  EMPTY_QUEUE,
  streamingAfterSubmission,
} from "./lib/composer-state.ts";
import {
  deleteComposerDraft,
  listComposerDraftSessionIds,
  mayUseComposerDraftKey,
  mergeComposerDraft,
  NEW_SESSION_DRAFT_KEY,
  readComposerDraft,
  sessionDraftKey,
  sessionIdFromDraftKey,
  writeComposerDraft,
} from "./lib/composer-drafts.ts";
import { attachmentPreview } from "./lib/attachments.ts";
import { appendPendingUser, localTranscriptId, normalizeTranscript, reduceTranscript, settlePendingUser } from "./lib/transcript-state.ts";
import { SendRequests } from "./lib/send-requests.ts";
import { CONTINUE_AFTER_ERROR_PROMPT, latestRunError } from "./lib/run-error.ts";
import {
  emptySessionPresentation,
  isCurrentSessionRequest,
  isSelectedSession,
  mergeSessionStatuses,
  modelRequestMarkerAfterFailure,
  noteAfterRunOutcome,
  shouldRequestModels,
  shouldFlushLaunchPrompt,
  streamingAfterEvent,
  streamingForStatus,
  type NoteLevel,
} from "./lib/session-ui-state.ts";
import { closeModal, ensureModal } from "./lib/modal-dialog.ts";
import { documentTitle } from "./lib/document-title.ts";
import { botsEnabled, type Settings } from "./lib/settings.ts";
import { currentSettings, patchSettings, refreshSettings, settingsWritten } from "./lib/settings-store.ts";
import type { ThemeMode, ThemeVariant } from "./lib/theme.ts";
import {
  applyAccent,
  applyMode,
  applyTheme,
  importTheme,
  loadThemePreviews,
  selectedThemeId,
  selectedThemeVariant,
} from "./lib/theme-store.ts";
import type { ThemePreview } from "./lib/theme-store.ts";
import {
  installPiPackage,
  installPiSkill,
  loadPiConfig,
  loadPiResource,
  removePiPackage,
  skillPreferencePath,
  type PiMutationKind,
  type PiMutationResult,
  type PiMutationState,
  type PiSnapshot,
} from "./lib/pi.ts";
import { loadWorkingDirectorySuggestions } from "./lib/working-directories.ts";
import {
  cancelAutomationRun,
  createAutomationTask,
  deleteAutomationTask,
  loadAutomation,
  runAutomationTask,
  updateAutomationTask,
  type AutomationRun,
  type AutomationSnapshot,
  type AutomationTask,
  type AutomationTaskInput,
} from "./lib/automation.ts";
import {
  loadGatewayHealth,
  loadPower,
  loadWorkspaceInspection,
  setLidAwake,
  type GatewayHealth,
  type WorkspaceInspection,
} from "./lib/control-surfaces.ts";
import type { PowerStatus } from "../shared/power.ts";
import { downloadDiagnostics, loadObservability, type ObservabilitySnapshot } from "./lib/observability.ts";
import { renderHome, renderNewSession, type BotHeaderAction, type HomeBot, type HomeProps } from "./views/home.ts";
import { DEFAULT_SESSIONS_PAGE_FILTERS, renderSessionsPage, type SessionsPageFilters, type SessionsPageState } from "./views/sessions.ts";
import type { WorktreeFilter } from "./views/worktrees.ts";
import "./views/contributions.ts";
import { loadWorktrees, removeWorktrees, worktreesOnlyUsedBy, type WorktreeInventory, type WorktreeRemovalResult, type WorktreeRisk } from "./lib/worktrees.ts";
import { renderPanelSelector } from "./views/panel-selector.ts";
import { renderAutomationSurface } from "./views/automation.ts";
import { renderKanbanPage } from "./views/kanban.ts";
import { readKanbanOptions, writeKanbanOptions, type KanbanMove, type KanbanOptions } from "./lib/kanban.ts";
import { DEFAULT_SESSION_STAGE, SESSION_STAGE_LABELS, type SessionStage } from "../shared/session-stages.ts";
import type { BacklogCardAction, SessionCardAction } from "./views/kanban.ts";
import type { BacklogStartTarget } from "./components/backlog-start-dialog.ts";
import type { ForkTarget } from "./components/fork-dialog.ts";
import { addSuggestionToBacklog, backlogItemMarkdown, loadBacklog, removeBacklogItem, setBacklogItemGroup, type BacklogItem, type BacklogJiraState } from "./lib/backlog.ts";
import { loadJiraConnection } from "./lib/jira.ts";
import { VoiceController } from "./lib/voice-controller.ts";
import { renderCallBar, renderCallView, type CallViewProps } from "./views/bot-voice.ts";
import { liveCallPlatform, loadCallsStatus } from "./lib/live-call-platform.ts";
import { callsReady, type CallsStatus } from "../shared/calls.ts";
import { localTimezone, type AutomationProps } from "./views/settings-automation.ts";
import { loadWorkers, workerAction, type WorkerView } from "./lib/workers.ts";
import { hasOpenWebAwesomePopup } from "./lib/web-awesome.ts";
import { APP_SHELL_DRAWER_MEDIA, closeDrawerOnEscape, renderMain, renderSidebar, toggleNavigationDrawer, type GroupDropTarget, type GroupMenuAction, type NavId, type SessionCopyAction, type SessionOpenAction, type ShellBotsProps } from "./views/shell.ts";
import { writeClipboardText } from "./lib/clipboard.ts";
import { renderSettingsPage, type SettingsPage } from "./views/settings.ts";
import type { JiraCreatedDetail } from "./components/jira-create-dialog.ts";
import { clampSuggestionIndex, dismissTaskSuggestion, parseTaskSuggestions, startTaskSuggestion, taskSuggestionPrompt, type TaskSuggestion, type TaskSuggestionStartMode } from "./lib/task-suggestions.ts";
import { dismissWatcher as dismissWatcherRequest, parseWatchers, readWatcherLog, restartWatcher as restartWatcherRequest, stopWatcher as stopWatcherRequest, type Watcher } from "./lib/watchers.ts";
import {
  isCommandPaletteShortcut,
  renderCommandPalette,
  type CommandPaletteAction,
} from "./views/command-palette.ts";
import { isPiSurface, renderPiSurface } from "./views/pi-surfaces.ts";
import { renderPiResourceReader, type PiResourceReaderState } from "./views/pi-resource-reader.ts";
import { isObservabilitySurface, renderObservabilitySurface } from "./views/observability.ts";
import { isOwnedSurface, renderOwnedSurface } from "./views/hui-owned-surfaces.ts";
import { HUI_PAGES, type HuiPage } from "./lib/pages.ts";
import { activeSessionPane, addSessionTab, closeSessionPane, focusSessionPane, isChatPane, moveSessionPane, parseSessionLayout, replacePaneSession, resizeSessionLayout, SESSION_LAYOUT_KEY, SESSION_SPLIT_MEDIA, sessionPanes, visibleSessionPanes, singleSessionLayout, splitSessionPane, type DropZone, type SessionLayout, type SessionPane, type SplitDirection } from "./lib/session-multiplexer.ts";
import {
  activateWorkView, closeWorkView, launchableWorkViewKinds, migrateLayoutWorkViews, openWorkView, parseWorkPaneStore, pruneWorkPaneStore, registerWorkViewKind, reorderWorkView,
  retainWorkSessions, serializeWorkPaneStore, sessionWorkPane, setWorkPaneOpen, setWorkPaneWidth, workViewKey, workViewKind, workViewKinds,
  WORK_PANE_CHAT_MIN_WIDTH, WORK_PANE_KEY, WORK_PANE_TOGGLE_SHORTCUT, type WorkPaneStore, type WorkViewRef,
} from "./lib/work-pane.ts";
import { PANE_COLUMN_MIN_WIDTH } from "./lib/session-pane-geometry.ts";
import { terminalWorkViewKind } from "./lib/work-views/terminal.ts";
import { browserWorkViewKind } from "./lib/work-views/browser.ts";
import { matchesShortcut } from "./lib/shortcut-binding.ts";
import "./components/work-pane.ts";
import type { WorkPane } from "./components/work-pane.ts";
import { createTerminal, listTerminals } from "./lib/terminals-store.ts";
import "./components/terminal-pane.ts";
import "./components/browser-pane.ts";
import { SessionMultiplexer, type PanePresentation } from "./components/session-multiplexer.ts";
import {
  isRoutablePage,
  navigationPath,
  resolveNavigation,
  settingsCloseNavigation,
  settingsReturnTarget,
  type NavigationTarget,
} from "./lib/navigation.ts";

const COLLAPSED_KEY = "hui.collapsed-groups";
const HUI_UPDATE_SESSION_TITLE = "HUI update";

/** Matches the scheduler's own cadence closely enough to show settling runs. */
const AUTOMATION_POLL_MS = 3000;

/** Collapsed groups are a reading preference, so they stay in the browser. */
function readCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Pane callbacks are behavior, not render data: only their presence changes
 * the output. The split parent recreates equivalent closures on every render;
 * comparing identity re-rendered every pane's whole transcript on each unrelated
 * update or resize step. Lit still stores the newest value, but a rendered
 * button may keep an older one: capture only the pane/session id and the parent. */
const paneCallback = { attribute: false, hasChanged: (value: unknown, old: unknown) => !value !== !old };

/** A bot pane's Call button (HUI-18): offered while calls can run (GPT-Live, with a ChatGPT login). Compared by value. */
type PaneCall = { botId: string; inCall: boolean };
const paneCallProperty = { attribute: false, hasChanged: (value: unknown, old: unknown) => JSON.stringify(value) !== JSON.stringify(old) };

/** A bot's Settings tab: a row's saves or refusals without that row's. */
function withoutSetting<Value>(record: Partial<Record<BotSettingKey, Value>>, key: BotSettingKey): Partial<Record<BotSettingKey, Value>> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** The bot pane's header data, without its callback (passed separately as a
 * pane callback). Compared by value: the parent rebuilds it on every render. */
type PaneBot = Omit<HomeBot, "onTogglePanel" | "onAction">;
const paneBotProperty = { attribute: false, hasChanged: (value: unknown, old: unknown) => JSON.stringify(value) !== JSON.stringify(old) };

/** Defined by `defineHuiApp`, not on import: main.ts loads this module while the
 * saved appearance is still being read, and the app must not paint before it. */
export class HuiApp extends HuiElement {
  @state() private view: NavId = "home";
  @state() private activePage: HuiPage | undefined;
  @state() private search = "";
  @state() private sessionsPageState: SessionsPageState = "all";
  @state() private sessionsPageFilters: SessionsPageFilters = { ...DEFAULT_SESSIONS_PAGE_FILTERS };
  @state() private sessionsSelected: ReadonlySet<string> = new Set();
  @state() private sessionsDeleteConfirm = false;
  @state() private sessionsDeleting = false;
  @state() private sessionsDeleteNotice = "";
  @state() private worktreeInventory: WorktreeInventory | undefined;
  @state() private worktreesLoading = false;
  @state() private worktreesError = "";
  @state() private worktreeQuery = "";
  @state() private worktreeFilter: WorktreeFilter = "all";
  @state() private worktreeConfirm = "";
  @state() private worktreesRemoving = false;
  @state() private worktreeResults: readonly WorktreeRemovalResult[] = [];
  private worktreePoll?: number;
  @state() private groups: readonly SessionGroup[] = [];
  @state() private sessionsLoading = true;
  @state() private sessionsError = "";
  @state() private collapsed: ReadonlySet<string> = readCollapsed();
  @state() private toggledSessionTrees: ReadonlySet<string> = new Set();
  @state() private sessionOptions: SidebarSessionOptions = readSidebarSessionOptions();
  @state() private kanbanOptions: KanbanOptions = readKanbanOptions();
  @state() private kanbanQuery = "";
  @state() private kanbanMovePendingId = "";
  @state() private kanbanNotice = "";
  @state() private kanbanNoticeFailed = false;
  @state() private kanbanDraggingId = "";
  @state() private kanbanDropTarget = "";
  @state() private draggingSessionId = "";
  @state() private sessionDropTarget = "";
  @state() private sessionMovePendingId = "";
  @state() private sessionMoveNotice = "";
  @state() private archiveToast: { session: SessionView; restoring: boolean; error?: string } | undefined;
  /** Session whose "Create Jira work item" dialog is open. */
  @state() private jiraCreateSession: SessionView | undefined;
  /** Session whose "Link Jira work item" dialog is open. */
  @state() private jiraLinkSession: SessionView | undefined;
  /** Local backlog task whose Jira create/link dialog is open. */
  @state() private jiraCreateBacklogItem: BacklogItem | undefined;
  @state() private jiraLinkBacklogItem: BacklogItem | undefined;
  /** Kanban backlog: items, loading/error state and the Jira feed state. */
  @state() private backlog: readonly BacklogItem[] = [];
  @state() private backlogLoading = false;
  @state() private backlogError = "";
  @state() private backlogJira: BacklogJiraState = { status: "unconfigured" };
  @state() private backlogPendingId = "";
  private backlogRequest = 0;
  /** Backlog item whose start dialog is open, with the drop target. */
  @state() private backlogStart: { item: BacklogItem; target: BacklogStartTarget } | undefined;
  /** Local task awaiting removal confirmation. */
  @state() private backlogRemove: BacklogItem | undefined;
  /** Whether Jira is connected, for the suggestion card's actions; unknown until loaded. */
  @state() private jiraConfigured: boolean | undefined;
  private archiveToastTimer: ReturnType<typeof setTimeout> | undefined;
  @state() private sessionMoveFailed = false;
  @state() private draggingGroup = "";
  @state() private groupDropTarget: GroupDropTarget | undefined;
  @state() private groupReorderPending = false;
  @state() private selected: SessionView | undefined;
  @state() private transcript: readonly TranscriptItem[] = [];
  @state() private subagents: readonly SubagentTaskView[] = [];
  /** Pending `suggest_task` cards for the open session, from its snapshot. */
  @state() private taskSuggestions: readonly TaskSuggestion[] = [];
  @state() private taskSuggestionIndex = 0;
  @state() private taskSuggestionPendingId = "";
  @state() private jiraCreateSuggestion: TaskSuggestion | undefined;
  /** HUI-run background watchers for the open session, from its snapshot. */
  @state() private watchers: readonly Watcher[] = [];
  @state() private watcherPendingId = "";
  /** The watcher log the operator opened; one at a time. */
  @state() private watcherLog: { id: string; lines: readonly string[]; truncated: boolean; loading: boolean } | null = null;
  @state() private opening = false;
  /** Why the selected session's open request failed; its view offers a retry. */
  @state() private openError = "";
  @state() private streaming = false;
  /** `sessionId\0errorKey` of run errors the operator dismissed this page load. */
  @state() private dismissedRunErrors: ReadonlySet<string> = new Set();
  @state() private sending = false;
  /** Request ids for composer sends, so resending one the gateway already took never runs it twice. */
  private readonly sendRequests = new SendRequests();
  @state() private stopping = false;
  @state() private continuing = false;
  @state() private rewindPending = false;
  /** The Fork from here dialog: the session and reply it forks from. While it is open, the chat's fork buttons rest. */
  @state() private forkTarget: ForkTarget | undefined;
  @state() private sideChat: HomeProps["sideChat"];
  /** The composer's live text, deliberately not reactive: a keystroke only
   * changes what its own textarea already shows, so typing must not re-render
   * the transcript behind it. Code-owned changes go through `setDraft`. */
  private draft = "";
  /** Bumped by `setDraft` so `updated()` measures a textarea whose value code
   * replaced, never one the operator is typing into. */
  @state() private draftRevision = 0;
  @state() private queue: QueueSnapshot = EMPTY_QUEUE;
  @state() private queueEditingId = "";
  @state() private queueEditingText = "";
  @state() private thinking = "medium";
  @state() private question: RuntimeQuestion | undefined;
  @state() private connection: SessionConnection = "live";
  @state() private copiedId = "";
  @state() private expandedActivityIds: ReadonlySet<string> = new Set();
  @state() private showScrollToBottom = false;
  @state() private launching = false;
  @state() private note = "";
  @state() private noteLevel: NoteLevel = "info";
  /** The runtime warning (provider retry, model fallback) the current run is narrating. */
  private recoveryNotice = "";
  /** Empty while the stream is live; otherwise a muted line saying why. */
  @state() private connectionNote = "";
  @state() private importNote = "";
  @state() private importFailed = false;
  @state() private groupMenuFor = "";
  @state() private groupAction: { action: "new" } | { action: Exclude<GroupMenuAction, "new">; group: SessionGroup } | undefined;
  @state() private groupMutationPending = false;
  @state() private groupMutationError = "";
  @state() private groupDefaultCwd = "";
  @state() private groupDefaultMode: "branch" | "worktree" = "branch";
  @state() private groupDefaultRef = "";
  @state() private groupCheckout: GitCheckoutInfo | undefined;
  @state() private groupCheckoutLoading = false;
  @state() private groupCheckoutError = "";
  private groupCheckoutRequest = 0;
  private groupCheckoutDirectory = "";
  @state() private launchDefaults: { group: string; cwd: string; workspaceMode?: "branch" | "worktree"; baseRef?: string } | undefined;
  @state() private launchWorkers: readonly WorkerView[] = [];
  /** Sticky across launches: the worker new sessions run on, if any. */
  @state() private launchWorker: string | undefined;
  @state() private launchModel = "";
  @state() private launchThinking = "";
  @state() private directorySuggestions: readonly string[] = [];
  /** The machine `directorySuggestions` came from: "" for this one, else a worker's id. A bot's Settings tab shows only
   * its own machine's, so a bot on a worker is never offered this machine's folders. */
  private directorySuggestionsFrom = "";
  private directorySuggestionRequest = 0;
  private gitCheckoutRequest = 0;
  private inspectedCheckoutDirectory = "";
  private launchPiRequest: Promise<void> | undefined;
  private automationPoll: number | undefined;
  @state() private automation: AutomationSnapshot | undefined;
  @state() private automationError = "";
  @state() private automationPending = false;
  @state() private automationFormError = "";
  @state() private automationActionError = "";
  @state() private automationEditingId = "";
  private groupActionReturnFocus: HTMLElement | undefined;

  @state() private settings: Settings = currentSettings();
  @state() private themeId: string = selectedThemeId();
  @state() private variant: ThemeVariant = selectedThemeVariant();
  @state() private previews: readonly ThemePreview[] = [];
  @state() private settingsOpen = false;
  @state() private settingsPage: SettingsPage = "appearance";
  /** `undefined` until the backend answers, so an empty list never reads as "none". */
  @state() private pi: PiSnapshot | undefined;
  @state() private piLoading = false;
  @state() private piError = "";
  @state() private piOperation: PiMutationState | undefined;
  @state() private piRemoveCandidate = "";
  @state() private piResourceReader: PiResourceReaderState | undefined;
  @state() private health: GatewayHealth | undefined;
  @state() private healthError = "";
  /** macOS sleep prevention; `null` when the gateway is not on macOS. */
  @state() private power: PowerStatus | null | undefined;
  @state() private powerNoticeDismissed = false;
  @state() private workspaceInspection: WorkspaceInspection | undefined;
  @state() private workspaceError = "";
  @state() private controlLoading = false;
  @state() private observability: ObservabilitySnapshot | undefined;
  @state() private observabilityLoading = false;
  @state() private observabilityError = "";
  @state() private saveFailed = false;
  private settingsSaveRevision = 0;
  /** Session-scoped editor state: a late selection can never retarget an action. */
  @state() private renamingFor = "";
  @state() private deletingFor = "";
  /** Models the open session can switch to, and the one it is running on. */
  @state() private models: readonly RuntimeModel[] = [];
  @state() private commands: readonly RuntimeCommand[] = [];
  @state() private commandsLoading = false;
  @state() private commandsError = "";
  @state() private slashQuery: string | null = null;
  @state() private slashActiveIndex = 0;
  @state() private localPathQuery: LocalPathQuery | null = null;
  @state() private localPaths: readonly LocalPathSuggestion[] = [];
  @state() private localPathsLoading = false;
  @state() private localPathsError = "";
  @state() private localPathActiveIndex = 0;
  private commandsLoaded = false;
  private commandsRequest = 0;
  private localPathsRequest = 0;
  private localPathCwd = "";
  private pendingCommandBrowse = false;
  @state() private updateOpen = false;
  @state() private updateChecking = false;
  @state() private updateStarting = false;
  @state() private updateReadOnly = false;
  @state() private updateError = "";
  @state() private updateReconnecting = false;
  @state() private updateSnapshot: UpdateSnapshot | null = null;
  @state() private dismissedUpdateVersion = "";
  @state() private updateSessionCreating = false;
  private updateMonitor: ReturnType<typeof watchUpdateAvailability> | undefined;
  private updateReturnFocus: HTMLElement | null = null;
  private readonly onUpdateVisibility = () => this.updateMonitor?.refresh();
  private updatePollTimer: number | undefined;
  private updatePollDeadline = 0;
  @state() private currentModel: RuntimeModel | undefined;
  @state() private usage: RuntimeUsage | undefined;
  @state() private compaction: RuntimeCompaction | undefined;
  @state() private workspaceBranch = "";
  @state() private workspaceWorktree = false;
  @state() private workspaceBaseRef = "";
  @state() private workspaceBranchSuggestionsOpen = false;
  @state() private gitCheckout: GitCheckoutInfo | undefined;
  @state() private gitCheckoutLoading = false;
  @state() private draftSessionIds: ReadonlySet<string> = new Set();
  /** Picked but not yet sent; cleared on send and on switching session. */
  @state() private attachments: readonly Attachment[] = [];
  /** Which sidebar row menu is open. Only one at a time. */
  @state() private menuFor = "";
  @state() private themeImportNote = "";
  @state() private themeImportFailed = false;
  @state() private commandPaletteOpen = false;
  @state() private commandPaletteQuery = "";
  @state() private commandPaletteActiveIndex = 0;
  @state() private mobileNavLayout = false;
  /* ── bots (top-level app only; panes never read bots) ── */
  @state() private bots: readonly BotView[] = [];
  @state() private botsLoading = false;
  @state() private botsLoaded = false;
  @state() private botsError = "";
  private botsInFlight: Promise<void> | undefined;
  private botsAgain = false;
  /** The gateway pushes the bot list; reads by GET are only its fallback. */
  private botsStreamStop: (() => void) | undefined;
  private botsStreamLive = false;
  private botsStreamUnsupported = false;
  /** The stream was asked again after a 409 whose settings still said bots are on; once is enough. */
  private botsStreamRetried = false;
  private botsRevision = 0;
  @state() private botSearch = "";
  /** The sidebar's Agents | Bots choice, remembered by the browser. */
  @state() private sidebarTab: SidebarTab = readSidebarTab();
  @state() private showHiddenBots = false;
  @state() private showArchivedBots = false;
  @state() private botMenuFor = "";
  @state() private botNotice = "";
  @state() private botNoticeFailed = false;
  @state() private botPendingId = "";
  /** The bot whose chat the bot route shows. */
  @state() private activeBotId = "";
  @state() private botPanel: BotPanelState = readBotPanel();
  /** Narrow layouts open the panel as a sheet only on request; never remembered. */
  @state() private botSheetOpen = false;
  /** + is creating a bot; another press waits for it. */
  @state() private botCreating = false;
  /** The Settings tab's saves, per bot: each change is one PATCH, sent in order, and a newer change to the same row
   * replaces a value still waiting. Kept per bot, so leaving a bot never drops a change on its way. */
  @state() private botSettingsSaves: ReadonlyMap<string, BotSettingsSaves> = new Map();
  private botSettingsQueue: Promise<void> = Promise.resolve();
  /** The ChatGPT login GPT-Live calls use (`/__hui/calls`), read on a bot's page. */
  @state() private callsStatus: CallsStatus | undefined;
  private callsStatusLoading: Promise<void> | undefined;
  @state() private botArchive: BotView | undefined;
  @state() private botArchivePending = false;
  @state() private botArchiveError = "";
  /** The archived bot whose Delete asks for confirmation. */
  @state() private botDelete: BotView | undefined;
  @state() private botDeletePending = false;
  @state() private botDeleteError = "";
  @state() private botArchiveToast: { bot: BotView; restoring: boolean; error?: string } | undefined;
  /** Import bot… (+) and Export… (a bot's ⋯): their dialogs' state. An imported bot opens like a new one. */
  private botImports = new BotImportController(this, {
    workers: () => this.launchWorkers,
    imported: (bot, warnings) => {
      this.bots = upsertBot(this.bots, bot);
      this.botNotice = warnings.length ? `Imported ${bot.name}. ${warnings.join(" ")}` : "";
      this.botNoticeFailed = warnings.length > 0;
      void this.refreshBots();
      void this.refreshSessions(true);
      this.navigate({ kind: "bot", id: bot.id });
    },
  });
  private botArchiveToastTimer: ReturnType<typeof setTimeout> | undefined;
  @state() private botMemory: BotMemoryState & { botId: string } = { botId: "", loading: false, error: "" };
  @state() private botMemoryZoom: ReadonlyMap<string, MemoryZoomState> = new Map();
  private botMemoryRequest = 0;
  private botMemoryInFlight = false;
  /** A change arrived while a read was on its way: read once more after it. */
  private botMemoryAgain = false;
  /** The Soul tab: the active bot's SOUL.md as last read, and its editor (undefined while only shown). */
  @state() private botSoul: BotSoulState & { botId: string } = { botId: "", loading: false, error: "" };
  @state() private botSoulDraft: string | undefined;
  @state() private botSoulSaving = false;
  @state() private botSoulSaveError = "";
  private botSoulRequest = 0;
  /** `botSoulKey` of the bot when SOUL.md was last read: another key, once its turn is over, means read it again. */
  private botSoulSeen = "";
  /** The Tools tab: what the operator can turn off in the bot's chat, kept in its own controller. */
  private botTools = new BotToolsController(this);
  /** The Routines tab's Triggers section, read while it shows. */
  private botTriggers = new BotTriggersController(this, { visible: () => this.botPanelVisible() && this.botPanel.tab === "routines" });
  private botRosterTick = 0;
  /** Set on the bot route's embedded pane: header identity and panel state. */
  @property(paneBotProperty) paneBot: PaneBot | undefined;
  @property(paneCallback) onPaneBotPanel: (() => void) | undefined;
  /** The bot header's ⋯ menu, handled by the app that owns the bot dialogs. */
  @property(paneCallback) onPaneBotAction: ((action: BotHeaderAction) => void) | undefined;
  /** Browser-owned presentation state; each pane still owns its own runtime state. */
  @state() private sessionLayout: SessionLayout | undefined;
  /** Browser-local Work pane record per conversation (`lib/work-pane.ts`); top-level app only. */
  @state() private workPanes: WorkPaneStore = {};
  /** Below 1100px the Work pane is a full-screen destination instead of a side pane. */
  @state() private workNarrow = false;
  @state() private workNarrowShown = false;
  @state() private workLaunching = "";
  @state() private workError = "";
  /** The view the operator launched last; it may take focus once it opens. */
  private workLaunchedKey = "";
  /** Conversations whose Work views stay mounted, most recently focused first. */
  private workRetained: string[] = [];
  private workMedia: MediaQueryList | undefined;
  private readonly onWorkMediaChange = (event: MediaQueryListEvent) => { this.workNarrow = event.matches; };
  @property({ type: Boolean, attribute: "embedded-pane" }) embeddedPane = false;
  @property({ attribute: "pane-session-id" }) paneSessionId = "";
  /** The shell's registry entry, so a pane opens without waiting for (or
   * depending on) its own registry request, which can time out or be stale. */
  @property({ attribute: false }) paneSession?: SessionView;
  @property() paneId = "";
  @property({ type: Boolean }) paneActive = true;
  @property({ type: Boolean }) paneVisible = true;
  @property({ type: Boolean }) paneNarrow = false;
  @property({ type: Boolean }) paneMobileNav = false;
  @property(paneCallback) onPaneClose: (() => void) | undefined;
  @property(paneCallback) onPaneSplit: ((direction: SplitDirection) => void) | undefined;
  @property(paneCallback) onPaneTerminal: (() => Promise<void>) | undefined;
  /** Opens this session's browser view in the Work pane: the larger live view beside the chat. */
  @property(paneCallback) onPaneBrowser: (() => void) | undefined;
  @state() private terminalOpening = false;
  @state() private terminalError = "";
  @property(paneCallback) onPaneNavigate: ((id: string) => void) | undefined;
  @property(paneCallback) onPaneRegistryChange: (() => Promise<void>) | undefined;
  /** Worktree progress while the gateway still creates this pane's session;
   * the pane opens it once this clears. */
  @property({ attribute: false }) paneCreating: WorktreeProgress | undefined;
  @property({ attribute: false }) paneCreationError: string | undefined;
  /** The failed launch's prompt, returned to New Session when this pane deletes it. */
  @property({ attribute: false }) paneUnsentPrompt: string | undefined;
  /** The shell's session list; panes never fetch their own copy. */
  @property({ attribute: false }) paneGroups: readonly SessionGroup[] | undefined;
  @property(paneCallback) onPaneUpdate: ((text: string, attachments: readonly Attachment[]) => boolean) | undefined;
  /** Embedded panes own the composer but not the sidebar; report draft
   * presence so the shell can project the pencil onto the session row. */
  @property(paneCallback) onPaneDraftChange: ((sessionId: string, hasDraft: boolean) => void) | undefined;
  /** Set on the bot route's pane while the bot can be called. */
  @property(paneCallProperty) paneCall: PaneCall | undefined;
  @property(paneCallback) onPaneCall: (() => void) | undefined;
  /** The app's calls (top-level only): the one call with a bot, on GPT-Live. */
  private readonly voice = new VoiceController(this, {
    platform: liveCallPlatform,
    now: () => Date.now(),
    setInterval: (callback, ms) => { const timer = window.setInterval(callback, ms); return () => window.clearInterval(timer); },
  });
  private mobileNavMedia: MediaQueryList | undefined;
  private composerTextarea: HTMLTextAreaElement | null = null;
  private readonly onMobileNavChange = (event: MediaQueryListEvent) => {
    this.mobileNavLayout = event.matches;
    // The bot panel moves between the side and a sheet; what it reads follows.
    this.syncBotPanelData();
  };

  /** Ends the current event stream; replaced on every session switch. */
  private streamStop: (() => void) | undefined;
  /** One lightweight connection keeps background session lifecycle visible. */
  private statusStreamStop: (() => void) | undefined;
  private sessionStatuses = new Map<string, SessionStatus>();
  private hasSessionStatusSnapshot = false;
  /** Revision of the gateway session list in `groups`; older lists lose. */
  private sessionListRevision = 0;
  /** Session whose model list has already been requested for this selection. */
  private modelsRequestedFor = "";
  /** Direct session route waiting for the registry to finish loading. */
  private pendingSessionId = "";
  /** Route that opened Settings. Direct Settings URLs deliberately fall home. */
  private settingsReturnTarget: NavigationTarget = { kind: "home" };
  private deleteReturnFocus: HTMLElement | undefined;
  private deleteNeedsFocus = false;
  private questionReturnFocus: HTMLElement | undefined;
  /** Monotonic ownership token for open responses from the selected session. */
  private openRequestToken = 0;
  private autoFollow = true;
  private copyTimer: number | undefined;
  private subagentExpiryTimer: number | undefined;
  /** First prompt composed on New Session, released only after PI reports idle. */
  private pendingLaunchPrompt = "";
  private pendingLaunchAttachments: readonly Attachment[] = [];
  private commandPaletteReturnFocus: HTMLElement | undefined;
  private piResourceReaderReturnFocus: HTMLElement | undefined;
  private piResourceReaderRequest = 0;
  private piResourceCopyTimer: number | undefined;
  private composerDraftKey = NEW_SESSION_DRAFT_KEY;
  private composerDraftLoad = 0;
  private composerDraftEdit = 0;
  private composerDraftHydrated = false;
  private draftIndicatorRevision = 0;

  get hasQueuedMessageEdit(): boolean { return Boolean(this.queueEditingId); }

  private readonly onPopState = () => {
    this.syncFromLocation();
  };

  private readonly onGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.sideChat) {
      this.sideChat = undefined;
      return;
    }
    if (this.embeddedPane) return;
    if (event.key === "Escape") {
      this.handleGlobalEscape(event);
      return;
    }
    if (isBotSettingsShortcut(event)) {
      if (this.view !== "bot" || this.settingsOpen || this.commandPaletteOpen || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      this.toggleBotSettings();
      return;
    }
    if (!isCommandPaletteShortcut(event)) return;
    event.preventDefault();
    this.commandPaletteOpen ? this.closeCommandPalette() : this.openCommandPalette();
  };

  /**
   * Document-level fallback so Escape works regardless of focus (e.g. body
   * after navigation). Scoped handlers that consume Escape call preventDefault.
   */
  private handleGlobalEscape(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || this.commandPaletteOpen) return;
    if (hasOpenWebAwesomePopup(event) || document.querySelector("dialog[open]")) return;
    if (this.sideChat) {
      event.preventDefault();
      this.sideChat = undefined;
      return;
    }
    if (this.settingsOpen) {
      event.preventDefault();
      this.closeSettings();
      return;
    }
    if (!this.embeddedPane && this.view === "bot") {
      if (this.mobileNavLayout && this.botSheetOpen) {
        event.preventDefault();
        this.closeBotPanel();
        return;
      }
      this.botPaneApp()?.handleGlobalEscape(event);
      return;
    }
    if (!this.embeddedPane && this.view === "home" && this.selected) {
      this.activePaneApp()?.handleGlobalEscape(event);
      return;
    }
    if (this.view === "home" && this.selected && this.streaming && !this.stopping) {
      event.preventDefault();
      this.abort();
    }
  }

  private readonly onPageHide = () => {
    void this.persistComposerDraft();
  };

  override connectedCallback() {
    super.connectedCallback();
    if (this.embeddedPane) {
      if (this.paneSessionId) this.applyNavigation({ kind: "session", id: this.paneSessionId });
    } else {
      this.setupWorkPane();
      this.syncFromLocation();
      this.mobileNavMedia = window.matchMedia(APP_SHELL_DRAWER_MEDIA);
      this.mobileNavLayout = this.mobileNavMedia.matches;
      this.mobileNavMedia.addEventListener("change", this.onMobileNavChange);
      window.addEventListener("popstate", this.onPopState);
      document.addEventListener("keydown", this.onGlobalKeyDown);
      // Capture: a focused terminal swallows keys, and Work pane shortcuts must still work from inside one.
      document.addEventListener("keydown", this.onWorkShortcut, true);
    }
    window.addEventListener("pagehide", this.onPageHide);
    if (!this.embeddedPane) {
      this.statusStreamStop ??= subscribeSessionStatuses({
        onSnapshot: this.applySessionStatusSnapshot,
        onStatus: this.applySessionStatusUpdate,
        onSessions: this.applySessionListChange,
      });
      this.syncBotsStream();
      this.updateMonitor = watchUpdateAvailability({
        check: checkUpdateInBackground,
        receive: (snapshot) => {
          if (!this.updateOpen && !this.updateStarting) this.updateSnapshot = snapshot;
        },
        enabled: () => document.visibilityState === "visible" && navigator.onLine && !this.updateOpen && !this.updateStarting,
      });
      document.addEventListener("visibilitychange", this.onUpdateVisibility);
      window.addEventListener("online", this.onUpdateVisibility);
      window.addEventListener("offline", this.onUpdateVisibility);
      window.addEventListener("focus", this.onUpdateVisibility);
    }
  }

  override disconnectedCallback() {
    this.pauseArchiveToast();
    void this.persistComposerDraft();
    super.disconnectedCallback();
    window.clearInterval(this.sessionProgressPoll);
    window.clearTimeout(this.worktreePoll);
    this.mobileNavMedia?.removeEventListener("change", this.onMobileNavChange);
    this.mobileNavMedia = undefined;
    if (this.composerTextarea) disconnectTextareaOverflowObserver(this.composerTextarea);
    this.composerTextarea = null;
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("keydown", this.onGlobalKeyDown);
    document.removeEventListener("keydown", this.onWorkShortcut, true);
    this.workMedia?.removeEventListener("change", this.onWorkMediaChange);
    this.workMedia = undefined;
    document.removeEventListener("visibilitychange", this.onUpdateVisibility);
    window.removeEventListener("online", this.onUpdateVisibility);
    window.removeEventListener("offline", this.onUpdateVisibility);
    window.removeEventListener("focus", this.onUpdateVisibility);
    this.updateMonitor?.stop();
    this.updateMonitor = undefined;
    if (!this.embeddedPane) this.voice.dispose();
    this.streamStop?.();
    this.streamStop = undefined;
    if (this.subagentExpiryTimer !== undefined) window.clearTimeout(this.subagentExpiryTimer);
    this.subagentExpiryTimer = undefined;
    this.stopAutomationPolling();
    if (this.botArchiveToastTimer) clearTimeout(this.botArchiveToastTimer);
    if (this.piResourceCopyTimer !== undefined) window.clearTimeout(this.piResourceCopyTimer);
    this.piResourceCopyTimer = undefined;
    if (this.updatePollTimer !== undefined) window.clearTimeout(this.updatePollTimer);
    this.statusStreamStop?.();
    this.statusStreamStop = undefined;
    this.botsStreamStop?.();
    this.botsStreamStop = undefined;
    this.botsStreamLive = false;
  }

  private sessionProgressPoll?: number;
  private gatewayHealthPending = false;

  private async refreshGatewayHealth() {
    if (this.gatewayHealthPending || this.controlLoading) return;
    this.gatewayHealthPending = true;
    try {
      this.health = await loadGatewayHealth();
      this.healthError = "";
    } catch (error) {
      this.healthError = error instanceof Error ? error.message : "Could not read gateway health.";
    } finally {
      this.gatewayHealthPending = false;
    }
  }

  private powerRequest = 0;

  /** The newest request wins, so an older poll never undoes a click. */
  private async refreshPower(next?: Promise<PowerStatus | null>) {
    const request = ++this.powerRequest;
    let power: PowerStatus | null | undefined;
    try {
      power = await (next ?? loadPower());
    } catch {
      // Unknown rather than stale: no banner or switches until the gateway answers.
    }
    if (request !== this.powerRequest) return;
    this.power = power;
    if (!power?.lidOn) this.powerNoticeDismissed = false;
  }

  private setLidAwakeFromUi = (on: boolean) => void this.refreshPower(setLidAwake(on));

  override firstUpdated() {
    if (!this.embeddedPane) void this.refreshPower();
    this.sessionProgressPoll = window.setInterval(() => {
      // Not on macOS stays not on macOS; otherwise the banner follows the gateway.
      if (!this.embeddedPane && !document.hidden && this.power !== null) void this.refreshPower();
      if (!document.hidden && this.transcript.length) this.requestUpdate();
      if (!this.embeddedPane && !document.hidden && this.settingsOpen && this.settingsPage === "connection") {
        void this.refreshGatewayHealth();
      }
      // Roster times ("2m") age while nothing else re-renders the sidebar.
      if (!this.embeddedPane && !document.hidden && botsEnabled(this.settings) && this.sidebarTab === "bots" && ++this.botRosterTick % 10 === 0) {
        this.requestUpdate();
      }
    }, 3000);
    this.switchComposerDraft(NEW_SESSION_DRAFT_KEY);
    this.refreshDraftIndicators();
    if (!this.embeddedPane) {
      void this.refreshSessions();
      this.loadLaunchPreferences();
      // The home page shows the launch form too, without a page navigation.
      this.loadLaunchWorkers();
      void loadThemePreviews().then((previews) => {
        this.previews = previews;
      });
    }
  }

  private applySessionStatusSnapshot = (updates: readonly SessionStatusUpdate[]) => {
    // The status stream has just (re)connected, so the gateway is reachable
    // again: a list that failed to load earlier is worth asking for once more.
    if (!this.embeddedPane && this.sessionsError && !this.sessionsLoading) void this.refreshSessions();
    this.sessionStatuses = new Map(updates.map(({ id, status }) => [id, status]));
    const unread = new Map(updates.flatMap((update) =>
      update.unread === undefined ? [] : [[update.id, update.unread] as const]));
    this.hasSessionStatusSnapshot = true;
    const selected = this.embeddedPane && this.selected && this.isSessionPresented(this.selected.id)
      ? this.selected
      : undefined;
    const merged = mergeSessionStatuses(this.groups, this.sessionStatuses);
    this.groups = merged.map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => {
        const status = session.id === selected?.id ? selected.status : session.status;
        const isUnread = session.id === selected?.id
          ? false
          : unread.has(session.id) ? unread.get(session.id) === true : session.unread === true;
        return { ...session, status, unread: isUnread || undefined };
      }),
    }));
    // Bot chats are sessions too: their roster rows follow the same stream.
    if (this.bots.length) {
      this.bots = this.bots.map((bot) => {
        const status = this.sessionStatuses.get(bot.sessionId);
        const isUnread = unread.get(bot.sessionId);
        if (status === undefined && isUnread === undefined) return bot;
        return { ...bot, ...(status ? { status } : {}), ...(isUnread !== undefined ? { unread: isUnread && !this.isSessionPresented(bot.sessionId) } : {}) };
      });
    }
  };

  private applySessionStatusUpdate = ({ id, status, unread, creating, creationError, title }: SessionStatusUpdate) => {
    const presented = this.isSessionPresented(id);
    this.sessionStatuses.set(id, status);
    // A settled worktree session now has its real title and directory, or its error.
    const created = Boolean(this.listedSession(id)?.creating) && !creating;
    this.groups = this.groups.map((group) => ({
      ...group,
      sessions: group.sessions.map((session) => session.id === id
        ? {
            ...session,
            status: this.embeddedPane && presented && this.selected?.id === id ? this.selected.status : status,
            unread: presented
              ? undefined
              : unread === undefined ? session.unread : unread || undefined,
            creating,
            creationError,
            ...(title ? { title } : {}),
          }
        : session),
    }));
    if (created) void this.refreshSessions(true);
    const bot = this.bots.find((candidate) => candidate.sessionId === id);
    if (bot) {
      this.bots = this.bots.map((candidate) => candidate.sessionId === id
        ? { ...candidate, status, unread: presented ? false : unread === undefined ? candidate.unread : unread }
        : candidate);
      // A turn started or settled: its latest message moved. The bot stream
      // pushes that itself; without it (an older gateway) read the list again,
      // and the open Memory and Soul tabs read again.
      if (bot.status !== status && !this.botsStreamLive) {
        void this.refreshBots();
        if (bot.id === this.activeBotId && this.botMemoryTabVisible()) void this.refreshBotMemory();
        if (bot.id === this.activeBotId && this.botSoulTabVisible() && status !== "running" && status !== "waiting") void this.refreshBotSoul();
      }
    }
    if (!this.embeddedPane && this.selected?.id === id) {
      this.reopenIfRestarted(id, status);
      this.selected = { ...this.selected, status, ...(title ? { title } : {}) };
    }
  };

  /** The gateway restarted a runtime whose stream had ended: a remote session
   * reattached after a lost connection, or a retry from another screen. */
  private reopenIfRestarted(id: string, status: SessionStatus) {
    if (this.selected?.id !== id || this.opening || this.connection !== "stopped") return;
    if (this.selected.status === "error" && status !== "error") void this.openSelected(id);
  }

  private async refreshSessions(background = false) {
    if (this.embeddedPane) {
      // The shell owns the list; resolve once its refresh has reached this pane.
      await this.onPaneRegistryChange?.();
      await this.updateComplete;
      return;
    }
    if (!background) this.sessionsLoading = true;
    try {
      const { revision, groups } = await loadSessions();
      // The status stream may have delivered newer changes while this loaded.
      this.receiveSessionList(revision, this.hasSessionStatusSnapshot ? mergeSessionStatuses(groups, this.sessionStatuses) : groups);
      this.sessionsError = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read sessions.";
      if (this.groups.length === 0) {
        this.sessionsError = message;
      } else {
        // A refresh failure must not replace a usable registry with a full
        // sidebar error. Preserve the last confirmed list and report inline.
        this.reportOperationError(error, message);
      }
    } finally {
      if (!background) this.sessionsLoading = false;
      this.openPendingSession();
    }
  }

  private applySessionListChange = (update: SessionListUpdate<SessionView>) => {
    if (update.revision <= this.sessionListRevision) return;
    // Status events can overtake a list built a moment earlier.
    this.receiveSessionList(update.revision, mergeSessionStatuses(applySessionListUpdate(this.groups, update), this.sessionStatuses));
    this.sessionsLoading = false;
    this.sessionsError = "";
    this.openPendingSession();
  };

  /** Full lists and stream changes both land here, in revision order. */
  private receiveSessionList(revision: number, groups: readonly SessionGroup[]) {
    if (revision < this.sessionListRevision) return;
    this.sessionListRevision = revision;
    this.groups = groups;
    const ids = new Set(groups.flatMap((group) => group.sessions.map(({ id }) => id)));
    // Removed conversations take their Work pane record with them (their terminals end with them).
    if (!this.embeddedPane) this.commitWorkPanes(pruneWorkPaneStore(this.workPanes, ids));
    if (!this.sessionLayout) return;
    for (const pane of sessionPanes(this.sessionLayout)) {
      if (!ids.has(pane.sessionId)) this.sessionLayout = closeSessionPane(this.sessionLayout, pane.id);
    }
    const active = activeSessionPane(this.sessionLayout);
    if (!ids.has(active.sessionId)) {
      this.sessionLayout = undefined;
      this.persistSessionLayout();
      if (this.view === "home" && this.selected) this.navigate({ kind: "home" }, true);
    } else if (this.view === "home" && this.selected && !this.settingsOpen) this.commitSessionLayout(this.sessionLayout);
  }

  override willUpdate(changed: PropertyValues) {
    // Subagent trees follow the selection: moving elsewhere folds the old tree.
    if (changed.has("selected") && (changed.get("selected") as SessionView | undefined)?.id !== this.selected?.id) {
      this.toggledSessionTrees = new Set();
    }
    if (changed.has("paneCreating") && !this.paneCreating && changed.get("paneCreating") && this.selected?.id === this.paneSessionId) {
      void this.openSelected(this.selected.id);
    }
    if (this.embeddedPane && changed.has("paneGroups") && this.paneGroups) {
      // The shell's list can trail this pane's own detailed stream; keep the
      // presented session's live status rather than regressing it.
      const selected = this.selected && this.isSessionPresented(this.selected.id) ? this.selected : undefined;
      this.groups = selected
        ? this.paneGroups.map((group) => ({
            ...group,
            sessions: group.sessions.map((session) => session.id === selected.id ? { ...session, status: selected.status } : session),
          }))
        : this.paneGroups;
      // Renames (by another screen or the gateway's generated name) reach the header.
      const listed = selected && this.listedSession(selected.id);
      // The stream clears an interruption when a run starts; the gateway clears
      // it when a reattached remote run turns out to have finished.
      if (listed) this.selected = { ...selected, ...listed, status: selected.status, interrupted: selected.interrupted && listed.interrupted };
      const shellStatus = selected && this.paneGroups.flatMap((group) => group.sessions).find((session) => session.id === selected.id)?.status;
      if (selected && shellStatus) this.reopenIfRestarted(selected.id, shellStatus);
      this.sessionsLoading = false;
      this.openPendingSession();
    }
    if (changed.has("queueEditingId") && this.embeddedPane) {
      this.dispatchEvent(new CustomEvent("hui-queue-edit-retention", { bubbles: true }));
    }
    if (
      this.embeddedPane &&
      changed.has("paneSessionId") &&
      this.paneSessionId &&
      this.paneSessionId !== this.selected?.id &&
      this.paneSessionId !== this.pendingSessionId
    ) {
      this.applyNavigation({ kind: "session", id: this.paneSessionId });
    }
  }

  /** Lit cannot autofocus a field that appears on a later render, and typing
   * straight into a rename is the whole point of an inline field. */
  override updated(changed: PropertyValues) {
    // Session and bot panes measure their own composers.
    const textarea = !this.embeddedPane && ((this.view === "home" && this.selected) || this.view === "bot")
      ? null : this.renderRoot.querySelector<HTMLTextAreaElement>(".agent-chat__composer-combobox > textarea");
    if (textarea !== this.composerTextarea) {
      if (this.composerTextarea) disconnectTextareaOverflowObserver(this.composerTextarea);
      this.composerTextarea = textarea;
      if (textarea) {
        observeTextareaOverflow(textarea);
        scheduleTextareaHeightAdjustment(textarea);
      }
    } else if (textarea && changed.has("draftRevision")) {
      // Typing measures its own textarea in the input handler; only a draft that
      // code replaced under it needs a measuring pass after the render.
      scheduleTextareaHeightAdjustment(textarea);
    }
    if (this.pendingCommandBrowse && this.selected?.status === "idle" && !this.opening && textarea) {
      this.pendingCommandBrowse = false;
      textarea.focus();
      textarea.setSelectionRange(this.draft.length, this.draft.length);
      this.setCommandQuery(slashCommandQuery(this.draft, this.draft.length));
    }
    // Bots turned on or off, here or (through the bot stream) on another screen.
    if (changed.has("settings")) {
      const before = changed.get("settings") as Settings | undefined;
      if (before && botsEnabled(before) !== botsEnabled(this.settings)) this.followBotsSetting();
    }
    // A bot's chat offers GPT-Live calls once the gateway says a ChatGPT login is there.
    if (!this.embeddedPane && this.view === "bot" && !this.callsStatus) void this.loadCallsStatus();
    if (changed.has("selected") || changed.has("view") || changed.has("settingsOpen") || changed.has("activeBotId") || changed.has("bots")) {
      const activeSessionTitle = this.settingsOpen ? undefined
        : this.view === "home" ? this.selected?.title
          : this.view === "bot" ? this.activeBot()?.name
            : undefined;
      if (!this.embeddedPane) document.title = documentTitle(activeSessionTitle);
    }
    const botArchiveDialog = this.botArchive ? this.renderRoot.querySelector?.(".bot-archive-dialog") : null;
    if (botArchiveDialog instanceof HTMLDialogElement && !botArchiveDialog.open) {
      ensureModal(botArchiveDialog);
      botArchiveDialog.querySelector<HTMLButtonElement>(".bot-archive-cancel")?.focus();
    }
    const botDeleteDialog = this.botDelete ? this.renderRoot.querySelector?.(".bot-delete-dialog") : null;
    if (botDeleteDialog instanceof HTMLDialogElement && !botDeleteDialog.open) {
      ensureModal(botDeleteDialog);
      botDeleteDialog.querySelector<HTMLButtonElement>(".bot-delete-cancel")?.focus();
    }
    this.botImports.showDialogs(this.renderRoot);
    // A selector that matches nothing walks the whole open transcript, and
    // this runs on every keystroke: query a dialog only while its state shows it.
    const worktreeDialog = this.worktreeConfirm && this.worktreeConfirm !== "merged" ? this.renderRoot.querySelector?.(".worktree-remove-dialog") : null;
    if (worktreeDialog instanceof HTMLDialogElement && !worktreeDialog.open) {
      ensureModal(worktreeDialog);
      worktreeDialog.querySelector<HTMLButtonElement>(".worktree-remove-cancel")?.focus();
    }
    const sessionsDeleteDialog = this.sessionsDeleteConfirm ? this.renderRoot.querySelector?.(".sessions-delete-dialog") : null;
    if (sessionsDeleteDialog instanceof HTMLDialogElement) ensureModal(sessionsDeleteDialog);
    const backlogRemoveDialog = this.backlogRemove ? this.renderRoot.querySelector?.(".backlog-remove-dialog") : null;
    if (backlogRemoveDialog instanceof HTMLDialogElement) ensureModal(backlogRemoveDialog);
    const deleteDialog = this.deletingFor ? this.renderRoot.querySelector?.(".delete-session-dialog") : null;
    if (deleteDialog instanceof HTMLDialogElement) {
      ensureModal(deleteDialog);
    }
    if (this.deleteNeedsFocus && this.deletingFor) {
      this.deleteNeedsFocus = false;
      const cancel = this.renderRoot.querySelector?.(".delete-session-cancel");
      if (cancel instanceof HTMLButtonElement) cancel.focus();
    }
    if (changed.has("question") && this.question && (!this.embeddedPane || this.paneVisible)) {
      const questionControl = this.renderRoot.querySelector?.('.session-question-card [role="radio"][tabindex="0"], .session-question-card input:not([type="hidden"]), .session-question-card textarea');
      if (questionControl instanceof HTMLElement) questionControl.focus();
    }
    const groupDialog = this.groupAction ? this.renderRoot.querySelector?.(".group-action-dialog") : null;
    const updateDialog = this.updateOpen ? this.renderRoot.querySelector?.(".hui-update-dialog") : null;
    if (updateDialog instanceof HTMLDialogElement) ensureModal(updateDialog);
    if (groupDialog instanceof HTMLDialogElement) ensureModal(groupDialog);
    const resourceReader = this.piResourceReader ? this.renderRoot.querySelector?.(".pi-resource-reader-modal") : null;
    if (resourceReader instanceof HTMLDialogElement) ensureModal(resourceReader);
    const commandPalette = this.commandPaletteOpen ? this.renderRoot.querySelector?.(".command-palette-dialog") : null;
    if (commandPalette instanceof HTMLDialogElement) {
      ensureModal(commandPalette);
      if (changed.has("commandPaletteOpen")) {
        const input = this.renderRoot.querySelector?.("#command-palette-input");
        if (input instanceof HTMLInputElement) input.focus();
      }
    }
    // The live compaction divider sits below the transcript rows, so its changes follow too.
    if ((changed.has("transcript") || changed.has("compaction") || changed.has("paneVisible")) && this.autoFollow) this.scrollToBottom();
    if (!this.renamingFor) {
      return;
    }
    const field = this.renderRoot.querySelector?.(".chat-pane__session-title-input");
    if (field instanceof HTMLInputElement && document.activeElement !== field) {
      field.focus();
      field.select();
    }
  }

  private syncFromLocation() {
    const resolved = resolveNavigation(window.location.pathname);
    if (resolved.target.kind === "session") {
      let saved = parseSessionLayout(window.history.state?.huiSessionLayout);
      if (!saved) try { saved = parseSessionLayout(JSON.parse(localStorage.getItem(SESSION_LAYOUT_KEY) ?? "null")); } catch { /* Use a single view. */ }
      if (saved) {
        // Terminal and browser panes saved before the Work pane move into it, without losing any.
        const migrated = migrateLayoutWorkViews(saved, this.workPanes);
        if (migrated.moved) {
          saved = migrated.layout;
          this.workPanes = migrated.store;
          this.sessionLayout = saved;
          this.persistSessionLayout();
          this.persistWorkPanes();
          window.history.replaceState({ ...window.history.state, huiSessionLayout: saved }, "");
        }
      }
      this.sessionLayout = saved ?? singleSessionLayout(resolved.target.id);
      if (activeSessionPane(this.sessionLayout).sessionId !== resolved.target.id) this.sessionLayout = replacePaneSession(this.sessionLayout, this.sessionLayout.activePaneId, resolved.target.id);
    }
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const canonical = resolved.path;
    if (current !== canonical) {
      window.history.replaceState({ ...window.history.state, huiSessionLayout: this.sessionLayout }, "", canonical);
    }
    this.applyNavigation(resolved.target);
  }

  private navigate(target: NavigationTarget, replace = false) {
    if (this.embeddedPane) {
      if (target.kind === "session") this.onPaneNavigate?.(target.id);
      else if (target.kind === "home") void this.onPaneRegistryChange?.();
      return;
    }
    if (target.kind === "session") {
      const layout = this.sessionLayout ?? singleSessionLayout(target.id);
      this.sessionLayout = replacePaneSession(layout, layout.activePaneId, target.id);
      this.persistSessionLayout();
    }
    const path = navigationPath(target);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== path) {
      window.history[replace ? "replaceState" : "pushState"]({ huiSessionLayout: this.sessionLayout }, "", path);
    }
    this.applyNavigation(target);
  }

  /** Selection is retained while another surface is open, but only the active
   * session route may replace global lifecycle and unread state with its
   * detailed stream. */
  private isSessionPresented(id: string): boolean {
    if (this.embeddedPane) return this.paneVisible && this.paneSessionId === id;
    if (this.view === "bot") return !this.settingsOpen && this.activeBot()?.sessionId === id;
    if (this.view === "home" && !this.settingsOpen && this.sessionLayout) {
      const narrow = this.renderRoot.querySelector<SessionMultiplexer>("hui-session-multiplexer")?.narrow;
      return visibleSessionPanes(this.sessionLayout).some((pane) => isChatPane(pane) && pane.sessionId === id && (!narrow || pane.id === this.sessionLayout?.activePaneId));
    }
    const target = resolveNavigation(window.location.pathname).target;
    return target.kind === "session" && target.id === id;
  }

  /** Background rows use the lightweight status stream. A detailed stream is
   * also the server's read receipt, so it must exist only while chat is shown. */
  private suspendSelectedSessionView() {
    this.openRequestToken += 1;
    this.streamStop?.();
    this.streamStop = undefined;
    this.opening = false;
  }

  private applyNavigation(target: NavigationTarget) {
    if (target.kind === "settings") {
      this.settingsPage = target.page;
      this.settingsOpen = true;
      this.loadSettingsData();
      if (target.page === "diagnostics") this.loadOperationalData();
      if (target.page === "worktrees") {
        this.worktreeConfirm = "";
        this.worktreeResults = [];
        this.loadWorktreeInventory();
      }
      if (target.page === "automation") this.startAutomationPolling();
      else this.stopAutomationPolling();
      return;
    }

    this.settingsOpen = false;
    this.stopAutomationPolling();
    if (target.kind === "bot") {
      // Bots exist in the UI only while Settings → Labs → Bots is on; a bot's address lands on the normal home otherwise.
      if (this.embeddedPane || !botsEnabled(this.settings)) {
        this.navigate({ kind: "home" }, true);
        return;
      }
      this.suspendSelectedSessionView();
      this.resetSessionEphemeral();
      this.pendingSessionId = "";
      this.activePage = undefined;
      if (this.activeBotId !== target.id) {
        this.botSheetOpen = false;
        this.resetBotMemory(target.id);
        this.resetBotSoul(target.id);
        this.botTools.reset(target.id);
        this.botTriggers.reset(target.id);
      }
      this.activeBotId = target.id;
      this.view = "bot";
      this.setSidebarTab("bots");
      this.ensureBots();
      this.syncBotPanelData();
      return;
    }
    if (target.kind === "kanban") {
      this.suspendSelectedSessionView();
      this.resetSessionEphemeral();
      this.pendingSessionId = "";
      this.activePage = undefined;
      this.view = "kanban";
      void this.refreshSessions(true);
      void this.refreshBacklog();
      return;
    }
    if (target.kind === "page") {
      this.suspendSelectedSessionView();
      this.resetSessionEphemeral();
      if (target.page.id === "new-session") {
        this.switchComposerDraft(NEW_SESSION_DRAFT_KEY);
        this.loadLaunchPreferences();
        this.requestGitCheckout(this.launchDefaults?.cwd ?? "~/");
        this.loadLaunchWorkers();
      }
      this.pendingSessionId = "";
      this.activePage = target.page;
      this.view = "surface";
      if (isPiSurface(target.page)) this.loadControlSurfaceData();
      if (isObservabilitySurface(target.page) || isOwnedSurface(target.page)) this.loadOperationalData();
      if (target.page.id === "cron" || target.page.id === "tasks") {
        this.loadAutomationData();
        this.startAutomationPolling();
      }
      return;
    }
    if (target.kind === "session") {
      this.activePage = undefined;
      this.view = "home";
      this.pendingSessionId = target.id;
      if (this.selected?.id === target.id) {
        this.pendingSessionId = "";
        // New session keeps the selection but owns the composer; returning to
        // the same session must restore that session's draft key.
        this.switchComposerDraft(sessionDraftKey(target.id));
        if (this.embeddedPane && !this.streamStop) void this.openSelected(target.id);
        return;
      }
      this.openPendingSession();
      return;
    }

    this.pendingSessionId = "";
    this.activePage = undefined;
    this.view = "home";
    this.clearSessionState();
  }

  private openPendingSession() {
    const id = this.pendingSessionId;
    if (!id) {
      return;
    }
    const session = this.groups.flatMap((group) => group.sessions).find((item) => item.id === id)
      ?? (this.paneSession?.id === id ? this.paneSession : undefined);
    if (session) {
      this.pendingSessionId = "";
      // While bots are off a bot's chat opens nowhere, like a session that is gone (the gateway refuses it too).
      if (session.bot && !botsEnabled(this.settings)) {
        this.navigate({ kind: "home" }, true);
        return;
      }
      // A bot's chat opens as the bot (with its panel) wherever it is linked from.
      if (!this.embeddedPane && session.bot) {
        this.navigate({ kind: "bot", id: session.bot.id }, true);
        return;
      }
      this.activateSession(session);
      return;
    }
    if (!this.sessionsLoading && !this.sessionsError) {
      this.navigate({ kind: "home" }, true);
    }
  }

  private selectView = (_view: NavId) => {
    this.navigate({ kind: "home" });
  };

  private openCommandPalette() {
    if (this.renderRoot.querySelector("dialog[open]")) return;
    this.commandPaletteReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    this.commandPaletteQuery = "";
    this.commandPaletteActiveIndex = 0;
    this.commandPaletteOpen = true;
  }

  private closeCommandPalette = () => {
    const dialog = this.renderRoot.querySelector?.(".command-palette-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
    this.commandPaletteOpen = false;
    this.commandPaletteQuery = "";
    const trigger = this.commandPaletteReturnFocus;
    this.commandPaletteReturnFocus = undefined;
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  private selectCommandPaletteAction = (action: CommandPaletteAction) => {
    const dialog = this.renderRoot.querySelector?.(".command-palette-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
    this.commandPaletteOpen = false;
    this.commandPaletteQuery = "";
    this.commandPaletteReturnFocus = undefined;
    switch (action.kind) {
      case "page":
        this.openPage(action.page);
        break;
      case "settings":
        this.openSurfaceSettings(action.page);
        break;
      case "session":
        this.selectSession(action.session);
        break;
    }
  };

  private commandPalette() {
    return renderCommandPalette({
      open: this.commandPaletteOpen,
      query: this.commandPaletteQuery,
      activeIndex: this.commandPaletteActiveIndex,
      pages: HUI_PAGES,
      groups: this.listedGroups,
      onQuery: (query) => {
        this.commandPaletteQuery = query;
        this.commandPaletteActiveIndex = 0;
      },
      onActiveIndex: (index) => {
        this.commandPaletteActiveIndex = index;
      },
      onSelect: this.selectCommandPaletteAction,
      onClose: this.closeCommandPalette,
    });
  }

  private openPage = (page: HuiPage) => {
    if (isRoutablePage(page)) {
      this.navigate({ kind: "page", page });
    }
  };

  private updateSearch = (search: string) => {
    this.search = search;
  };

  private toggleMenu = (sessionId: string) => {
    this.menuFor = this.menuFor === sessionId ? "" : sessionId;
  };

  /** Session mutations are initiated from the sidebar menu; the chat header
   * only renders the temporary editor while a rename is in progress. */
  private renameFromMenu = (session: SessionView) => {
    this.menuFor = "";
    if (!this.embeddedPane) {
      void this.withSessionPane(session, (app) => app.renameFromMenu(session));
      return;
    }
    this.activateSession(session);
    this.renamingFor = session.id;
  };

  private togglePin = (session: SessionView) => {
    this.menuFor = "";
    void renameSession(session.id, { pinned: !session.pinned })
      .then(() => this.refreshSessions())
      .catch((error: unknown) => {
        this.reportOperationError(error, "Could not pin that session.");
      });
  };

  private setSessionMetadata = (
    session: SessionView,
    patch: { unread?: boolean; archived?: boolean; icon?: string },
    success: string,
  ) => {
    this.menuFor = "";
    void renameSession(session.id, patch)
      .then((updated) => {
        if (this.selected?.id === updated.id) this.selected = updated;
        this.sessionMoveNotice = patch.archived === true ? "" : success;
        this.sessionMoveFailed = false;
        if (patch.archived === true) {
          this.archiveToast = { session: updated, restoring: false };
          this.scheduleArchiveToast();
        }
        const tree = sessionTreeIds(this.groups.flatMap((group) => group.sessions), updated.id);
        if (patch.archived === true && this.sessionLayout) {
          for (const pane of sessionPanes(this.sessionLayout)) {
            if (tree.has(pane.sessionId)) this.sessionLayout = closeSessionPane(this.sessionLayout, pane.id);
          }
          this.persistSessionLayout();
        }
        if (patch.archived === true && this.selected && tree.has(this.selected.id)) {
          this.clearSessionState();
          this.navigate({ kind: "home" }, true);
        }
        return this.refreshSessions();
      })
      .catch((error: unknown) => {
        this.sessionMoveNotice = error instanceof Error ? error.message : "Could not update that session.";
        this.sessionMoveFailed = true;
      });
  };

  private pauseArchiveToast = () => {
    if (this.archiveToastTimer) clearTimeout(this.archiveToastTimer);
    this.archiveToastTimer = undefined;
  };

  private dismissArchiveToast = () => {
    this.pauseArchiveToast();
    this.archiveToast = undefined;
  };

  private scheduleArchiveToast = () => {
    this.pauseArchiveToast();
    if (!this.archiveToast || this.archiveToast.restoring || this.archiveToast.error) return;
    const element = this.querySelector(".session-archive-toast");
    if (element?.matches(":hover") || element?.contains(document.activeElement)) return;
    this.archiveToastTimer = setTimeout(this.dismissArchiveToast, 15_000);
  };

  private restoreArchivedSession = async () => {
    const toast = this.archiveToast;
    if (!toast || toast.restoring) return;
    this.pauseArchiveToast();
    this.archiveToast = { session: toast.session, restoring: true };
    try {
      await renameSession(toast.session.id, { archived: false });
      if (this.archiveToast?.session.id === toast.session.id) this.dismissArchiveToast();
      this.sessionMoveNotice = "Session restored.";
      this.sessionMoveFailed = false;
      await this.refreshSessions();
    } catch (error) {
      if (this.archiveToast?.session.id === toast.session.id) {
        this.archiveToast = { session: toast.session, restoring: false,
          error: error instanceof Error ? error.message : "Could not restore that session." };
      }
    }
  };

  private copySession = (session: SessionView, action: SessionCopyAction) => {
    if (!this.embeddedPane && action === "markdown") {
      void this.withSessionPane(session, (app) => app.copySession(session, action));
      return;
    }
    this.menuFor = "";
    const text = action === "id"
      ? session.id
      : action === "jira"
        ? session.jiraIssues?.at(-1)?.url ?? ""
      : action === "link"
        ? new URL(navigationPath({ kind: "session", id: session.id }), window.location.href).href
        : this.selected?.id === session.id
          ? transcriptAsMarkdown(this.transcript)
          : "";
    if (!text) {
      this.sessionMoveNotice = "Open the conversation before copying it as Markdown.";
      this.sessionMoveFailed = true;
      return;
    }
    void writeClipboardText(text).then((copied) => {
      if (!copied) throw new Error("Clipboard write failed");
      this.sessionMoveNotice = action === "id" ? "Session ID copied." : action === "jira" ? "Jira link copied." : action === "link" ? "Session link copied." : "Conversation copied as Markdown.";
      this.sessionMoveFailed = false;
    }).catch(() => {
      this.sessionMoveNotice = "Could not copy to the clipboard.";
      this.sessionMoveFailed = true;
    });
  };

  private openSessionElsewhere = (session: SessionView, action: SessionOpenAction) => {
    this.menuFor = "";
    if (action === "jira") {
      const issue = session.jiraIssues?.at(-1);
      if (issue) window.open(issue.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (action === "editor") {
      window.location.href = `vscode://file${encodeURI(session.cwd)}`;
      return;
    }
    const path = navigationPath({ kind: "session", id: session.id });
    window.open(path, "_blank", action === "window" ? "popup,noopener,noreferrer" : "noopener,noreferrer");
  };

  private openJiraCreate = (session: SessionView) => {
    this.menuFor = "";
    void import("./components/jira-create-dialog.ts").then(() => { this.jiraCreateSession = session; });
  };

  private closeJiraCreate = () => {
    this.jiraCreateSession = undefined;
    this.jiraCreateSuggestion = undefined;
    this.jiraCreateBacklogItem = undefined;
  };

  private jiraCreated = (detail: JiraCreatedDetail) => {
    this.jiraCreateSession = undefined;
    this.jiraCreateSuggestion = undefined;
    if (detail.backlogItemId) {
      this.jiraCreateBacklogItem = undefined;
      this.kanbanNotice = detail.warning ?? `Created Jira work item ${detail.key} for the backlog task.`;
      this.kanbanNoticeFailed = Boolean(detail.warning);
      void this.refreshBacklog();
      return;
    }
    if (detail.suggestionId) {
      // Filing resolves the card now; the server snapshot confirms it.
      this.taskSuggestions = this.taskSuggestions.filter(({ id }) => id !== detail.suggestionId);
      this.taskSuggestionIndex = clampSuggestionIndex(this.taskSuggestionIndex, this.taskSuggestions.length);
      this.note = detail.warning ?? `Created Jira work item ${detail.key}.`;
      this.noteLevel = detail.warning ? "warning" : "info";
      void this.onPaneRegistryChange?.();
    }
    this.sessionMoveNotice = detail.warning ?? `Created Jira work item ${detail.key}.`;
    this.sessionMoveFailed = Boolean(detail.warning);
    void this.refreshSessions(true);
  };

  private openJiraLink = (session: SessionView) => {
    this.menuFor = "";
    void import("./components/jira-link-dialog.ts").then(() => { this.jiraLinkSession = session; });
  };

  private closeJiraLink = () => {
    this.jiraLinkSession = undefined;
    this.jiraLinkBacklogItem = undefined;
  };

  private jiraLinked = (detail: JiraCreatedDetail) => {
    this.jiraLinkSession = undefined;
    if (detail.backlogItemId) {
      this.jiraLinkBacklogItem = undefined;
      this.kanbanNotice = `Linked Jira work item ${detail.key} to the backlog task.`;
      this.kanbanNoticeFailed = false;
      void this.refreshBacklog();
      return;
    }
    if (this.view === "kanban") {
      this.kanbanNotice = `Linked Jira work item ${detail.key}.`;
      this.kanbanNoticeFailed = false;
      void this.refreshBacklog();
    }
    this.sessionMoveNotice = `Linked Jira work item ${detail.key}.`;
    this.sessionMoveFailed = false;
    void this.refreshSessions(true);
  };

  private renderJiraLinkDialog() {
    if (!this.jiraLinkSession && !this.jiraLinkBacklogItem) return null;
    return html`<hui-jira-link-dialog
      .session=${this.jiraLinkSession}
      .backlogItem=${this.jiraLinkBacklogItem}
      .onClose=${this.closeJiraLink}
      .onLinked=${this.jiraLinked}
      .onOpenSettings=${() => this.openSurfaceSettings("integrations")}
    ></hui-jira-link-dialog>`;
  }

  private renderJiraCreateDialog() {
    if (!this.jiraCreateSession && !this.jiraCreateBacklogItem) return null;
    return html`<hui-jira-create-dialog
      .session=${this.jiraCreateSession}
      .backlogItem=${this.jiraCreateBacklogItem}
      .suggestion=${this.jiraCreateSuggestion}
      .onClose=${this.closeJiraCreate}
      .onCreated=${this.jiraCreated}
      .onOpenSettings=${() => this.openSurfaceSettings("integrations")}
    ></hui-jira-create-dialog>`;
  }

  private moveSession = (session: SessionView, group: string) => {
    if (this.sessionMovePendingId || session.group === group) return;
    this.menuFor = "";
    this.draggingSessionId = "";
    this.sessionDropTarget = "";
    this.sessionMovePendingId = session.id;
    this.sessionMoveNotice = `Moving ${session.title}…`;
    this.sessionMoveFailed = false;
    void renameSession(session.id, { group })
      .then((updated) => {
        if (this.selected?.id === updated.id) this.selected = { ...this.selected, group: updated.group };
        this.sessionMoveNotice = `Moved ${updated.title} to ${sessionGroupLabel(updated.group)}.`;
        return this.refreshSessions();
      })
      .catch((error: unknown) => {
        this.sessionMoveNotice = error instanceof Error ? error.message : "Could not move that session.";
        this.sessionMoveFailed = true;
      })
      .finally(() => {
        this.sessionMovePendingId = "";
      });
  };

  /** Operator stage placement from the Kanban board. Nothing moves until the
   * server confirms; the refreshed registry is the only source of the column. */
  private moveKanbanSession = (session: SessionView, move: KanbanMove) => {
    if (this.kanbanMovePendingId || (move.stage === undefined && move.group === undefined)) return;
    const target = (stage: SessionStage | null | undefined, group: string | undefined) => [
      ...(group !== undefined ? [sessionGroupLabel(group)] : []),
      ...(stage ? [SESSION_STAGE_LABELS[stage]] : []),
    ].join(" · ");
    this.kanbanMovePendingId = session.id;
    this.kanbanNotice = move.stage === null ? `Handing ${session.title} back to the agent…` : `Moving ${session.title} to ${target(move.stage, move.group)}…`;
    this.kanbanNoticeFailed = false;
    // One PATCH, so a stage and group change land together or not at all.
    void renameSession(session.id, move)
      .then((updated) => {
        const label = SESSION_STAGE_LABELS[updated.stage ?? DEFAULT_SESSION_STAGE];
        this.kanbanNotice = move.stage === null
          ? `${updated.title} follows its agent again (${label}).`
          : `Moved ${updated.title} to ${target(move.stage ? updated.stage : undefined, move.group !== undefined ? updated.group : undefined)}.`;
        if (this.selected?.id === updated.id) this.selected = { ...this.selected, group: updated.group, stage: updated.stage, stageOrigin: updated.stageOrigin };
        return this.refreshSessions(true);
      })
      .catch((error: unknown) => {
        this.kanbanNotice = error instanceof Error ? error.message : "Could not move that session.";
        this.kanbanNoticeFailed = true;
      })
      .finally(() => {
        this.kanbanMovePendingId = "";
        // Keep focus on the moved card so keyboard moves can continue.
        void this.updateComplete.then(() => {
          this.renderRoot.querySelector<HTMLElement>(`.kanban-card[data-session-id="${CSS.escape(session.id)}"] .kanban-card__title`)?.focus();
        });
      });
  };

  /* ── Kanban backlog ── the server's merged view is the only source of the
   * Backlog column; nothing moves optimistically. */
  private async refreshBacklog(refresh = false) {
    const request = ++this.backlogRequest;
    this.backlogLoading = true;
    try {
      const view = await loadBacklog(refresh);
      if (request !== this.backlogRequest) return;
      this.backlog = view.items;
      this.backlogJira = view.jira;
      this.backlogError = "";
    } catch (error) {
      if (request === this.backlogRequest) this.backlogError = error instanceof Error ? error.message : "The backlog could not be loaded.";
    } finally {
      if (request === this.backlogRequest) this.backlogLoading = false;
    }
  }

  private setBacklogGroup = (item: BacklogItem, group: string) => {
    const current = !item.group || item.group === "ungrouped" ? "" : item.group;
    if (this.backlogPendingId || current === group) return;
    this.backlogPendingId = item.id;
    this.kanbanNotice = `Moving ${item.title} to ${sessionGroupLabel(group)}…`;
    this.kanbanNoticeFailed = false;
    void setBacklogItemGroup(item.id, group)
      .then((view) => {
        this.backlog = view.items;
        this.backlogJira = view.jira;
        this.kanbanNotice = `Moved ${item.title} to ${sessionGroupLabel(group)}.`;
      })
      .catch((error: unknown) => {
        this.kanbanNotice = error instanceof Error ? error.message : "Could not move that backlog item.";
        this.kanbanNoticeFailed = true;
      })
      .finally(() => { this.backlogPendingId = ""; });
  };

  private openBacklogStart = (item: BacklogItem, target: BacklogStartTarget) => {
    if (this.backlogPendingId) return;
    void import("./components/backlog-start-dialog.ts").then(() => { this.backlogStart = { item, target }; });
  };

  private backlogStarted = (session: SessionView, item: BacklogItem) => {
    this.backlogStart = undefined;
    this.kanbanNotice = `Started “${session.title}” from the backlog in ${SESSION_STAGE_LABELS[session.stage ?? DEFAULT_SESSION_STAGE]}.`;
    this.kanbanNoticeFailed = false;
    this.backlog = this.backlog.filter(({ id }) => id !== item.id);
    void this.refreshSessions(true);
    void this.refreshBacklog();
  };

  private renderBacklogStartDialog() {
    if (!this.backlogStart) return null;
    return html`<hui-backlog-start-dialog
      .item=${this.backlogStart.item}
      .target=${this.backlogStart.target}
      .branchPrefix=${this.settings.branchPrefix}
      .onClose=${() => { this.backlogStart = undefined; }}
      .onStarted=${this.backlogStarted}
    ></hui-backlog-start-dialog>`;
  }

  private backlogCardAction = (item: BacklogItem, action: BacklogCardAction) => {
    if (action === "open:jira") {
      if (item.jira) window.open(item.jira.url, "_blank", "noopener,noreferrer");
    } else if (action === "copy") {
      void writeClipboardText(backlogItemMarkdown(item)).then((copied) => {
        this.kanbanNotice = copied ? `Copied “${item.title}”.` : "Could not copy to the clipboard.";
        this.kanbanNoticeFailed = !copied;
      });
    } else if (action === "remove") {
      this.backlogRemove = item;
    } else if (action === "jira:create") {
      void import("./components/jira-create-dialog.ts").then(() => { this.jiraCreateBacklogItem = item; });
    } else if (action === "jira:link") {
      void import("./components/jira-link-dialog.ts").then(() => { this.jiraLinkBacklogItem = item; });
    }
  };

  private confirmBacklogRemove = (event: Event) => {
    event.preventDefault();
    const item = this.backlogRemove;
    if (!item || this.backlogPendingId) return;
    this.backlogPendingId = item.id;
    void removeBacklogItem(item.id)
      .then((view) => {
        this.backlog = view.items;
        this.backlogJira = view.jira;
        this.kanbanNotice = `Removed “${item.title}” from the backlog.`;
        this.kanbanNoticeFailed = false;
        this.backlogRemove = undefined;
      })
      .catch((error: unknown) => {
        this.kanbanNotice = error instanceof Error ? error.message : "Could not remove that task.";
        this.kanbanNoticeFailed = true;
        this.backlogRemove = undefined;
      })
      .finally(() => { this.backlogPendingId = ""; });
  };

  private renderBacklogRemoveDialog() {
    const item = this.backlogRemove;
    if (!item) return null;
    const close = () => { if (!this.backlogPendingId) this.backlogRemove = undefined; };
    return html`<dialog class="hui-modal-dialog group-action-dialog backlog-remove-dialog" aria-labelledby="backlog-remove-title"
      @cancel=${(event: Event) => { event.preventDefault(); close(); }}>
      <form class="exec-approval-card" method="dialog" @submit=${this.confirmBacklogRemove}>
        <div class="exec-approval-title" id="backlog-remove-title">Remove “${item.title}” from the backlog?</div>
        <div class="exec-approval-sub">The local task and its problem and fix notes are deleted. ${item.jira ? `The linked Jira work item ${item.jira.key} is not changed.` : ""}</div>
        <div class="exec-approval-actions">
          <button type="submit" class="btn danger" ?disabled=${Boolean(this.backlogPendingId)}>${this.backlogPendingId ? "Removing…" : "Remove"}</button>
          <button type="button" class="btn" @click=${close}>Cancel</button>
        </div>
      </form>
    </dialog>`;
  }

  private kanbanSessionAction = (session: SessionView, action: SessionCardAction) => {
    if (action === "open:jira") this.openSessionElsewhere(session, "jira");
    else if (action === "copy:jira") {
      const url = session.jiraIssues?.at(-1)?.url;
      void (url ? writeClipboardText(url) : Promise.resolve(false)).then((copied) => {
        this.kanbanNotice = copied ? "Jira link copied." : "Could not copy to the clipboard.";
        this.kanbanNoticeFailed = !copied;
      });
    } else if (action === "jira:create") this.openJiraCreate(session);
    else this.openJiraLink(session);
  };

  private saveSuggestionToBacklog = (suggestion: TaskSuggestion) => {
    const source = this.selected;
    if (!source || this.taskSuggestionPendingId) return;
    this.taskSuggestionPendingId = suggestion.id;
    void addSuggestionToBacklog(source.id, suggestion.id)
      .then((suggestions) => {
        if (this.selected?.id === source.id) {
          this.taskSuggestions = parseTaskSuggestions(suggestions);
          this.taskSuggestionIndex = clampSuggestionIndex(this.taskSuggestionIndex, this.taskSuggestions.length);
        }
        this.note = `Added “${suggestion.title}” to the Kanban backlog.`;
        this.noteLevel = "info";
      })
      .catch((error: unknown) => {
        this.note = error instanceof Error ? error.message : "Could not add that suggestion to the backlog.";
        this.noteLevel = "error";
      })
      .finally(() => { this.taskSuggestionPendingId = ""; });
  };

  /** The suggestion card needs to know whether Jira is connected; checked
   * once per page load, and again after the Integrations page changes it. */
  private ensureJiraConnectionKnown() {
    if (this.jiraConfigured !== undefined) return;
    this.jiraConfigured = false;
    void loadJiraConnection().then(
      (connection) => { this.jiraConfigured = connection.configured; },
      () => { this.jiraConfigured = false; },
    );
  }

  /** Reorders custom groups. OTHER as the target means "move to the end",
   * because it always renders last. The confirmed server order replaces the
   * local one; nothing is shown optimistically. */
  private reorderGroup = (group: string, target: GroupDropTarget) => {
    if (this.groupReorderPending) return;
    const order = customGroupOrder(this.groups);
    const next = target.group === "ungrouped"
      ? order.at(-1) === group || !order.includes(group) ? undefined : [...order.filter((label) => label !== group), group]
      : moveGroupLabel(order, group, target.group, target.position);
    this.draggingGroup = "";
    this.groupDropTarget = undefined;
    if (!next) return;
    this.groupMenuFor = "";
    this.groupReorderPending = true;
    this.sessionMoveNotice = `Moving ${sessionGroupLabel(group)}…`;
    this.sessionMoveFailed = false;
    void reorderSessionGroups(next)
      .then(({ revision, groups }) => {
        this.receiveSessionList(revision, groups);
        this.sessionMoveNotice = `Moved ${sessionGroupLabel(group)}.`;
      })
      .catch((error: unknown) => {
        this.sessionMoveNotice = error instanceof Error ? error.message : "Could not reorder the groups.";
        this.sessionMoveFailed = true;
        return this.refreshSessions(true);
      })
      .finally(() => {
        this.groupReorderPending = false;
      });
  };

  /** Deleting is destructive, so the sidebar action opens a confirmation
   * dialog in the active chat rather than deleting straight from a row. */
  private deleteFromMenu = (session: SessionView) => {
    this.menuFor = "";
    if (!this.embeddedPane) {
      void this.withSessionPane(session, (app) => app.deleteFromMenu(session));
      return;
    }
    this.deleteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.activateSession(session);
    this.deletingFor = session.id;
    this.deleteNeedsFocus = true;
  };

  /* ── sessions ─────────────────────────────────────────────────────────── */

  private selectSession = (session: SessionView) => {
    if (this.embeddedPane && this.onPaneNavigate) {
      this.onPaneNavigate(session.id);
      return;
    }
    // Choosing a conversation shows its chat; its Work pane stays one selector choice away on narrow screens.
    this.workNarrowShown = false;
    const existing = this.sessionLayout && sessionPanes(this.sessionLayout).find((pane) => isChatPane(pane) && pane.sessionId === session.id);
    if (existing && this.sessionLayout) this.sessionLayout = focusSessionPane(this.sessionLayout, existing.id);
    this.navigate({ kind: "session", id: session.id });
  };

  private openSplitSession = (session: SessionView) => {
    if (this.embeddedPane || !this.selected) return;
    const layout = this.sessionLayout ?? singleSessionLayout(this.selected.id);
    this.commitSessionLayout(splitSessionPane(layout, layout.activePaneId, session.id, "right"));
  };

  private persistSessionLayout() {
    try {
      if (this.sessionLayout && (sessionPanes(this.sessionLayout).length > 1 || sessionPanes(this.sessionLayout).some((pane) => !isChatPane(pane)))) {
        localStorage.setItem(SESSION_LAYOUT_KEY, JSON.stringify(this.sessionLayout));
      } else localStorage.removeItem(SESSION_LAYOUT_KEY);
    } catch { /* The current view still works if browser storage is unavailable. */ }
  }

  private commitSessionLayout(layout: SessionLayout, replace = true) {
    this.sessionLayout = layout;
    const id = activeSessionPane(layout).sessionId;
    this.selected = this.groups.flatMap((group) => group.sessions).find((session) => session.id === id);
    this.pendingSessionId = this.selected ? "" : id;
    this.view = "home";
    this.activePage = undefined;
    this.settingsOpen = false;
    this.persistSessionLayout();
    window.history[replace ? "replaceState" : "pushState"](
      { ...window.history.state, huiSessionLayout: layout }, "", navigationPath({ kind: "session", id }),
    );
  }

  private focusSessionPane = (id: string) => {
    if (!this.sessionLayout || this.sessionLayout.activePaneId === id) return;
    this.commitSessionLayout(focusSessionPane(this.sessionLayout, id));
  };

  private splitPane = (pane: SessionPane, direction: SplitDirection) => {
    if (this.sessionLayout) this.commitSessionLayout(splitSessionPane(this.sessionLayout, pane.id, pane.sessionId, direction));
  };

  /* ── Work pane ────────────────────────────────────────────────────────── */

  /** Registers the built-in Work view kinds, reads the browser-local record and follows the narrow breakpoint. */
  private setupWorkPane() {
    registerWorkViewKind(terminalWorkViewKind({
      fontFamily: () => this.settings.fontTerminal,
      unavailable: (sessionId) => sessionId && this.listedSession(sessionId)?.worker
        ? "Terminals run on this gateway's machine; this conversation runs on a remote worker."
        : undefined,
    }));
    registerWorkViewKind(browserWorkViewKind({ enabled: () => this.settings.browser.enabled }));
    try { this.workPanes = parseWorkPaneStore(JSON.parse(localStorage.getItem(WORK_PANE_KEY) ?? "null")); } catch { this.workPanes = {}; }
    this.workMedia = window.matchMedia(SESSION_SPLIT_MEDIA);
    this.workNarrow = this.workMedia.matches;
    this.workMedia.addEventListener("change", this.onWorkMediaChange);
  }

  private persistWorkPanes() {
    try { localStorage.setItem(WORK_PANE_KEY, JSON.stringify(serializeWorkPaneStore(this.workPanes))); }
    catch { /* The pane still works for this page if browser storage is unavailable. */ }
  }

  private commitWorkPanes(store: WorkPaneStore) {
    if (store === this.workPanes) return;
    this.workPanes = store;
    this.persistWorkPanes();
  }

  /** The conversation the Work pane follows: the focused chat pane's. */
  private workSessionId(): string | undefined {
    if (this.embeddedPane || this.view !== "home" || this.settingsOpen || !this.selected || !this.sessionLayout) return undefined;
    return activeSessionPane(this.sessionLayout).sessionId;
  }

  private workPaneElement(): WorkPane | null {
    return this.renderRoot.querySelector<WorkPane>("hui-work-pane");
  }

  /** Shows `ref` in its conversation's Work pane, focusing that conversation's chat pane and expanding the pane (or,
   * on narrow screens, opening the Work destination). */
  private showWorkView(sessionId: string, ref: WorkViewRef, launched = false) {
    const layout = this.sessionLayout;
    if (layout && activeSessionPane(layout).sessionId !== sessionId) {
      const chat = sessionPanes(layout).find((pane) => isChatPane(pane) && pane.sessionId === sessionId);
      if (chat) this.commitSessionLayout(focusSessionPane(layout, chat.id));
    }
    const key = workViewKey(ref);
    if (launched) this.workLaunchedKey = key;
    this.workError = "";
    this.commitWorkPanes(openWorkView(this.workPanes, sessionId, ref));
    if (this.workNarrow) this.workNarrowShown = true;
    else this.workPaneElement()?.reveal(sessionId);
    // Views that do not take focus themselves leave it on their tab.
    if (!launched || ref.kind !== "terminal") void this.updateComplete.then(() => this.workPaneElement()?.focusPane("active"));
  }

  /** The chat header's **Open terminal**: the conversation's open terminal tab, else its first running terminal,
   * else a new one. */
  private openTerminalWorkView = async (pane: SessionPane) => {
    const open = sessionWorkPane(this.workPanes, pane.sessionId).views.find((view) => view.kind === "terminal");
    if (open) { this.showWorkView(pane.sessionId, open); return; }
    const running = (await listTerminals(pane.sessionId)).find(({ status }) => status === "running");
    const terminal = running ?? await createTerminal(pane.sessionId);
    this.showWorkView(pane.sessionId, { kind: "terminal", terminalId: terminal.id }, !running);
  };

  /** The chat's inline browser preview and header globe open (or focus) the conversation's one browser view. */
  private openBrowserWorkView = (pane: SessionPane) => {
    this.showWorkView(pane.sessionId, { kind: "browser" });
  };

  /** A launcher in the Work pane ("+" menu, empty state, shortcut) for the focused conversation. */
  private launchWorkView = async (kindName: string) => {
    const sessionId = this.workSessionId();
    const kind = workViewKind(kindName);
    if (!sessionId || !kind || this.workLaunching) return;
    const reason = kind.unavailable?.(sessionId);
    if (reason) { this.workError = reason; this.revealWorkPane(sessionId); return; }
    this.workLaunching = kindName;
    this.workError = "";
    try {
      const ref = await kind.create(sessionId);
      this.showWorkView(sessionId, ref, true);
    } catch (error) {
      this.workError = error instanceof Error ? error.message : `Could not open ${kind.label}.`;
      this.revealWorkPane(sessionId);
    } finally {
      this.workLaunching = "";
    }
  };

  private revealWorkPane(sessionId: string) {
    this.commitWorkPanes(setWorkPaneOpen(this.workPanes, sessionId, true));
    if (this.workNarrow) this.workNarrowShown = true;
    else this.workPaneElement()?.reveal(sessionId);
  }

  private toggleWorkPane() {
    const sessionId = this.workSessionId();
    if (!sessionId) return;
    if (this.workNarrow) {
      this.workNarrowShown = !this.workNarrowShown;
      if (this.workNarrowShown) void this.updateComplete.then(() => this.workPaneElement()?.focusPane("active"));
      else this.focusActiveComposer();
      return;
    }
    // Collapsed to its rail for lack of room counts as hidden: the shortcut shows it anyway.
    const element = this.workPaneElement();
    const open = !(element?.expanded ?? sessionWorkPane(this.workPanes, sessionId).open);
    if (open && element) { element.expand(); return; }
    this.commitWorkPanes(setWorkPaneOpen(this.workPanes, sessionId, open));
    if (open) void this.updateComplete.then(() => this.workPaneElement()?.focusPane("active"));
    else this.focusActiveComposer();
  }

  /** Escape inside the pane, or **Back to chat**: return to the conversation without touching its turn. */
  private leaveWorkPane = () => {
    if (this.workNarrow) this.workNarrowShown = false;
    this.focusActiveComposer();
  };

  private focusActiveComposer() {
    void this.updateComplete.then(() => {
      const app = this.activePaneApp();
      const target = app?.querySelector<HTMLElement>("textarea") ?? app?.querySelector<HTMLElement>(".chat-pane__header");
      target?.focus({ preventScroll: true });
    });
  }

  /** Launcher shortcuts and the pane toggle, while a conversation is shown and nothing modal is open. */
  private readonly onWorkShortcut = (event: KeyboardEvent) => {
    if (!event.altKey || !this.workSessionId() || this.commandPaletteOpen || document.querySelector("dialog[open]")) return;
    if (matchesShortcut(event, WORK_PANE_TOGGLE_SHORTCUT)) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleWorkPane();
      return;
    }
    const kind = workViewKinds().find((candidate) => candidate.shortcut && matchesShortcut(event, candidate.shortcut));
    if (!kind) return;
    event.preventDefault();
    event.stopPropagation();
    void this.launchWorkView(kind.kind);
  };

  private openTerminal = async () => {
    this.terminalOpening = true;
    this.terminalError = "";
    try { await this.onPaneTerminal?.(); }
    catch (error) { this.terminalError = error instanceof Error ? error.message : "Could not open terminal."; }
    finally { this.terminalOpening = false; }
  };

  private closePane = (paneId: string) => {
    if (!this.sessionLayout) return;
    const next = closeSessionPane(this.sessionLayout, paneId);
    if (next === this.sessionLayout) return;
    this.commitSessionLayout(next);
    void this.updateComplete.then(() => this.renderRoot.querySelector<SessionMultiplexer>("hui-session-multiplexer")?.updateComplete).then(() => {
      this.activePaneApp()?.querySelector<HTMLElement>(".chat-pane__header")?.focus({ preventScroll: true });
    });
  };

  private dropSession = (id: string, paneId: string, zone: DropZone) => {
    if (!this.sessionLayout || !this.groups.some((group) => group.sessions.some((session) => session.id === id))) return;
    this.draggingSessionId = "";
    this.commitSessionLayout(zone.kind === "center"
      ? replacePaneSession(focusSessionPane(this.sessionLayout, paneId), paneId, id)
      : zone.kind === "tab" ? addSessionTab(this.sessionLayout, paneId, id)
        : splitSessionPane(this.sessionLayout, paneId, id, zone.edge));
  };

  private movePane = (sourceId: string, targetId: string, zone: DropZone) => {
    if (this.sessionLayout) this.commitSessionLayout(moveSessionPane(this.sessionLayout, sourceId, targetId, zone));
  };

  private changePaneSession = (paneId: string, id: string) => {
    if (this.sessionLayout) this.commitSessionLayout(replacePaneSession(focusSessionPane(this.sessionLayout, paneId), paneId, id), false);
  };

  private activePaneApp(): HuiApp | undefined {
    const id = this.sessionLayout?.activePaneId;
    return id ? this.renderRoot.querySelector<HuiApp>(
      `[data-session-pane="${CSS.escape(id)}"] .chat-pane-cache__pane--visible > hui-app`,
    ) ?? undefined : undefined;
  }

  private async withSessionPane(session: SessionView, action: (app: HuiApp) => void) {
    this.selectSession(session);
    await this.updateComplete;
    await this.renderRoot.querySelector<SessionMultiplexer>("hui-session-multiplexer")?.updateComplete;
    const app = this.activePaneApp();
    if (app) {
      await app.updateComplete;
      action(app);
    }
  }

  private activateSession(session: SessionView) {
    if (!this.embeddedPane) {
      this.selected = session;
      this.view = "home";
      this.sessionLayout ??= singleSessionLayout(session.id);
      return;
    }
    if (session.id === this.selected?.id) {
      // Already selected, including while its open request is pending. Starting
      // a duplicate would race two responses and two event subscriptions.
      this.view = "home";
      return;
    }
    this.resetSessionEphemeral();
    this.switchComposerDraft(sessionDraftKey(session.id));
    this.view = "home";
    this.selected = session;
    void this.openSelected(session.id);
  }

  /** Opens (starting a runtime if needed) and begins streaming. */
  private async openSelected(id: string) {
    const requestToken = ++this.openRequestToken;
    this.streamStop?.();
    this.streamStop = undefined;
    this.opening = true;
    this.openError = "";
    this.streaming = false;
    this.transcript = [];
    this.subagents = [];
    this.taskSuggestions = [];
    this.taskSuggestionIndex = 0;
    this.watchers = [];
    this.watcherPendingId = "";
    this.watcherLog = null;
    this.note = "";
    this.noteLevel = "info";
    this.connectionNote = "";
    this.models = [];
    this.currentModel = undefined;
    this.usage = undefined;
    this.compaction = undefined;
    this.modelsRequestedFor = "";
    this.resetCommands();
    // Nothing to open until the gateway has created the worktree session.
    if (this.paneCreating || this.paneCreationError) {
      if (this.paneCreationError && this.selected) this.selected = { ...this.selected, status: "error" };
      this.opening = false;
      return;
    }
    try {
      const opened = await openSession(id);
      if (!isCurrentSessionRequest(id, this.selected?.id, requestToken, this.openRequestToken)) {
        // A different session or a newer retry won while this was starting.
        return;
      }
      this.selected = opened.session;
      this.applySnapshot(opened.snapshot ?? {
        transcript: opened.transcript,
        status: opened.session.status,
        queue: EMPTY_QUEUE,
        questions: [],
        subagents: [],
      });
      this.thinking = opened.snapshot?.thinking ?? opened.session.thinking ?? "medium";
      this.streaming = streamingForStatus(opened.session.status);
      this.connection = "live";
      this.startStream(id);
      this.requestModelsWhenReady(id, opened.session.status);
    } catch (error) {
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.openRequestToken)) {
        // In place of the conversation, which never arrived: an empty transcript
        // would read as a session with nothing in it.
        this.openError = error instanceof Error ? error.message : "Could not open that session.";
      }
    } finally {
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.openRequestToken)) {
        this.opening = false;
        this.flushPendingLaunchPrompt();
      }
    }
  }

  private startStream(id: string) {
    // An older attempt may have installed a stream while a newer open request
    // was pending. Replacing it is an ownership transfer, so close it first.
    this.streamStop?.();
    const current = () => this.selected?.id === id;
    this.streamStop = subscribeSession(id, {
      onSnapshot: (snapshot) => {
        if (current()) this.applySnapshot(snapshot);
      },
      onTranscript: (entries) => {
        if (current()) {
          this.transcript = normalizeTranscript(entries);
        }
      },
      onEvent: (event) => {
        if (current()) {
          this.applyEvent(event);
        }
      },
      onStatus: (status) => {
        if (current()) {
          this.setStatus(status);
        }
      },
      onModel: (model) => {
        if (current()) {
          this.currentModel = model;
        }
      },
      onThinking: (level) => {
        if (current()) this.thinking = level;
      },
      onConnection: (state, detail) => {
        if (!current()) {
          return;
        }
        this.connection = state;
        if (state !== "live") this.resetCommands();
        this.connectionNote = state === "live" ? "" : detail || "Reconnecting…";
        if (state === "stopped") {
          this.streaming = false;
        }
      },
    });
  }

  private applySnapshot(snapshot: SessionSnapshot) {
    this.transcript = normalizeTranscript(snapshot.transcript, {
      streaming: streamingForStatus(snapshot.status),
    });
    this.queue = snapshot.queue;
    if (this.queueEditingId && !snapshot.queue.items?.some((item) => item.id === this.queueEditingId)) {
      this.queueEditingId = "";
      this.queueEditingText = "";
    }
    const previousTasks = this.subagents.map((task) => `${task.sessionId}:${task.status}:${task.updatedAt}`).join("|");
    this.subagents = snapshot.subagents ?? [];
    this.scheduleSubagentExpiry();
    const nextTasks = this.subagents.map((task) => `${task.sessionId}:${task.status}:${task.updatedAt}`).join("|");
    const previousFirst = this.taskSuggestions[0]?.id;
    this.taskSuggestions = parseTaskSuggestions(snapshot.suggestions);
    if (this.taskSuggestions.length) this.ensureJiraConnectionKnown();
    this.watchers = parseWatchers(snapshot.watchers);
    const logged = this.watchers.find(({ id }) => id === this.watcherLog?.id);
    if (this.watcherLog && !logged) this.watcherLog = null;
    // An opened row follows new output without a refresh button.
    else if (logged && !this.watcherLog?.loading && logged.lastLine !== (this.watcherLog?.lines.findLast((line) => line.trim()) ?? "").trim()) {
      this.viewWatcherLog(logged);
    }
    // A newly flagged follow-up is shown first; otherwise keep the operator's place.
    this.taskSuggestionIndex = this.taskSuggestions[0]?.id !== previousFirst
      ? 0
      : clampSuggestionIndex(this.taskSuggestionIndex, this.taskSuggestions.length);
    if (previousTasks !== nextTasks) void this.refreshSessions();
    const question = snapshot.questions[0];
    if (question) this.showQuestion(question);
    else if (this.question) {
      this.question = undefined;
      this.restoreQuestionFocus();
    }
    if (snapshot.model) this.currentModel = snapshot.model;
    this.usage = snapshot.usage;
    this.compaction = snapshot.compaction;
    if (snapshot.thinking) this.thinking = snapshot.thinking;
    this.setStatus(snapshot.status);
  }

  /** OpenClaw keeps finished background tasks visible briefly. Schedule the
   * render that removes the final recent row even if the session stays idle. */
  private scheduleSubagentExpiry(): void {
    if (this.subagentExpiryTimer !== undefined) window.clearTimeout(this.subagentExpiryTimer);
    this.subagentExpiryTimer = undefined;
    const now = Date.now();
    const nextExpiry = this.subagents
      .filter((task) => task.status !== "starting" && task.status !== "running")
      .map((task) => Date.parse(task.endedAt ?? task.updatedAt) + 60_000)
      .filter((expiry) => Number.isFinite(expiry) && expiry > now)
      .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;
    this.subagentExpiryTimer = window.setTimeout(() => {
      this.subagentExpiryTimer = undefined;
      this.requestUpdate();
      this.scheduleSubagentExpiry();
    }, nextExpiry - now + 16);
  }

  private applyEvent(event: RuntimeEvent) {
    if (event.type === "queue_update") {
      this.queue = event.queue;
      return;
    }
    if (event.type === "question") {
      this.showQuestion(event.question);
      return;
    }
    if (event.type === "thinking_level") {
      this.thinking = event.level;
      return;
    }
    if (event.type === "notice") {
      this.note = event.message;
      this.noteLevel = event.level ?? "info";
      this.recoveryNotice = this.noteLevel === "warning" ? event.message : "";
      return;
    }
    if (event.type === "settled" || event.type === "error") {
      ({ note: this.note, noteLevel: this.noteLevel } = noteAfterRunOutcome({ note: this.note, noteLevel: this.noteLevel }, this.recoveryNotice));
      this.recoveryNotice = "";
    }
    switch (event.type) {
      case "text":
      case "thinking":
      case "tool_start":
      case "tool_update":
      case "tool_end":
      case "error":
        this.transcript = reduceTranscript(this.transcript, event);
        break;
      case "turn_start":
        this.streaming = streamingAfterEvent(this.streaming, event.type);
        if (this.compaction?.status !== "running") this.compaction = undefined;
        break;
      case "compaction_start":
        this.compaction = {
          status: "running",
          reason: event.reason,
          ...(event.blocking === false ? { blocking: false as const } : {}),
          ...(event.background ? { background: true as const } : {}),
        };
        break;
      case "compaction_end":
        // A written summary arrives with the refreshed history as a marker.
        this.compaction = event.outcome === "done" ? undefined
          : { status: event.outcome, reason: event.reason, ...(event.message ? { message: event.message } : {}) };
        break;
      case "turn_end":
        // pi emits turn_end before agent_end. The following status frame is
        // authoritative; unlocking here would accept a prompt PI still rejects.
        this.streaming = streamingAfterEvent(this.streaming, event.type);
        break;
      case "settled":
        // `settled` explains why the next status may become idle, but the
        // status SSE remains the single authority that unlocks the composer.
        this.streaming = streamingAfterEvent(this.streaming, event.type);
        break;
    }
  }

  private setStatus(status: SessionStatus) {
    if (!this.selected) {
      return;
    }
    const id = this.selected.id;
    const interrupted = status === "running" || status === "waiting"
      ? undefined
      : this.selected.interrupted;
    this.selected = { ...this.selected, status, interrupted };
    // The stream is the source of truth for a resumed or reconnected session,
    // so the composer lock follows the status rather than only turn events.
    this.streaming = streamingForStatus(status);
    if (status !== "running" && status !== "waiting") this.stopping = false;
    this.requestModelsWhenReady(id, status);
    if (status === "idle") {
      this.flushPendingLaunchPrompt();
    } else if ((status === "error" || status === "reconnecting" || status === "disconnected") && this.pendingLaunchPrompt) {
      this.composerDraftEdit += 1;
      this.setDraft(this.pendingLaunchPrompt);
      this.attachments = this.pendingLaunchAttachments;
      this.pendingLaunchPrompt = "";
      this.pendingLaunchAttachments = [];
      void this.persistComposerDraft();
    }
    // Keep the sidebar dot honest without a full re-fetch.
    this.groups = this.groups.map((group) => ({
      ...group,
      sessions: group.sessions.map((session) =>
        session.id === id ? { ...session, status, interrupted } : session,
      ),
    }));
  }

  private persistComposerDraft(
    key = this.composerDraftKey,
    text = this.draft,
    attachments: readonly Attachment[] = this.attachments,
  ) {
    if (!mayUseComposerDraftKey(this.embeddedPane, key)) return;
    const sessionId = sessionIdFromDraftKey(key);
    if (sessionId) {
      const hasDraft = Boolean(text || attachments.length);
      this.markSessionDraft(sessionId, hasDraft);
      if (this.embeddedPane) this.onPaneDraftChange?.(sessionId, hasDraft);
    }
    return writeComposerDraft(key, { text, attachments });
  }

  private markSessionDraft(sessionId: string, hasDraft: boolean) {
    if (this.draftSessionIds.has(sessionId) === hasDraft) return;
    const next = new Set(this.draftSessionIds);
    hasDraft ? next.add(sessionId) : next.delete(sessionId);
    this.draftIndicatorRevision += 1;
    this.draftSessionIds = next;
  }

  private refreshDraftIndicators() {
    const revision = this.draftIndicatorRevision;
    void listComposerDraftSessionIds().then((sessionIds) => {
      if (revision === this.draftIndicatorRevision) this.draftSessionIds = new Set(sessionIds);
    });
  }

  private switchComposerDraft(key: string) {
    if (!mayUseComposerDraftKey(this.embeddedPane, key)) return;
    if (key === this.composerDraftKey && this.composerDraftHydrated) return;
    if (key !== this.composerDraftKey) void this.persistComposerDraft();
    this.composerDraftKey = key;
    this.composerDraftHydrated = true;
    const load = ++this.composerDraftLoad;
    const edit = ++this.composerDraftEdit;
    this.setDraft("");
    this.attachments = [];
    void readComposerDraft(key).then((draft) => {
      if (load !== this.composerDraftLoad || edit !== this.composerDraftEdit || key !== this.composerDraftKey) return;
      this.setDraft(draft.text);
      this.attachments = draft.attachments;
    });
  }

  /** A keystroke. The textarea already shows this text, so the value itself
   * needs no update; only what the draft makes the composer show (Send/Stop
   * instead of nothing to send) does, and that flips at most twice per message. */
  private typeDraft = (draft: string) => {
    const hadText = this.draft.trim() !== "";
    this.composerDraftEdit += 1;
    this.draft = draft;
    if ((draft.trim() !== "") !== hadText) this.requestUpdate();
    void this.persistComposerDraft();
  };

  /** A draft HUI set, not one typed into the textarea: it has to reach the
   * value, the controls derived from it and the textarea's measured height. */
  private setDraft(draft: string) {
    this.draft = draft;
    this.draftRevision += 1;
  }

  private updateDraft = (draft: string) => {
    this.composerDraftEdit += 1;
    this.setDraft(draft);
    void this.persistComposerDraft();
  };

  /** The ChatGPT login GPT-Live calls use; a read under way is shared. A failed read leaves Call hidden. */
  private loadCallsStatus(): Promise<void> {
    this.callsStatusLoading ??= loadCallsStatus().then(
      (status) => { this.callsStatus = status; },
      () => { this.callsStatus = undefined; },
    ).finally(() => { this.callsStatusLoading = undefined; });
    return this.callsStatusLoading;
  }

  /** Call shows whenever GPT-Live can run: with a ChatGPT login. */
  private callsAvailable(): boolean {
    return callsReady(this.callsStatus);
  }

  private isUpdateSession(session: SessionView | undefined): boolean {
    return session?.title === HUI_UPDATE_SESSION_TITLE && session.group === "";
  }

  /** Update is an HUI operation, but it still gets a durable, retryable home
   * in the session list. The session is opened without an initial prompt: the
   * visible `/update` stays in its composer and is never sent to PI. */
  private async openUpdateSession(command: "update" | "check"): Promise<boolean> {
    const draft = command === "check" ? "/update --check" : "/update";
    const activeSessionView = this.view === "home" && this.activePage === undefined && !this.settingsOpen;
    const sourceOwner = !this.embeddedPane && activeSessionView ? this.activePaneApp() ?? this : this;
    if (activeSessionView && this.isUpdateSession(this.selected)) {
      sourceOwner.updateDraft(draft);
      return true;
    }
    if (this.updateSessionCreating) return false;
    const sourceDraftKey = sourceOwner.composerDraftKey;
    const sourceDraft = sourceOwner.draft;
    const activeSession = activeSessionView ? this.selected : undefined;
    this.updateSessionCreating = true;
    try {
      const session = await createSession({
        cwd: activeSession?.cwd || this.launchDefaults?.cwd || "~/",
        title: HUI_UPDATE_SESSION_TITLE,
        group: "",
      });
      await this.refreshSessions();
      const refreshed = this.groups.flatMap((group) => group.sessions).find((candidate) => candidate.id === session.id) ?? session;
      // The command was consumed by HUI, not by the source session. Remove
      // only that exact command draft; an unrelated draft from Review update
      // must survive the session switch.
      if (sourceOwner.composerDraftKey === sourceDraftKey && sourceOwner.draft === sourceDraft && sourceDraft.trim() === draft) {
        sourceOwner.composerDraftEdit += 1;
        sourceOwner.setDraft("");
        void sourceOwner.persistComposerDraft(sourceDraftKey, "", []);
      }
      this.resetSessionEphemeral();
      if (this.embeddedPane) this.switchComposerDraft(sessionDraftKey(refreshed.id));
      this.view = "home";
      this.selected = refreshed;
      this.navigate({ kind: "session", id: refreshed.id });
      if (this.embeddedPane) {
        await this.persistComposerDraft(sessionDraftKey(refreshed.id), draft, []);
      } else await this.withSessionPane(refreshed, (app) => app.updateDraft(draft));
      return true;
    } catch (error) {
      this.note = error instanceof Error ? error.message : "Could not create the HUI update session.";
      this.noteLevel = "error";
      return false;
    } finally {
      this.updateSessionCreating = false;
    }
  }

  private handleUpdateCommand(text: string, attachments: readonly Attachment[] = []): boolean {
    const command = parseUpdateCommand(text);
    if (!command) return false;
    if (command === "invalid" || attachments.length) {
      this.note = "Use /update or /update --check, without attachments. This command is handled by HUI, not the model.";
      this.noteLevel = "error";
      return true;
    }
    if (this.embeddedPane && this.onPaneUpdate) return this.onPaneUpdate(text, attachments);
    this.note = "";
    this.noteLevel = "info";
    this.slashQuery = null;
    this.updateReturnFocus = this.composerTextarea;
    this.updateReadOnly = command === "check";
    void this.openUpdateSession(command).then((opened) => {
      if (!opened) return;
      this.updateOpen = true;
      void this.checkForUpdates();
    });
    return true;
  }

  private reviewUpdate = () => {
    this.updateReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.updateReadOnly = false;
    void this.openUpdateSession("update").then((opened) => {
      if (!opened) return;
      this.updateOpen = true;
      void this.checkForUpdates();
    });
  };

  private checkForUpdates = async () => {
    if (this.updateChecking || this.updateStarting) return;
    this.updateChecking = true;
    this.updateError = "";
    this.updateReconnecting = false;
    try {
      this.updateSnapshot = await loadUpdate();
      if (this.updateSnapshot.job?.status === "running") this.beginUpdatePolling();
      else this.updateSnapshot = await checkUpdate();
    } catch (error) { this.updateError = error instanceof Error ? error.message : "Could not check for updates."; }
    finally { this.updateChecking = false; }
  };

  private installHuiUpdate = async () => {
    const version = this.updateSnapshot?.check?.latest?.version;
    if (!version || !this.updateSnapshot?.check?.canInstall || this.updateReadOnly || this.updateStarting) return;
    this.updateStarting = true;
    this.updateError = "";
    try {
      this.updateSnapshot = await installUpdate(version);
      this.beginUpdatePolling();
    } catch (error) { this.updateError = error instanceof Error ? error.message : "Could not start the update."; }
    finally { this.updateStarting = false; }
  };

  private beginUpdatePolling() {
    if (this.updatePollTimer !== undefined) window.clearTimeout(this.updatePollTimer);
    this.updatePollDeadline = Date.now() + 10 * 60_000;
    if (this.updateOpen) this.updatePollTimer = window.setTimeout(() => void this.pollUpdate(), 1000);
  }

  private async pollUpdate() {
    if (!this.updateOpen) return;
    try {
      this.updateSnapshot = await loadUpdate();
      this.updateReconnecting = false;
      if (this.updateSnapshot.job?.status !== "running") return;
    } catch { this.updateReconnecting = true; }
    if (Date.now() >= this.updatePollDeadline) {
      this.updateError = "The update has not reported completion. Check hui gateway status and logs, then reopen /update.";
      return;
    }
    if (this.updateOpen) this.updatePollTimer = window.setTimeout(() => void this.pollUpdate(), 1000);
  }

  private closeUpdate = () => {
    closeModal(this.renderRoot.querySelector<HTMLDialogElement>(".hui-update-dialog") ?? undefined);
    this.updateOpen = false;
    if (this.updatePollTimer !== undefined) window.clearTimeout(this.updatePollTimer);
    if (this.updateReturnFocus?.isConnected) this.updateReturnFocus.focus();
    else this.composerTextarea?.focus();
    this.updateReturnFocus = null;
    this.updateMonitor?.refresh();
  };

  private updateDialog() {
    return renderUpdateDialog({ open: this.updateOpen, checking: this.updateChecking, starting: this.updateStarting,
      readOnly: this.updateReadOnly, error: this.updateError, reconnecting: this.updateReconnecting, snapshot: this.updateSnapshot,
      onCheck: () => void this.checkForUpdates(), onInstall: () => void this.installHuiUpdate(), onClose: this.closeUpdate,
      onReload: () => window.location.reload() });
  }

  private resetCommands() {
    this.commandsRequest += 1;
    this.commands = [];
    this.commandsLoaded = false;
    this.commandsLoading = false;
    this.commandsError = "";
    this.slashQuery = null;
    this.slashActiveIndex = 0;
  }

  private resetLocalPaths() {
    this.localPathsRequest += 1;
    // Typing text that opens no `@` mention repeats this reset on every
    // keystroke, and reassigning the values it already holds would schedule a
    // second full app render alongside the draft's own update.
    if (this.localPathQuery === null && this.localPaths.length === 0 && !this.localPathsLoading
      && this.localPathsError === "" && this.localPathActiveIndex === 0 && this.localPathCwd === "") {
      return;
    }
    this.localPathQuery = null;
    this.localPaths = [];
    this.localPathsLoading = false;
    this.localPathsError = "";
    this.localPathActiveIndex = 0;
    this.localPathCwd = "";
  }

  private requestCommands = () => {
    const session = this.selected;
    if (!session || session.status === "starting" || session.status === "error" || this.commandsLoading) return;
    const request = ++this.commandsRequest;
    const current = () => this.selected?.id === session.id && request === this.commandsRequest;
    const returnFocus = document.activeElement?.closest(".slash-menu") !== null;
    this.commandsLoading = true;
    this.commandsError = "";
    void loadCommands(session.id).then((commands) => {
      if (!current()) return;
      this.commands = commands;
      this.commandsLoaded = true;
      this.slashActiveIndex = 0;
      if (returnFocus) void this.updateComplete.then(() => {
        if (current() && this.slashQuery !== null) this.composerTextarea?.focus();
      });
    }).catch((error: unknown) => {
      if (current()) this.commandsError = error instanceof Error ? error.message : "Could not load commands.";
    }).finally(() => {
      if (current()) this.commandsLoading = false;
    });
  };

  private setCommandQuery = (query: string | null) => {
    // Assigning an equal value still schedules a Lit update, and this runs on
    // every keystroke: only a changed query may schedule one.
    if (query !== this.slashQuery) {
      this.slashActiveIndex = 0;
      this.slashQuery = query;
    }
    if (query !== null && !this.commandsLoaded && !this.commandsError) this.requestCommands();
  };

  private selectSlashCommand = (command: ComposerCommand) => {
    const completed = completeCommandReference(this.draft, command, this.commands);
    this.updateDraft(completed.text);
    this.resetLocalPaths();
    this.slashQuery = null;
    void this.updateComplete.then(() => {
      const textarea = this.composerTextarea;
      if (!textarea) return;
      textarea.value = completed.text;
      textarea.focus();
      textarea.setSelectionRange(completed.caret, completed.caret);
    });
  };

  private commandKeydown = (event: KeyboardEvent) => {
    if (this.slashQuery === null || event.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
    const commands = filterSlashCommands(this.slashQuery?.startsWith("$") ? this.commands : composerCommands(this.selected ? this.commands : [], !!this.selected, Boolean(this.selected?.bot)), this.slashQuery);
    const paths = this.localPathQuery ? this.localPaths : [];
    const count = commands.length + paths.length;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.slashQuery = null;
      this.resetLocalPaths();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if ((this.commandsLoading || this.localPathsLoading) && !count && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      return;
    }
    if (!count) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.slashActiveIndex = (this.slashActiveIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
      void this.updateComplete.then(() => this.renderRoot.querySelector('.slash-menu [aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" || event.key === "Tab") {
      const command = commands[this.slashActiveIndex];
      if (command) {
        event.preventDefault();
        this.selectSlashCommand(command);
      } else {
        const path = paths[this.slashActiveIndex - commands.length];
        if (path) { event.preventDefault(); this.selectLocalPath(path); }
      }
    }
  };

  private setLocalPathQuery = (query: LocalPathQuery | null, cwd?: string) => {
    if (!query) {
      this.resetLocalPaths();
      return;
    }
    const workspace = this.selected?.cwd || cwd?.trim() || this.launchDefaults?.cwd || "~/";
    const sameQuery = this.localPathQuery?.input === query.input
      && this.localPathQuery.start === query.start
      && this.localPathQuery.end === query.end
      && this.localPathQuery.mention === query.mention
      && this.localPathCwd === workspace;
    this.localPathQuery = query;
    this.localPathCwd = workspace;
    if (sameQuery && (this.localPathsLoading || this.localPaths.length > 0 || this.localPathsError)) return;
    this.localPathActiveIndex = 0;
    this.slashActiveIndex = 0;
    this.localPaths = [];
    const request = ++this.localPathsRequest;
    this.localPathsLoading = true;
    this.localPathsError = "";
    void loadLocalPathSuggestions(workspace, query.input).then((paths) => {
      if (request !== this.localPathsRequest) return;
      this.localPaths = paths;
    }).catch((error: unknown) => {
      if (request !== this.localPathsRequest) return;
      this.localPaths = [];
      this.localPathsError = error instanceof Error ? error.message : "Could not load local paths.";
    }).finally(() => {
      if (request === this.localPathsRequest) this.localPathsLoading = false;
    });
  };

  private retryLocalPaths = () => {
    const query = this.localPathQuery;
    const cwd = this.localPathCwd;
    this.resetLocalPaths();
    if (query) this.setLocalPathQuery(query, cwd);
  };

  private selectLocalPath = (suggestion: LocalPathSuggestion) => {
    const query = this.localPathQuery;
    if (!query) return;
    this.slashQuery = null;
    const completed = completeLocalPath(this.draft, query, suggestion);
    this.updateDraft(completed.text);
    if (suggestion.kind === "directory") {
      this.setLocalPathQuery({
        input: suggestion.path,
        start: query.start,
        end: completed.caret,
        mention: query.mention,
      }, this.localPathCwd);
    } else {
      this.resetLocalPaths();
    }
    void this.updateComplete.then(() => {
      const textarea = this.composerTextarea;
      if (!textarea) return;
      textarea.value = completed.text;
      textarea.focus();
      textarea.setSelectionRange(completed.caret, completed.caret);
      if (suggestion.kind === "file") {
        requestAnimationFrame(() => this.resetLocalPaths());
      }
    });
  };

  private localPathKeydown = (event: KeyboardEvent) => {
    if (this.slashQuery !== null || !this.localPathQuery || event.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.resetLocalPaths();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (this.localPathsLoading && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      return;
    }
    if (!this.localPaths.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.localPathActiveIndex = (this.localPathActiveIndex + (event.key === "ArrowDown" ? 1 : -1) + this.localPaths.length) % this.localPaths.length;
      void this.updateComplete.then(() => this.renderRoot.querySelector('.mention-menu [aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" || event.key === "Tab") {
      const suggestion = this.localPaths[this.localPathActiveIndex];
      if (suggestion) {
        event.preventDefault();
        this.selectLocalPath(suggestion);
      }
    }
  };

  private flushPendingLaunchPrompt() {
    const prompt = this.pendingLaunchPrompt;
    if (!shouldFlushLaunchPrompt(prompt, this.selected?.status, this.connection, this.opening)) {
      return;
    }
    const attachments = this.pendingLaunchAttachments;
    this.pendingLaunchPrompt = "";
    this.pendingLaunchAttachments = [];
    this.send(prompt, attachments);
  }

  private send = (text: string, attachments: readonly Attachment[] = [], mode: PromptMode = "prompt") => {
    if (this.handleUpdateCommand(text, attachments)) return;
    const session = this.selected;
    const trimmed = text.trim();
    const hasImage = attachments.some((item) => item.kind === "image");
    if (!session || (!trimmed && !hasImage) || this.opening || this.sending || this.connection !== "live") {
      return;
    }
    // The gateway refuses these for a bot's permanent chat; say why without a round trip.
    const botRefusal = session.bot ? botChatCommandRefusal(trimmed) : undefined;
    if (botRefusal) {
      this.note = botRefusal;
      this.noteLevel = "error";
      return;
    }
    const clearCommand = parseClearCommand(trimmed);
    const reloadCommand = parseReloadCommand(trimmed);
    const command = clearCommand ? "clear" : reloadCommand ? "reload" : undefined;
    if (command) {
      if ((clearCommand ?? reloadCommand) === "invalid" || attachments.length) {
        this.note = `Use /${command} without arguments or attachments.`;
        this.noteLevel = "error";
        return;
      }
      if (mode !== "prompt" || this.streaming || session.status !== "idle") {
        this.note = `Finish or stop active work before ${command}ing the session.`;
        this.noteLevel = "error";
        return;
      }
      this.note = "";
      this.noteLevel = "info";
      this.sending = true;
      this.composerDraftEdit += 1;
      this.setDraft("");
      this.attachments = [];
      void this.persistComposerDraft(sessionDraftKey(session.id), "", []);
      const run = command === "clear"
        ? clearSession(session.id).then((snapshot) => {
          if (!isSelectedSession(session.id, this.selected?.id)) return;
          this.applySnapshot(snapshot);
          this.sideChat = undefined;
          this.note = "Session context cleared.";
        })
        : reloadSession(session.id).then(() => {
          if (!isSelectedSession(session.id, this.selected?.id)) return;
          // Skills, prompts and extension commands may have changed.
          this.resetCommands();
          this.note = "Reloaded extensions, skills, prompts and context files.";
        });
      void run.catch(async (error: unknown) => {
        if (await this.restoreSentDraft(session.id, text, attachments)) {
          this.note = error instanceof Error ? error.message : `Could not ${command} that session.`;
          this.noteLevel = "error";
        }
      }).finally(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.sending = false;
      });
      return;
    }
    const compact = parseCompactCommand(trimmed);
    if (compact) {
      if (attachments.length || mode !== "prompt") {
        this.note = attachments.length ? "Use /compact without attachments." : "Finish or stop active work before compacting the session.";
        this.noteLevel = "error";
        return;
      }
      this.compactNow(compact.instructions, text);
      return;
    }
    const sideQuestion = /^\/(?:btw|side)(?:\s+([\s\S]+))?$/iu.exec(trimmed)?.[1]?.trim();
    if (/^\/(?:btw|side)(?:\s|$)/iu.test(trimmed)) {
      if (!sideQuestion) {
        this.note = "Add a question after /btw. Example: /btw which file are we editing?";
        this.noteLevel = "error";
        return;
      }
      if (attachments.length) {
        this.note = "/btw does not support attachments in this build.";
        this.noteLevel = "error";
        return;
      }
      this.composerDraftEdit += 1;
      this.setDraft("");
      void this.persistComposerDraft(sessionDraftKey(session.id), "", []);
      this.sideChat = { question: sideQuestion, answer: "", model: "", loading: true, error: "" };
      void askSideQuestion(session.id, sideQuestion).then((result) => {
        if (isSelectedSession(session.id, this.selected?.id)) {
          this.sideChat = { ...result, loading: false, error: "" };
        }
      }).catch((error: unknown) => {
        if (isSelectedSession(session.id, this.selected?.id)) {
          this.sideChat = {
            question: sideQuestion,
            answer: "",
            model: "",
            loading: false,
            error: error instanceof Error ? error.message : "The side question failed.",
          };
        }
      });
      return;
    }
    const pendingId = localTranscriptId("user");
    this.note = "";
    this.noteLevel = "info";
    this.sending = true;
    // Claim this exact payload before awaiting HTTP. The composer stays locked
    // for the short acknowledgement window, so a rejection can restore this
    // transaction without mixing it with a second draft.
    this.composerDraftEdit += 1;
    this.setDraft("");
    this.attachments = [];
    void this.persistComposerDraft(sessionDraftKey(session.id), "", []);
    this.streaming = streamingAfterSubmission(
      this.streaming,
      mode,
      "started",
      session.status,
    );
    if (mode === "prompt") {
      this.transcript = appendPendingUser(this.transcript, pendingId, trimmed, attachments.map((item) => ({ name: item.name, kind: item.kind, mimeType: item.mimeType, ...(attachmentPreview(item) ? { url: attachmentPreview(item) } : {}) })));
    }
    const request = mode === "steer" ? steerSession : mode === "followUp" ? followUpSession : sendPrompt;
    // A resend of a send that failed on the way keeps its id, whatever the mode is now: a prompt the gateway took
    // started a run, so its resend comes back as a steer or follow-up.
    const { requestId, earlierRow } = this.sendRequests.take(session.id, trimmed, attachments);
    void request(session.id, trimmed, attachments, requestId)
      .then(({ duplicate }) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        // The gateway had the first attempt all along: its message is in the session, so drop the local copies.
        if (duplicate) this.transcript = this.transcript.filter((item) => item.id !== pendingId && item.id !== earlierRow);
        else if (mode === "prompt") this.transcript = settlePendingUser(this.transcript, pendingId, true);
        this.streaming = streamingAfterSubmission(
          this.streaming,
          mode,
          duplicate ? "duplicate" : "accepted",
          this.selected?.status ?? session.status,
        );
      })
      .catch(async (error: unknown) => {
        this.sendRequests.failed(session.id, requestId, trimmed, attachments, mode === "prompt" ? pendingId : undefined);
        const stillSelected = isSelectedSession(session.id, this.selected?.id);
        if (stillSelected && mode === "prompt") this.transcript = settlePendingUser(this.transcript, pendingId, false);
        const stored = stillSelected
          ? { text: this.draft, attachments: this.attachments }
          : await readComposerDraft(sessionDraftKey(session.id));
        const restored = mergeComposerDraft(stored, { text, attachments });
        await this.persistComposerDraft(sessionDraftKey(session.id), restored.text, restored.attachments);
        if (!stillSelected) return;
        this.composerDraftEdit += 1;
        this.setDraft(restored.text);
        this.attachments = restored.attachments;
        this.streaming = streamingAfterSubmission(
          this.streaming,
          mode,
          "rejected",
          this.selected?.status ?? session.status,
        );
        this.note = error instanceof Error ? error.message : "Could not send that prompt.";
        this.noteLevel = "error";
      })
      .finally(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.sending = false;
      });
  };

  private currentRunError() {
    const session = this.selected;
    const error = session ? latestRunError(this.transcript, this.streaming) : undefined;
    if (!session || !error || this.dismissedRunErrors.has(`${session.id}\0${error.key}`)) return undefined;
    return error;
  }

  private dismissRunError = () => {
    const session = this.selected;
    const error = this.currentRunError();
    if (!session || !error) return;
    this.dismissedRunErrors = new Set([...this.dismissedRunErrors, `${session.id}\0${error.key}`]);
  };

  private continueAfterError = () => {
    if (!this.currentRunError()) return;
    this.send(CONTINUE_AFTER_ERROR_PROMPT);
  };

  private continueInterrupted = () => {
    const session = this.selected;
    if (!session?.interrupted || this.sending || this.opening || this.connection !== "live") return;
    this.note = "";
    this.noteLevel = "info";
    this.sending = true;
    void continueSession(session.id)
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.note = error instanceof Error ? error.message : "Could not continue that run.";
        this.noteLevel = "error";
      })
      .finally(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.sending = false;
      });
  };

  private addAttachments = (files: readonly File[]) => {
    const key = this.composerDraftKey;
    if (this.sending || this.launching) {
      return;
    }
    void Promise.all(files.map((file) => readAttachment(file)))
      .then(async (added) => {
        if (key !== this.composerDraftKey) {
          const stored = await readComposerDraft(key);
          const attachments = [...stored.attachments, ...added];
          validateAttachmentTotal(attachments);
          await this.persistComposerDraft(key, stored.text, attachments);
          return;
        }
        const next = [...this.attachments, ...added];
        validateAttachmentTotal(next);
        this.composerDraftEdit += 1;
        this.attachments = next;
        await this.persistComposerDraft();
      })
      .catch((error: unknown) => {
        if (key !== this.composerDraftKey) {
          return;
        }
        this.note = error instanceof Error ? error.message : "Could not read that file.";
        this.noteLevel = "error";
      });
  };

  private removeAttachment = (index: number) => {
    if (this.sending) return;
    this.composerDraftEdit += 1;
    this.attachments = this.attachments.filter((_, at) => at !== index);
    void this.persistComposerDraft();
  };

  private abort = () => {
    const session = this.selected;
    if (!session || this.stopping) {
      return;
    }
    this.stopping = true;
    void abortSession(session.id)
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.note = error instanceof Error ? error.message : "Could not stop that turn.";
        this.noteLevel = "error";
      })
      .finally(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.stopping = false;
      });
  };

  /** The outcome arrives as `compaction_end`: the divider then reads cancelled. */
  private cancelCompactionNow() {
    const session = this.selected;
    if (!session) return;
    void cancelCompaction(session.id).catch((error: unknown) => {
      if (!isSelectedSession(session.id, this.selected?.id)) return;
      this.note = error instanceof Error ? error.message : "Could not cancel that compaction.";
      this.noteLevel = "error";
    });
  }

  /** `typed` is the `/compact` draft, cleared now and given back if HUI refuses. */
  private compactNow(instructions?: string, typed?: string) {
    const session = this.selected;
    if (!session || this.sending) return;
    if (this.streaming || session.status !== "idle") {
      this.note = "Finish or stop active work before compacting the session.";
      this.noteLevel = "error";
      return;
    }
    if (this.compaction?.status === "running") {
      this.note = "A compaction is already running.";
      this.noteLevel = "error";
      return;
    }
    this.note = "";
    this.noteLevel = "info";
    this.sending = true;
    if (typed !== undefined) {
      this.composerDraftEdit += 1;
      this.setDraft("");
      void this.persistComposerDraft(sessionDraftKey(session.id), "", []);
    }
    // Progress and the outcome arrive as compaction events.
    void compactSession(session.id, instructions).catch(async (error: unknown) => {
      if (typed !== undefined ? await this.restoreSentDraft(session.id, typed, []) : isSelectedSession(session.id, this.selected?.id)) {
        this.note = error instanceof Error ? error.message : "Could not compact that session.";
        this.noteLevel = "error";
      }
    }).finally(() => {
      if (isSelectedSession(session.id, this.selected?.id)) this.sending = false;
    });
  }

  /** Puts a refused command back into the composer, merged with anything typed
   * since. True while that session is still selected. */
  private async restoreSentDraft(sessionId: string, text: string, attachments: readonly Attachment[]): Promise<boolean> {
    const stillSelected = isSelectedSession(sessionId, this.selected?.id);
    const stored = stillSelected
      ? { text: this.draft, attachments: this.attachments }
      : await readComposerDraft(sessionDraftKey(sessionId));
    const restored = mergeComposerDraft(stored, { text, attachments });
    await this.persistComposerDraft(sessionDraftKey(sessionId), restored.text, restored.attachments);
    if (!stillSelected) return false;
    this.composerDraftEdit += 1;
    this.setDraft(restored.text);
    this.attachments = restored.attachments;
    return true;
  }

  private rewindToMessage = (target: RewindTarget, text: string, sent: readonly (string | TranscriptAttachment)[] = []) => {
    const session = this.selected;
    if (!session || this.opening || this.rewindPending) return;
    this.rewindPending = true;
    this.note = "";
    this.noteLevel = "info";
    // Read the attachments first: their URLs point into the branch the rewind leaves.
    void readTranscriptAttachments(sent)
      .then(async (attachments) => {
        await rewindSession(session.id, target, true);
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.composerDraftEdit += 1;
        this.setDraft(text);
        this.attachments = attachments;
        await this.persistComposerDraft();
        await this.updateComplete;
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.composerTextarea?.focus();
        this.composerTextarea?.setSelectionRange(text.length, text.length);
        this.note = "Message restored to the composer. The previous branch is kept.";
        this.noteLevel = "info";
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.note = error instanceof Error ? error.message : "Could not rewind that message.";
        this.noteLevel = "error";
      })
      .finally(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.rewindPending = false;
      });
  };

  /** Asks where the fork works (same checkout or a new worktree); the dialog copies the history and `forked` opens
   * the copy. The source session is left running or idle as it was. */
  private forkFromMessage = (entryId: string) => {
    const session = this.selected;
    if (!session || this.opening || this.forkTarget) return;
    void import("./components/fork-dialog.ts").then(() => { this.forkTarget = { session, entryId }; });
  };

  private forked = async (forked: SessionView) => {
    this.forkTarget = undefined;
    await this.refreshSessions();
    this.selectSession(this.groups.flatMap((group) => group.sessions).find((candidate) => candidate.id === forked.id) ?? forked);
  };

  private renderForkDialog() {
    if (!this.forkTarget) return null;
    return html`<hui-fork-dialog
      .target=${this.forkTarget}
      .branchPrefix=${this.settings.branchPrefix}
      .onClose=${() => { this.forkTarget = undefined; }}
      .onForked=${this.forked}
    ></hui-fork-dialog>`;
  }

  private continueRun = () => {
    const session = this.selected;
    if (!session || this.streaming || this.opening || this.continuing) return;
    this.continuing = true;
    this.note = "";
    this.noteLevel = "info";
    void resumeSession(session.id)
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.note = error instanceof Error ? error.message : "Could not continue that session.";
        this.noteLevel = "error";
      })
      .finally(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.continuing = false;
      });
  };

  private queueMutation = (
    mutation: Parameters<typeof mutateQueuedMessage>[1],
    onSuccess?: () => void,
  ) => {
    const session = this.selected;
    if (!session) return;
    void mutateQueuedMessage(session.id, mutation)
      .then(() => {
        if (isSelectedSession(session.id, this.selected?.id)) onSuccess?.();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.note = error instanceof Error ? error.message : "Could not update the queue.";
        this.noteLevel = "error";
      });
  };

  private selectThinking = (level: string) => {
    const session = this.selected;
    if (!session || this.streaming) return;
    void setSessionThinking(session.id, level)
      .then((authoritative) => {
        if (isSelectedSession(session.id, this.selected?.id)) this.thinking = authoritative;
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        // The backend broadcasts either the compensated level or the live
        // divergent level. Never overwrite that authoritative SSE state with
        // this request's stale optimistic value.
        this.note = error instanceof Error ? error.message : "Could not switch thinking level.";
        this.noteLevel = "error";
      });
  };

  private answerQuestion = (answer: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
    const session = this.selected;
    const question = this.question;
    if (!session || !question) return;
    this.question = undefined;
    void answerQuestion(session.id, question.id, answer)
      .then(() => {
        if (isSelectedSession(session.id, this.selected?.id)) this.restoreQuestionFocus();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        this.question = question;
        this.note = error instanceof Error ? error.message : "Could not answer pi.";
        this.noteLevel = "error";
      });
  };

  private showQuestion(question: RuntimeQuestion) {
    if (!this.question) {
      const composer = this.renderRoot.querySelector?.(".agent-chat__composer-combobox textarea");
      this.questionReturnFocus = composer instanceof HTMLElement
        ? composer
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
    }
    this.question = question;
  }

  private restoreQuestionFocus() {
    const target = this.questionReturnFocus;
    this.questionReturnFocus = undefined;
    void this.updateComplete.then(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      const composer = this.renderRoot.querySelector?.(".agent-chat__composer-combobox textarea");
      if (composer instanceof HTMLTextAreaElement) composer.focus();
    });
  }

  private startSuggestion = (suggestion: TaskSuggestion, mode: TaskSuggestionStartMode = "session") => {
    const source = this.selected;
    if (!source || this.taskSuggestionPendingId) return;
    this.taskSuggestionPendingId = suggestion.id;
    void startTaskSuggestion(source.id, suggestion.id, mode)
      .then(async (session) => {
        this.taskSuggestions = this.taskSuggestions.filter(({ id }) => id !== suggestion.id);
        this.taskSuggestionIndex = clampSuggestionIndex(this.taskSuggestionIndex, this.taskSuggestions.length);
        await this.refreshSessions(true);
        void this.onPaneRegistryChange?.();
        // "This session" stays put; the transcript shows the new turn.
        if (session.id !== source.id) this.selectSession(session);
      })
      .catch((error: unknown) => {
        this.note = error instanceof Error ? error.message : "Could not start that suggestion.";
        this.noteLevel = "error";
      })
      .finally(() => { this.taskSuggestionPendingId = ""; });
  };

  private dismissSuggestion = (suggestion: TaskSuggestion) => {
    const source = this.selected;
    if (!source || this.taskSuggestionPendingId) return;
    this.taskSuggestionPendingId = suggestion.id;
    void dismissTaskSuggestion(source.id, suggestion.id)
      .then((suggestions) => {
        if (this.selected?.id !== source.id) return;
        this.taskSuggestions = parseTaskSuggestions(suggestions);
        this.taskSuggestionIndex = clampSuggestionIndex(this.taskSuggestionIndex, this.taskSuggestions.length);
      })
      .catch((error: unknown) => {
        this.note = error instanceof Error ? error.message : "Could not dismiss that suggestion.";
        this.noteLevel = "error";
      })
      .finally(() => { this.taskSuggestionPendingId = ""; });
  };

  /** One watcher mutation at a time; the card disables its buttons while a
   * request is in flight, and a response for another session is dropped. */
  private watcherAction = (watcher: Watcher, request: (sessionId: string, watcherId: string) => Promise<Watcher[]>, failure: string) => {
    const session = this.selected;
    if (!session || this.watcherPendingId) return;
    this.watcherPendingId = watcher.id;
    void request(session.id, watcher.id)
      .then((watchers) => {
        if (this.selected?.id !== session.id) return;
        this.watchers = watchers;
        if (this.watcherLog && !watchers.some(({ id }) => id === this.watcherLog!.id)) this.watcherLog = null;
      })
      .catch((error: unknown) => {
        this.note = error instanceof Error ? error.message : failure;
        this.noteLevel = "error";
      })
      .finally(() => { this.watcherPendingId = ""; });
  };

  private stopWatcher = (watcher: Watcher) => {
    this.watcherAction(watcher, stopWatcherRequest, "Could not stop that watcher.");
  };

  private restartWatcher = (watcher: Watcher) => {
    this.watcherAction(watcher, restartWatcherRequest, "Could not restart that watcher.");
  };

  private dismissWatcher = (watcher: Watcher) => {
    this.watcherAction(watcher, dismissWatcherRequest, "Could not dismiss that watcher.");
  };

  private viewWatcherLog = (watcher: Watcher) => {
    const session = this.selected;
    if (!session) return;
    const previous = this.watcherLog?.id === watcher.id ? this.watcherLog : undefined;
    this.watcherLog = { id: watcher.id, lines: previous?.lines ?? [], truncated: previous?.truncated ?? false, loading: true };
    void readWatcherLog(session.id, watcher.id)
      .then((log) => {
        if (this.selected?.id !== session.id || this.watcherLog?.id !== watcher.id) return;
        this.watcherLog = { id: log.id, lines: log.lines, truncated: log.truncated, loading: false };
      })
      .catch((error: unknown) => {
        if (this.watcherLog?.id !== watcher.id) return;
        this.watcherLog = null;
        this.note = error instanceof Error ? error.message : "Could not read that watcher log.";
        this.noteLevel = "error";
      });
  };

  /** Opening a watcher's row fetches its log tail; closing it drops the tail. */
  private toggleWatcher = (watcher: Watcher, open: boolean) => {
    this.setActivityExpanded(`watcher:${watcher.id}`, open);
    if (open) this.viewWatcherLog(watcher);
    else if (this.watcherLog?.id === watcher.id) this.watcherLog = null;
  };

  private setActivityExpanded = (id: string, expanded: boolean) => {
    const next = new Set(this.expandedActivityIds);
    if (expanded) next.add(id);
    else next.delete(id);
    this.expandedActivityIds = next;
  };

  private fileSuggestionInJira = (suggestion: TaskSuggestion) => {
    const session = this.selected;
    if (!session) return;
    void import("./components/jira-create-dialog.ts").then(() => {
      this.jiraCreateSuggestion = suggestion;
      this.jiraCreateSession = session;
    });
  };

  private copyTranscript = (text: string, id: string) => {
    return writeClipboardText(text).then((copied) => {
      if (!copied) throw new Error("Clipboard write failed");
      this.copiedId = id;
      if (this.copyTimer !== undefined) window.clearTimeout(this.copyTimer);
      this.copyTimer = window.setTimeout(() => { this.copiedId = ""; }, 1_500);
      return true;
    }).catch(() => {
      this.note = "Could not copy to the clipboard.";
      this.noteLevel = "error";
      return false;
    });
  };

  private transcriptScrolled = (element: HTMLElement) => {
    this.autoFollow = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    this.showScrollToBottom = !this.autoFollow;
  };

  private navigateTranscript = (element: HTMLElement, top: number) => {
    // Pause before the programmatic scroll: a streaming update must not win
    // the race and pull the reader back to the live edge.
    this.autoFollow = false;
    element.scrollTo({ top, behavior: "instant" });
    // A jump clamped to the current position may not emit a native scroll.
    this.transcriptScrolled(element);
  };

  private scrollToBottom = () => {
    this.autoFollow = true;
    void this.updateComplete.then(() => {
      // Measuring a pane out of sight would lay out its whole transcript on
      // every streamed token; it follows once it is shown again.
      if (!this.autoFollow || !this.paneVisible) return;
      const scroller = this.renderRoot.querySelector?.(".chat-thread");
      if (scroller instanceof HTMLElement) {
        scroller.scrollTop = scroller.scrollHeight;
        this.autoFollow = true;
        this.showScrollToBottom = false;
      }
    });
  };

  private selectModel = (provider: string, modelId: string) => {
    const session = this.selected;
    if (!session) {
      return;
    }
    void setSessionModel(session.id, provider, modelId)
      .then((model) => {
        if (!isSelectedSession(session.id, this.selected?.id)) {
          return;
        }
        if (model) {
          this.currentModel = model;
        }
        // The record now carries the choice, so the sidebar reflects it too.
        return this.refreshSessions();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) {
          return;
        }
        this.note = error instanceof Error ? error.message : "Could not switch model.";
        this.noteLevel = "error";
      });
  };

  /**
   * Models are listed only for the session on screen, and only once it has a
   * runtime: asking a tool that has not booted returns nothing useful.
   */
  private requestModelsWhenReady(id: string, status: SessionStatus) {
    if (!shouldRequestModels(id, status, this.modelsRequestedFor)) {
      return;
    }
    // Claim this session before the request starts. Repeated idle frames are
    // common during reconnects and must not fan out duplicate requests.
    this.modelsRequestedFor = id;
    void loadModels(id)
      .then((models) => {
        if (this.selected?.id === id) {
          this.models = models;
        }
      })
      .catch(() => {
        // A transient failure can retry on a later ready status/reconnect, but
        // a late failure from a deselected session cannot touch the new gate.
        this.modelsRequestedFor = modelRequestMarkerAfterFailure(
          this.modelsRequestedFor,
          id,
          this.selected?.id,
        );
      });
  }

  private cancelRename = () => {
    this.renamingFor = "";
  };

  /** Enter and blur can both commit the same edit; clearing renamingFor first
   * makes the second call (and a blur after Escape) a no-op. */
  private rename = (title: string) => {
    const session = this.selected;
    const targetId = this.renamingFor;
    this.renamingFor = "";
    if (!session || targetId !== session.id || title === session.title) {
      return;
    }
    void renameSession(targetId, { title })
      .then((renamed: SessionView) => {
        if (!isSelectedSession(targetId, this.selected?.id)) {
          return;
        }
        this.selected = renamed;
        void this.onPaneRegistryChange?.();
        return this.refreshSessions();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(targetId, this.selected?.id)) {
          return;
        }
        this.reportOperationError(error, "Could not update that session.");
      });
  };

  private cancelDelete = () => {
    this.closeDeleteDialog();
    this.deletingFor = "";
    this.deleteNeedsFocus = false;
    const target = this.deleteReturnFocus;
    this.deleteReturnFocus = undefined;
    void this.updateComplete.then(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      const fallback = this.renderRoot.querySelector?.(".delete-session-trigger");
      if (fallback instanceof HTMLButtonElement) fallback.focus();
    });
  };

  private confirmDelete = () => {
    const session = this.selected;
    const targetId = this.deletingFor;
    this.closeDeleteDialog();
    this.deletingFor = "";
    this.deleteReturnFocus = undefined;
    this.deleteNeedsFocus = false;
    if (!session || targetId !== session.id) {
      return;
    }
    // A failed worktree launch hands its prompt back to New Session.
    const unsent = this.paneUnsentPrompt;
    void deleteSession(targetId)
      .then(async () => {
        if (unsent) {
          const stored = await readComposerDraft(NEW_SESSION_DRAFT_KEY);
          await writeComposerDraft(NEW_SESSION_DRAFT_KEY, mergeComposerDraft(stored, { text: unsent, attachments: [] }));
        }
        if (isSelectedSession(targetId, this.selected?.id)) {
          this.clearSessionState();
          this.navigate({ kind: "home" }, true);
        }
        return this.refreshSessions();
      })
      .catch((error: unknown) => {
        this.reportOperationError(error, "Could not delete that session.");
      });
  };

  private retrySelected = () => {
    const id = this.selected?.id;
    if (id && !this.opening) void this.openSelected(id);
  };

  /** The worker's own connect: once it is up, the gateway reattaches its sessions. */
  private reconnectSelected = () => {
    const worker = this.selected?.worker;
    if (!worker) return;
    void workerAction(worker.id, "connect").catch((error: unknown) => {
      this.note = error instanceof Error ? error.message : `Could not reconnect to ${worker.name}.`;
      this.noteLevel = "error";
    });
  };

  private launch = (input: { cwd: string; title?: string; group?: string; prompt?: string; commandDraft?: string; model?: string; thinking?: string; worktree?: boolean; branchName?: string; baseRef?: string; worker?: string }) => {
    if (input.prompt && this.handleUpdateCommand(input.prompt)) return;
    if (this.launching) return;
    this.launching = true;
    this.note = "";
    this.noteLevel = "info";
    const { prompt, commandDraft, ...sessionInput } = input;
    this.pendingLaunchPrompt = prompt?.trim() ?? "";
    const launchAttachments = this.attachments;
    void createSession({
      ...sessionInput,
      ...(prompt?.trim() ? { initialPrompt: prompt.trim() } : {}),
      // The gateway sends a worktree session's first prompt, so it needs these too.
      ...(input.worktree && prompt?.trim() && launchAttachments.length ? { initialAttachments: launchAttachments } : {}),
    })
      .then(async (session) => {
        await deleteComposerDraft(NEW_SESSION_DRAFT_KEY);
        this.composerDraftKey = sessionDraftKey(session.id);
        this.composerDraftHydrated = true;
        this.composerDraftLoad += 1;
        this.composerDraftEdit += 1;
        this.setDraft(commandDraft ?? "");
        this.pendingCommandBrowse = commandDraft !== undefined;
        this.attachments = [];
        if (commandDraft !== undefined) void this.persistComposerDraft();
        this.workspaceBranch = "";
        this.workspaceWorktree = false;
        this.workspaceBaseRef = "";
        this.selected = session;
        await this.refreshSessions();
        this.navigate({ kind: "session", id: session.id });
        // The gateway sends a worktree session's prompt once its checkout exists.
        const pendingPrompt = session.creating ? "" : this.pendingLaunchPrompt;
        this.pendingLaunchPrompt = "";
        await this.withSessionPane(session, (app) => {
          app.pendingLaunchPrompt = pendingPrompt;
          app.pendingLaunchAttachments = pendingPrompt ? launchAttachments : [];
          app.pendingCommandBrowse = commandDraft !== undefined;
          if (commandDraft !== undefined) app.updateDraft(commandDraft);
          app.flushPendingLaunchPrompt();
        });
        this.composerDraftKey = NEW_SESSION_DRAFT_KEY;
        this.setDraft("");
      })
      .catch((error: unknown) => {
        if (this.pendingLaunchPrompt) {
          this.composerDraftEdit += 1;
          this.setDraft(this.pendingLaunchPrompt);
          this.pendingLaunchPrompt = "";
          void this.persistComposerDraft();
        }
        this.note = error instanceof Error ? error.message : "Could not start that session.";
        this.noteLevel = "error";
      })
      .finally(() => {
        this.launching = false;
      });
  };

  private loadDirectorySuggestions(input: string, worker?: string) {
    const marker = ++this.directorySuggestionRequest;
    void loadWorkingDirectorySuggestions(input, worker).then((directories) => {
      if (marker !== this.directorySuggestionRequest) return;
      this.directorySuggestionsFrom = worker ?? "";
      this.directorySuggestions = directories;
    }).catch(() => {
      if (marker === this.directorySuggestionRequest) this.directorySuggestions = [];
    });
  }

  private requestDirectorySuggestions = (input: string) => {
    this.loadDirectorySuggestions(input);
    if (this.groupAction?.action === "defaults") this.requestGroupCheckout(input);
    else this.requestGitCheckout(input);
  };

  private requestGitCheckout(input: string) {
    const directory = input.trim() || "~/";
    if (directory === this.inspectedCheckoutDirectory && this.gitCheckout) return;
    this.inspectedCheckoutDirectory = directory;
    const marker = ++this.gitCheckoutRequest;
    this.workspaceWorktree = false;
    this.workspaceBaseRef = "";
    this.gitCheckoutLoading = true;
    void loadGitCheckout(directory).then((checkout) => {
      if (marker !== this.gitCheckoutRequest) return;
      this.gitCheckout = checkout;
      const defaults = groupCheckoutDefaults(directory, checkout, this.launchDefaults);
      this.workspaceBaseRef = defaults.baseRef;
      this.workspaceWorktree = defaults.worktree;
    }).catch(() => {
      if (marker !== this.gitCheckoutRequest) return;
      this.gitCheckout = undefined;
    }).finally(() => {
      if (marker === this.gitCheckoutRequest) this.gitCheckoutLoading = false;
    });
  }

  private clearSessionState() {
    // Invalidates an open response even if it resolves after the selection is
    // cleared and before another session is chosen.
    this.openRequestToken += 1;
    this.switchComposerDraft(NEW_SESSION_DRAFT_KEY);
    this.streamStop?.();
    this.streamStop = undefined;
    this.pendingLaunchPrompt = "";
    this.pendingLaunchAttachments = [];
    this.selected = undefined;
    const empty = emptySessionPresentation();
    this.transcript = empty.transcript;
    this.subagents = [];
    this.taskSuggestions = [];
    this.taskSuggestionIndex = 0;
    this.watchers = [];
    this.watcherPendingId = "";
    this.watcherLog = null;
    if (this.subagentExpiryTimer !== undefined) window.clearTimeout(this.subagentExpiryTimer);
    this.subagentExpiryTimer = undefined;
    this.opening = empty.opening;
    this.openError = "";
    this.streaming = empty.streaming;
    this.note = empty.note;
    this.noteLevel = empty.noteLevel;
    this.connectionNote = empty.connectionNote;
    this.models = empty.models;
    this.currentModel = empty.currentModel;
    this.usage = empty.usage;
    this.compaction = undefined;
    this.sending = false;
    this.stopping = false;
    this.continuing = false;
    this.rewindPending = false;
    this.queue = EMPTY_QUEUE;
    this.question = undefined;
    this.questionReturnFocus = undefined;
    this.connection = "live";
    this.showScrollToBottom = false;
    this.autoFollow = true;
    this.modelsRequestedFor = "";
    this.resetSessionEphemeral();
  }

  private resetSessionEphemeral() {
    this.resetCommands();
    this.resetLocalPaths();
    this.pendingCommandBrowse = false;
    this.closeDeleteDialog();
    this.renamingFor = "";
    this.deletingFor = "";
    this.deleteReturnFocus = undefined;
    this.deleteNeedsFocus = false;
    this.sending = false;
    this.stopping = false;
    this.queue = EMPTY_QUEUE;
    this.question = undefined;
    this.questionReturnFocus = undefined;
    this.note = "";
    this.noteLevel = "info";
    this.connectionNote = "";
    this.sideChat = undefined;
  }

  private closeDeleteDialog() {
    const dialog = this.renderRoot.querySelector?.(".delete-session-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
  }

  private reportOperationError(error: unknown, fallback: string) {
    this.importNote = error instanceof Error ? error.message : fallback;
    this.importFailed = true;
  }

  private toggleSessionTree = (id: string) => {
    const next = new Set(this.toggledSessionTrees);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.toggledSessionTrees = next;
  };

  private toggleGroup = (label: string) => {
    const next = new Set(this.collapsed);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    this.collapsed = next;
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  };

  /* ── bots ─────────────────────────────────────────────────────────────── */

  /** Session lists never show bot chats; the Bots tab lists their bots. The
   * unfiltered registry stays in `groups` so a bot pane can open its chat. */
  private listedGroupsSource: readonly SessionGroup[] | undefined;
  private listedGroupsCache: readonly SessionGroup[] = [];
  private get listedGroups(): readonly SessionGroup[] {
    if (this.listedGroupsSource !== this.groups) {
      this.listedGroupsSource = this.groups;
      this.listedGroupsCache = withoutBotSessions(this.groups);
    }
    return this.listedGroupsCache;
  }

  private activeBot(): BotView | undefined {
    return this.bots.find((bot) => bot.id === this.activeBotId);
  }

  private botPaneApp(): HuiApp | undefined {
    return this.renderRoot.querySelector<HuiApp>(".bot-workspace__pane") ?? undefined;
  }

  /** Session statuses arrive on their own stream and win over a list's
   * snapshot; the bot on screen is read, as its detailed stream says. */
  private withLiveBotState(bots: readonly BotView[]): BotView[] {
    return bots.map((bot) => {
      const status = this.sessionStatuses.get(bot.sessionId);
      const presented = bot.unread && this.isSessionPresented(bot.sessionId);
      return status || presented ? { ...bot, ...(status ? { status } : {}), ...(presented ? { unread: false } : {}) } : bot;
    });
  }

  /** The gateway's bot stream while the Bots tab is enabled. It starts with the
   * whole list, then sends what changed; a gateway without it falls back to
   * reading the list whenever a bot's session changes status. */
  private syncBotsStream() {
    if (this.embeddedPane) return;
    const wanted = botsEnabled(this.settings) && !this.botsStreamUnsupported;
    if (wanted && !this.botsStreamStop) {
      this.botsStreamStop = subscribeBots({
        onUpdate: (update, first) => {
          if (!isNewBotsFrame(update.revision, first, this.botsRevision)) return;
          this.botsRevision = update.revision;
          this.bots = this.withLiveBotState(applyBotsUpdate(this.bots, update));
          this.botsLoaded = true;
          this.botsError = "";
          this.followBotMemory();
          this.followBotSoul();
          this.followBotTools();
          this.followBotTriggers();
        },
        onConnection: (state) => {
          this.botsStreamLive = state === "live";
          if (state === "live") this.botsStreamRetried = false;
          if (state === "reconnecting" && !this.botsLoaded) this.botsError = "Could not reach the gateway for the bot list. Retrying…";
          if (state === "unsupported") {
            this.botsStreamUnsupported = true;
            this.botsStreamStop = undefined;
            void this.refreshBots();
          }
          // A 409: bots are off on the gateway, turned off on another screen (which ends this stream) or not on there
          // yet. Once this screen's own writes have landed the settings are read again and followed; if they still say
          // bots are on, the stream is asked once more.
          if (state === "off") {
            this.botsStreamStop = undefined;
            const retry = !this.botsStreamRetried;
            void settingsWritten().then(refreshSettings).then((settings) => {
              if (!settings) return;
              this.settings = settings;
              if (retry && botsEnabled(settings)) {
                this.botsStreamRetried = true;
                this.syncBotsStream();
              }
            });
          }
        },
      });
    } else if (!wanted && this.botsStreamStop) {
      this.botsStreamStop();
      this.botsStreamStop = undefined;
      this.botsStreamLive = false;
    }
  }

  /** The list is current when the stream runs; otherwise it is read now. */
  private ensureBots() {
    if (this.botsStreamUnsupported) void this.refreshBots();
    else this.syncBotsStream();
    // The roster's + offers the workers a new bot can run on.
    this.loadLaunchWorkers();
  }

  /** Retry from an error state: restart a stopped stream or read the list. */
  private retryBots = () => {
    this.botsError = "";
    if (this.botsStreamUnsupported || this.botsStreamLive) {
      void this.refreshBots();
      return;
    }
    this.botsStreamStop?.();
    this.botsStreamStop = undefined;
    this.syncBotsStream();
  };

  /** One read at a time; a change that lands meanwhile reads once more after it.
   * Only used without a live stream, whose newer frames a read could overwrite. */
  private refreshBots(): Promise<void> {
    if (this.embeddedPane || this.botsStreamLive) return Promise.resolve();
    if (this.botsInFlight) {
      this.botsAgain = true;
      return this.botsInFlight;
    }
    this.botsLoading = true;
    this.botsInFlight = (async () => {
      try {
        do {
          this.botsAgain = false;
          try {
            const bots = await loadBots();
            // A stream that went live meanwhile is newer than this read.
            if (!this.botsStreamLive) this.bots = this.withLiveBotState(bots);
            this.botsLoaded = true;
            this.botsError = "";
          } catch (error) {
            this.botsError = error instanceof Error ? error.message : "Could not read bots.";
          }
        } while (this.botsAgain);
      } finally {
        this.botsLoading = false;
        this.botsInFlight = undefined;
      }
    })();
    return this.botsInFlight;
  }

  private setSidebarTab = (tab: SidebarTab) => {
    this.botMenuFor = "";
    if (this.sidebarTab === tab) return;
    this.sidebarTab = tab;
    writeSidebarTab(tab);
    if (tab === "bots") this.ensureBots();
  };

  private selectBot = (bot: BotView) => {
    this.botMenuFor = "";
    this.navigate({ kind: "bot", id: bot.id });
  };

  /**
   * Bots were turned on or off (Settings → Labs → Bots): the bot stream follows, and with bots off a bot's page goes
   * home and a call hangs up. Nothing is forgotten here: the roster, the remembered Agents | Bots choice and the panel
   * come back with them.
   */
  private followBotsSetting() {
    if (this.embeddedPane) return;
    // The gateway refuses the bot stream until it has the setting too: with bots on, the stream starts once this
    // screen's own write has landed; with them off, it stops at once.
    if (botsEnabled(this.settings)) {
      void settingsWritten().then(() => this.syncBotsStream());
      return;
    }
    this.syncBotsStream();
    this.botMenuFor = "";
    this.botSheetOpen = false;
    this.botImports.close();
    if (this.voice.call) this.voice.hangUp();
    // A bot's page goes home, and so does a bot's chat open as a session.
    if (this.view === "bot" || (this.view === "home" && this.selected?.bot)) this.navigate({ kind: "home" }, true);
  }

  /** The Agents | Bots switch shows exactly while Settings → Labs → Bots is on. Without it the sidebar is the one it
   * was before bots, and a remembered Bots choice shows Agents until the switch is back. */
  private shellBotsProps(): ShellBotsProps | undefined {
    if (!botsEnabled(this.settings)) return undefined;
    return {
      tab: this.sidebarTab,
      onTab: this.setSidebarTab,
      search: this.botSearch,
      onSearch: (value) => { this.botSearch = value; },
      onNew: () => this.createNewBot(),
      workers: this.launchWorkers,
      onCreate: (worker) => this.createNewBot(worker),
      onImport: this.botImports.openImport,
      onWorkersMenu: () => this.loadLaunchWorkers(),
      creating: this.botCreating,
      unread: this.bots.some((bot) => bot.unread && !bot.archived && !bot.hidden),
      roster: {
        bots: this.bots,
        loading: this.botsLoading || !this.botsLoaded,
        error: this.botsError,
        query: this.botSearch,
        showHidden: this.showHiddenBots,
        showArchived: this.showArchivedBots,
        activeBotId: this.view === "bot" ? this.activeBotId : "",
        menuFor: this.botMenuFor,
        notice: this.botNotice,
        noticeFailed: this.botNoticeFailed,
        pendingId: this.botPendingId,
        now: Date.now(),
        onSelect: this.selectBot,
        onNew: () => this.createNewBot(),
        creating: this.botCreating,
        onEdit: this.openEditBot,
        onSetHidden: this.setBotHidden,
        onArchive: this.requestArchiveBot,
        onToggleShowHidden: () => { this.showHiddenBots = !this.showHiddenBots; },
        onToggleShowArchived: () => { this.showArchivedBots = !this.showArchivedBots; },
        onRestore: this.restoreBotFromRoster,
        onDelete: this.requestDeleteBot,
        onExport: (bot) => { this.botMenuFor = ""; this.botImports.openExport(bot); },
        onImport: this.botImports.openImport,
        onRetry: this.retryBots,
        onToggleMenu: (id) => { this.botMenuFor = this.botMenuFor === id ? "" : id; },
        onCloseMenu: () => { this.botMenuFor = ""; },
      },
    };
  }

  /**
   * + (and the empty roster's New bot), as in Grok Bot: no form. The bot is created at once, on this machine or, from
   * +'s menu while a remote worker exists, on the worker chosen, where it stays. It has no name, so the gateway calls it
   * "New Bot", and everything else starts on the defaults with the face its id picks; its chat opens, where its first
   * turn has already started asking what to call it, and its Settings tab changes the rest. A refusal (a worker HUI is
   * not connected to, say) shows in the roster's notice.
   */
  private createNewBot = (worker?: string) => {
    this.botMenuFor = "";
    if (this.botCreating) return;
    this.botCreating = true;
    // A worker can take a moment: the roster says where the bot is being made.
    if (worker) {
      this.botNotice = `Creating a bot on ${this.launchWorkers.find((candidate) => candidate.id === worker)?.name ?? "the worker"}…`;
      this.botNoticeFailed = false;
    }
    void createBot(worker ? { worker } : {})
      .then((bot) => {
        this.bots = upsertBot(this.bots, bot);
        this.botNotice = "";
        this.botNoticeFailed = false;
        void this.refreshBots();
        // The new chat is a new session; open the bot once the list has it.
        void this.refreshSessions(true);
        this.navigate({ kind: "bot", id: bot.id });
      })
      .catch((error: unknown) => {
        this.botNotice = error instanceof Error ? error.message : "Could not create a bot.";
        this.botNoticeFailed = true;
      })
      .finally(() => {
        this.botCreating = false;
      });
  };

  /** The roster's Edit: the bot's chat with its Settings tab, docked beside it on wide screens, as the sheet on
   * narrow ones. */
  private openEditBot = (bot: BotView) => {
    this.botMenuFor = "";
    this.showBotSettings(bot.id);
  };

  /** Opens a bot's Settings tab, on its chat (navigating there first) with the focus on the tab. */
  private showBotSettings(botId: string) {
    if (this.view !== "bot" || this.activeBotId !== botId || this.settingsOpen) this.navigate({ kind: "bot", id: botId });
    // Without the Bots tab the bot route goes home instead.
    if (this.view !== "bot" || this.activeBotId !== botId) return;
    this.botPanel = { open: this.mobileNavLayout ? this.botPanel.open : true, tab: "settings" };
    writeBotPanel(this.botPanel);
    if (this.mobileNavLayout) this.botSheetOpen = true;
    this.automationFormError = "";
    this.automationActionError = "";
    this.syncBotPanelData();
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.bot-panel [role="tab"][aria-selected="true"]')?.focus());
  }

  /** Ctrl+Shift+, (⇧⌘,) on a bot's chat, as in Grok Bot: its Settings tab when that is not showing, closed when it is. */
  private toggleBotSettings() {
    const bot = this.activeBot();
    if (!bot || bot.archived || !this.listedSession(bot.sessionId)) return;
    if (this.botPanelVisible() && this.botPanel.tab === "settings") this.closeBotPanel();
    else this.showBotSettings(bot.id);
  }

  /** Settings' utility model by its catalog name, the default of a bot's utility model. */
  private utilityModelName(): string | undefined {
    const ref = this.settings.models.utility;
    if (!ref) return undefined;
    return this.pi?.model.catalog.find((entry) => `${entry.provider}/${entry.id}` === ref)?.name ?? ref;
  }

  /** The Calls section: GPT-Live's default voice, which a bot's "Default" follows, and whether a ChatGPT login lets
   * calls run. That is left out until the gateway has said, so a signed-in operator never sees the hint flash. */
  private botSettingsCall(): BotSettingsProps["call"] {
    return { defaultVoice: this.settings.calls.voice, ...(this.callsStatus ? { ready: callsReady(this.callsStatus) } : {}) };
  }

  private botSettingsSavesOf(botId: string): BotSettingsSaves {
    return this.botSettingsSaves.get(botId) ?? NO_BOT_SETTINGS_SAVES;
  }

  private updateBotSettingsSaves(botId: string, update: (saves: BotSettingsSaves) => BotSettingsSaves) {
    this.botSettingsSaves = new Map(this.botSettingsSaves).set(botId, update(this.botSettingsSavesOf(botId)));
  }

  /** A Settings tab change: shown at once as saving, then sent as its own PATCH after the ones before it. */
  private changeBotSetting(botId: string, key: BotSettingKey, value: BotSettingValue) {
    if (this.botSettingsSavesOf(botId).pending[key] === value) return;
    this.updateBotSettingsSaves(botId, (saves) => ({ pending: { ...saves.pending, [key]: value }, errors: withoutSetting(saves.errors, key) }));
    this.botSettingsQueue = this.botSettingsQueue.then(() => this.sendBotSetting(botId, key));
  }

  /** Sends the newest value a row waits on. The gateway's answer replaces the bot; a refusal stays on the row. A value
   * already sent, or replaced by a newer change meanwhile, is not sent again. */
  private async sendBotSetting(botId: string, key: BotSettingKey) {
    const value = this.botSettingsSavesOf(botId).pending[key];
    if (value === undefined) return;
    const settle = (error?: string) => this.updateBotSettingsSaves(botId, (saves) => saves.pending[key] !== value ? saves : {
      pending: withoutSetting(saves.pending, key),
      errors: error ? { ...saves.errors, [key]: error } : withoutSetting(saves.errors, key),
    });
    const bot = this.bots.find((candidate) => candidate.id === botId);
    if (!bot) {
      settle("This bot is gone.");
      return;
    }
    const patch = botChangePatch(bot, botSettingChange(key, value));
    if (!patch) {
      settle();
      return;
    }
    try {
      this.bots = upsertBot(this.bots, await updateBot(botId, patch));
      settle();
    } catch (error) {
      settle(error instanceof Error ? error.message : "Could not save that change.");
    }
  }

  private dismissBotSetting(botId: string, key: BotSettingKey) {
    if (!this.botSettingsSavesOf(botId).errors[key]) return;
    this.updateBotSettingsSaves(botId, (saves) => ({ ...saves, errors: withoutSetting(saves.errors, key) }));
  }

  private setBotHidden = (bot: BotView, hidden: boolean) => {
    this.botMenuFor = "";
    if (this.botPendingId) return;
    this.botPendingId = bot.id;
    void updateBot(bot.id, { hidden })
      .then((updated) => {
        this.bots = upsertBot(this.bots, updated);
        // With nothing hidden any more, the next hidden bot starts out of sight again.
        if (!hiddenBotCount(this.bots)) this.showHiddenBots = false;
        this.botNotice = hidden ? `${updated.name} is hidden. Show hidden lists it again.` : `${updated.name} is back in the roster.`;
        this.botNoticeFailed = false;
      })
      .catch((error: unknown) => {
        this.botNotice = error instanceof Error ? error.message : "Could not change that bot.";
        this.botNoticeFailed = true;
      })
      .finally(() => {
        this.botPendingId = "";
      });
  };

  private requestArchiveBot = (bot: BotView) => {
    this.botMenuFor = "";
    this.botArchive = bot;
    this.botArchiveError = "";
  };

  private closeBotArchive = () => {
    const dialog = this.renderRoot.querySelector?.(".bot-archive-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
    this.botArchive = undefined;
    this.botArchiveError = "";
  };

  private confirmArchiveBot = () => {
    const bot = this.botArchive;
    if (!bot || this.botArchivePending) return;
    this.botArchivePending = true;
    this.botArchiveError = "";
    void archiveBot(bot.id)
      .then((archived) => {
        this.closeBotArchive();
        this.bots = upsertBot(this.bots, archived);
        this.botNotice = "";
        this.botArchiveToast = { bot: archived, restoring: false };
        this.scheduleBotArchiveToast();
        if (this.view === "bot" && this.activeBotId === bot.id) this.navigate({ kind: "home" }, true);
        void this.refreshBots();
        void this.refreshSessions(true);
      })
      .catch((error: unknown) => {
        this.botArchiveError = error instanceof Error ? error.message : "Could not archive that bot.";
      })
      .finally(() => {
        this.botArchivePending = false;
      });
  };

  /** Delete (the ⋯ menus, or Show archived's trash icon) asks first: deleting cannot be undone. */
  private requestDeleteBot = (bot: BotView) => {
    if (this.botPendingId) return;
    this.botDelete = bot;
    this.botDeleteError = "";
  };

  private closeBotDelete = () => {
    const dialog = this.renderRoot.querySelector?.(".bot-delete-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
    this.botDelete = undefined;
    this.botDeleteError = "";
  };

  /** The row stays until the gateway confirms; a failure stays in the dialog. */
  private confirmDeleteBot = () => {
    const bot = this.botDelete;
    if (!bot || this.botDeletePending) return;
    this.botDeletePending = true;
    this.botDeleteError = "";
    this.botPendingId = bot.id;
    void deleteBot(bot.id)
      .then(() => {
        this.closeBotDelete();
        this.bots = this.bots.filter((each) => each.id !== bot.id);
        if (!archivedBotCount(this.bots)) this.showArchivedBots = false;
        if (this.botArchiveToast?.bot.id === bot.id) this.dismissBotArchiveToast();
        this.botNotice = `Deleted ${bot.name}.`;
        this.botNoticeFailed = false;
        // Its chat is gone: the open bot view goes with it, as after archiving.
        if (this.view === "bot" && this.activeBotId === bot.id) this.navigate({ kind: "home" }, true);
        void this.refreshBots();
        void this.refreshSessions(true);
      })
      .catch((error: unknown) => {
        this.botDeleteError = error instanceof Error ? error.message : "Could not delete that bot.";
      })
      .finally(() => {
        this.botDeletePending = false;
        this.botPendingId = "";
      });
  };

  /** Restore from Show archived: the row stays until the gateway confirms. */
  private restoreBotFromRoster = (bot: BotView) => {
    if (this.botPendingId) return;
    this.botPendingId = bot.id;
    void restoreBot(bot.id)
      .then((restored) => {
        this.bots = upsertBot(this.bots, restored);
        // With nothing archived any more, the next archived bot starts out of sight again.
        if (!archivedBotCount(this.bots)) this.showArchivedBots = false;
        if (this.botArchiveToast?.bot.id === restored.id) this.dismissBotArchiveToast();
        this.botNotice = `Restored ${restored.name}. Its routines stay paused until you turn them on.`;
        this.botNoticeFailed = false;
        void this.refreshBots();
      })
      .catch((error: unknown) => {
        this.botNotice = error instanceof Error ? error.message : "Could not restore that bot.";
        this.botNoticeFailed = true;
      })
      .finally(() => {
        this.botPendingId = "";
      });
  };

  private pauseBotArchiveToast = () => {
    if (this.botArchiveToastTimer) clearTimeout(this.botArchiveToastTimer);
    this.botArchiveToastTimer = undefined;
  };

  private dismissBotArchiveToast = () => {
    this.pauseBotArchiveToast();
    this.botArchiveToast = undefined;
  };

  /** Same lifetime as the session archive toast: 15 s without hover or focus. */
  private scheduleBotArchiveToast = () => {
    this.pauseBotArchiveToast();
    if (!this.botArchiveToast || this.botArchiveToast.restoring || this.botArchiveToast.error) return;
    const element = this.querySelector(".bot-archive-toast");
    if (element?.matches(":hover") || element?.contains(document.activeElement)) return;
    this.botArchiveToastTimer = setTimeout(this.dismissBotArchiveToast, 15_000);
  };

  private restoreArchivedBot = async () => {
    const toast = this.botArchiveToast;
    if (!toast || toast.restoring) return;
    this.pauseBotArchiveToast();
    this.botArchiveToast = { bot: toast.bot, restoring: true };
    try {
      const restored = await restoreBot(toast.bot.id);
      this.bots = upsertBot(this.bots, restored);
      if (this.botArchiveToast?.bot.id === toast.bot.id) this.dismissBotArchiveToast();
      this.botNotice = `Restored ${restored.name}. Its routines stay paused until you turn them on.`;
      this.botNoticeFailed = false;
      void this.refreshBots();
      void this.refreshSessions(true);
    } catch (error) {
      if (this.botArchiveToast?.bot.id === toast.bot.id) {
        this.botArchiveToast = { bot: toast.bot, restoring: false, error: error instanceof Error ? error.message : "Could not restore that bot." };
      }
    }
  };

  private botPanelVisible(): boolean {
    return this.view === "bot" && !this.settingsOpen && (this.mobileNavLayout ? this.botSheetOpen : this.botPanel.open);
  }

  private botMemoryTabVisible(): boolean {
    return this.botPanelVisible() && this.botPanel.tab === "memory";
  }

  private botSoulTabVisible(): boolean {
    return this.botPanelVisible() && this.botPanel.tab === "soul";
  }

  private botToolsTabVisible(): boolean {
    return this.botPanelVisible() && this.botPanel.tab === "tools";
  }

  /** The open Tools tab follows the bots stream: a request that waits, or lists a grant changed, reads it again. */
  private followBotTools() {
    const bot = this.botToolsTabVisible() ? this.activeBot() : undefined;
    if (bot) this.botTools.follow(bot);
  }

  /** The Routines tab's Triggers section starts reading once the bot is known (a `/bots/<id>` load), and reads again
   * when the bot's chat changes state: a trigger may just have woken it. */
  private followBotTriggers() {
    const bot = this.botPanelVisible() && this.botPanel.tab === "routines" ? this.activeBot() : undefined;
    if (bot) this.botTriggers.follow(bot);
  }

  /** The panel's visible tab decides what is read: Routines polls Automation
   * like its page; Memory reads once, then follows the bots stream. */
  private syncBotPanelData() {
    if (this.embeddedPane) return;
    const visible = this.botPanelVisible();
    if (visible && this.botPanel.tab === "routines") {
      this.loadAutomationData();
      this.startAutomationPolling();
    } else if (this.view === "bot") {
      this.stopAutomationPolling();
    }
    this.botTriggers.sync(visible && this.botPanel.tab === "routines" ? this.activeBot() : undefined);
    if (this.botMemoryTabVisible()) void this.refreshBotMemory();
    if (this.botSoulTabVisible()) void this.refreshBotSoul();
    const toolsBot = this.botToolsTabVisible() ? this.activeBot() : undefined;
    if (toolsBot) void this.botTools.refresh(toolsBot);
    // The Settings tab's model pickers read PI's catalog, as New Session does.
    if (visible && this.botPanel.tab === "settings") this.loadLaunchPreferences();
  }

  /** The open Memory tab stays live without a timer: the bots stream carries
   * each bot's memory status, and a status other than the one on screen means
   * the memory moved (a message joined, a summary was built, a turn waits). */
  private followBotMemory() {
    if (!this.botMemoryTabVisible()) return;
    const bot = this.activeBot();
    if (bot && this.botMemory.botId === bot.id && memoryStatusChanged(this.botMemory.status, bot.memory)) void this.refreshBotMemory();
  }

  private toggleBotPanel = () => {
    if (this.mobileNavLayout) {
      this.botSheetOpen = !this.botSheetOpen;
    } else {
      this.botPanel = { ...this.botPanel, open: !this.botPanel.open };
      writeBotPanel(this.botPanel);
    }
    this.automationFormError = "";
    this.automationActionError = "";
    this.syncBotPanelData();
    if (this.botPanelVisible()) {
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.bot-panel [role="tab"][aria-selected="true"]')?.focus());
    }
  };

  private closeBotPanel = () => {
    if (this.mobileNavLayout) this.botSheetOpen = false;
    else {
      this.botPanel = { ...this.botPanel, open: false };
      writeBotPanel(this.botPanel);
    }
    this.syncBotPanelData();
    void this.updateComplete.then(() => this.botPaneApp()?.updateComplete).then(() => {
      this.renderRoot.querySelector<HTMLElement>(".bot-panel-toggle")?.focus();
    });
  };

  private selectBotPanelTab = (tab: BotPanelTab) => {
    this.botPanel = { ...this.botPanel, tab };
    writeBotPanel(this.botPanel);
    this.syncBotPanelData();
  };

  /** The open Soul tab follows SOUL.md without a timer: a new `botSoulKey` on the bots stream, once the bot's turn is
   * over, means the bot or HUI may have written it. */
  private followBotSoul() {
    if (!this.botSoulTabVisible()) return;
    const bot = this.activeBot();
    if (!bot || this.botSoul.botId !== bot.id || bot.status === "running" || bot.status === "waiting") return;
    if (botSoulKey(bot) !== this.botSoulSeen) void this.refreshBotSoul();
  }

  private resetBotSoul(botId: string) {
    this.botSoulRequest += 1;
    this.botSoul = { botId, loading: false, error: "" };
    this.botSoulDraft = undefined;
    this.botSoulSaving = false;
    this.botSoulSaveError = "";
    this.botSoulSeen = "";
  }

  /** Reads SOUL.md; an open editor keeps its text, and a failed read keeps what was shown. */
  private refreshBotSoul = async () => {
    const bot = this.activeBot();
    if (!bot) return;
    if (this.botSoul.botId !== bot.id) this.resetBotSoul(bot.id);
    const request = ++this.botSoulRequest;
    this.botSoulSeen = botSoulKey(bot);
    this.botSoul = { ...this.botSoul, loading: true };
    try {
      const soul = await loadBotSoul(bot.id);
      if (request !== this.botSoulRequest) return;
      this.botSoul = { botId: bot.id, loading: false, error: "", soul };
    } catch (error) {
      if (request !== this.botSoulRequest) return;
      this.botSoul = { ...this.botSoul, loading: false, error: error instanceof Error ? error.message : "Could not read the bot's soul." };
    }
  };

  /** Opens the editor on SOUL.md, or empty for Write it yourself. */
  private editBotSoul = () => {
    this.botSoulSaveError = "";
    this.botSoulDraft = this.botSoul.soul ?? "";
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLTextAreaElement>(".bot-soul__textarea")?.focus());
  };

  private cancelBotSoulEdit = () => {
    this.botSoulDraft = undefined;
    this.botSoulSaveError = "";
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".bot-soul__edit, .bot-soul__write")?.focus());
  };

  /** Nothing changes until the gateway stored it; a refusal stays in the editor with its text. */
  private saveBotSoulDraft = () => {
    const bot = this.activeBot();
    const draft = this.botSoulDraft;
    if (!bot || draft === undefined || this.botSoulSaving) return;
    this.botSoulSaving = true;
    this.botSoulSaveError = "";
    void saveBotSoul(bot.id, draft)
      .then((soul) => {
        if (this.botSoul.botId !== bot.id) return;
        // A read already on its way must not put back what this save replaced.
        this.botSoulRequest += 1;
        this.botSoul = { botId: bot.id, loading: false, error: "", soul };
        this.botSoulDraft = undefined;
        void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".bot-soul__edit, .bot-soul__write")?.focus());
      })
      .catch((error: unknown) => {
        this.botSoulSaveError = error instanceof Error ? error.message : "Could not save the soul.";
      })
      .finally(() => {
        this.botSoulSaving = false;
      });
  };

  private resetBotMemory(botId: string) {
    this.botMemoryRequest += 1;
    this.botMemoryInFlight = false;
    this.botMemoryAgain = false;
    this.botMemory = { botId, loading: false, error: "" };
    this.botMemoryZoom = new Map();
  }

  /** A manual refresh shows itself; a live one only replaces what changed. */
  private refreshBotMemory = async (manual = false) => {
    const bot = this.activeBot();
    if (!bot) return;
    if (this.botMemory.botId !== bot.id) this.resetBotMemory(bot.id);
    if (this.botMemoryInFlight) {
      this.botMemoryAgain = true;
      return;
    }
    this.botMemoryInFlight = true;
    const request = ++this.botMemoryRequest;
    if (manual || !this.botMemory.status) this.botMemory = { ...this.botMemory, loading: true };
    try {
      const memory = await loadBotMemory(bot.id);
      if (request !== this.botMemoryRequest) return;
      this.botMemory = { botId: bot.id, loading: false, error: "", status: memory.status, lines: parseMemoryView(memory.view) };
    } catch (error) {
      if (request !== this.botMemoryRequest) return;
      this.botMemory = { ...this.botMemory, loading: false, error: error instanceof Error ? error.message : "Could not read the bot's memory." };
    } finally {
      if (request === this.botMemoryRequest) {
        this.botMemoryInFlight = false;
        if (this.botMemoryAgain) {
          this.botMemoryAgain = false;
          if (this.botMemoryTabVisible()) void this.refreshBotMemory();
        }
      }
    }
  };

  /** Opens a line into its two halves (or a message whole); again folds it. */
  private zoomBotMemoryLine = (line: MemoryLine) => {
    const bot = this.activeBot();
    if (!bot) return;
    const next = new Map(this.botMemoryZoom);
    if (next.delete(line.address)) {
      this.botMemoryZoom = next;
      return;
    }
    next.set(line.address, { loading: true, error: "", lines: [] });
    this.botMemoryZoom = next;
    const settle = (state: MemoryZoomState) => {
      if (this.botMemory.botId !== bot.id || !this.botMemoryZoom.has(line.address)) return;
      this.botMemoryZoom = new Map(this.botMemoryZoom).set(line.address, state);
    };
    void zoomBotMemory(bot.id, line)
      .then((text) => settle({ loading: false, error: "", lines: parseMemoryZoom(text, line) }))
      .catch((error: unknown) => settle({ loading: false, error: error instanceof Error ? error.message : "Could not open that line.", lines: [] }));
  };

  private renderBotWorkspace() {
    const bot = this.activeBot();
    const placeholder = (title: string, message: string, tone: "status" | "alert", onRetry?: () => void, actionLabel?: string) => renderBotPlaceholder({
      title, message, tone, mobileNav: this.mobileNavLayout, onToggleNavigation: toggleNavigationDrawer, ...(onRetry ? { onRetry } : {}), ...(actionLabel ? { actionLabel } : {}),
    });
    if (!bot) {
      if (!this.botsLoaded) {
        return this.botsError
          ? placeholder("Bot", this.botsError, "alert", this.retryBots)
          : placeholder("Bot", "Loading bot…", "status");
      }
      return placeholder("Bot not found", "This bot does not exist or has been archived.", "alert");
    }
    // Its chat opens again once it is restored; until then it takes no messages from here.
    if (bot.archived) {
      return placeholder(bot.name, `${bot.name} is archived. Its chat and memory are kept; restore it to open the chat again.`, "status",
        () => this.restoreBotFromRoster(bot), this.botPendingId === bot.id ? "Restoring…" : "Restore");
    }
    const session = this.listedSession(bot.sessionId);
    if (!session) {
      return this.sessionsError
        ? placeholder(bot.name, this.sessionsError, "alert", () => void this.refreshSessions())
        : placeholder(bot.name, `Opening ${bot.name}'s chat…`, "status");
    }
    const sheet = this.mobileNavLayout;
    const panelOpen = sheet ? this.botSheetOpen : this.botPanel.open;
    const panelId = `bot-panel-${bot.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const paneBot: PaneBot = {
      bot: {
        id: bot.id, name: bot.name, ...(bot.title ? { title: bot.title } : {}), ...(bot.avatar ? { avatar: bot.avatar } : {}),
        ...(bot.memory ? { memory: bot.memory } : {}), ...(bot.worker ? { worker: bot.worker } : {}),
      },
      panelOpen,
      panelId,
    };
    const call = this.voice.call?.bot.id === bot.id ? this.voice.call : undefined;
    const settingsCall = this.botSettingsCall();
    const utilityDefault = this.utilityModelName();
    // A call under way stays reachable even if the ChatGPT login went meanwhile.
    const paneCall: PaneCall | undefined = call || this.callsAvailable() ? { botId: bot.id, inCall: Boolean(call) } : undefined;
    return html`<div class="bot-workspace ${panelOpen && !sheet ? "bot-workspace--panel" : ""}" data-bot-id=${bot.id}>
      <div class="bot-workspace__chat">
        ${call?.minimized ? renderCallBar({ ...this.callViewProps(bot, call), floating: false }) : nothing}
        ${keyed(bot.id, html`<hui-app
          class="hui-session-pane-app bot-workspace__pane"
          embedded-pane
          pane-session-id=${bot.sessionId}
          .paneSession=${session}
          .paneId=${`bot-${bot.id}`}
          .paneActive=${true}
          .paneVisible=${true}
          .paneNarrow=${sheet}
          .paneMobileNav=${this.mobileNavLayout}
          .paneBot=${paneBot}
          .onPaneBotPanel=${this.toggleBotPanel}
          .onPaneBotAction=${(action: BotHeaderAction) => {
            if (action === "edit") this.openEditBot(bot);
            else if (action === "archive") this.requestArchiveBot(bot);
            else this.requestDeleteBot(bot);
          }}
          .onPaneNavigate=${(id: string) => {
            const target = this.listedSession(id);
            if (target && id !== bot.sessionId) this.selectSession(target);
          }}
          .onPaneRegistryChange=${() => this.refreshSessions(true).then(() => this.updateComplete).then(() => {})}
          .paneGroups=${this.sessionListRevision ? this.groups : undefined}
          .onPaneUpdate=${(text: string, attachments: readonly Attachment[]) => this.handleUpdateCommand(text, attachments)}
          .onPaneDraftChange=${(sessionId: string, hasDraft: boolean) => this.markSessionDraft(sessionId, hasDraft)}
          .paneCall=${paneCall}
          .onPaneCall=${paneCall ? this.paneCallAction(bot) : undefined}
        ></hui-app>`)}
        ${call && !call.minimized ? renderCallView(this.callViewProps(bot, call)) : nothing}
      </div>
      ${panelOpen ? renderBotPanel({
        bot,
        id: panelId,
        tab: this.botPanel.tab,
        sheet,
        timezone: localTimezone(),
        onTab: this.selectBotPanelTab,
        onClose: this.closeBotPanel,
        routines: {
          automation: this.automation,
          error: this.automationError,
          pending: this.automationPending,
          formError: this.automationFormError,
          actionError: this.automationActionError,
          onCreate: this.createAutomationTask,
          onFormError: this.reportAutomationFormError,
          onSetEnabled: this.setAutomationEnabled,
          onRun: this.runAutomationTaskNow,
          onDelete: this.deleteAutomationTask,
          onRetry: this.loadAutomationData,
        },
        memory: {
          state: this.botMemory.botId === bot.id ? this.botMemory : { loading: true, error: "" },
          zoom: this.botMemoryZoom,
          onZoom: this.zoomBotMemoryLine,
          onRefresh: () => void this.refreshBotMemory(true),
          pageUrl: botMemoryPageUrl(bot.id),
        },
        soul: {
          state: this.botSoul.botId === bot.id ? this.botSoul : { loading: true, error: "" },
          draft: this.botSoul.botId === bot.id ? this.botSoulDraft : undefined,
          saving: this.botSoulSaving,
          saveError: this.botSoulSaveError,
          onEdit: this.editBotSoul,
          onDraft: (text) => { this.botSoulDraft = text; },
          onSave: this.saveBotSoulDraft,
          onCancel: this.cancelBotSoulEdit,
          onRetry: () => void this.refreshBotSoul(),
        },
        tools: this.botTools.props(bot),
        triggers: this.botTriggers.props(bot),
        settings: {
          models: this.pi?.model.catalog ?? [],
          ...(utilityDefault ? { utilityDefault } : {}),
          saves: this.botSettingsSavesOf(bot.id),
          onChange: (key, value) => this.changeBotSetting(bot.id, key, value),
          onDismiss: (key) => this.dismissBotSetting(bot.id, key),
          call: settingsCall,
          workersExist: this.launchWorkers.length > 0,
          // A bot on a worker works in a folder there: its folders come from that worker, never from this machine.
          directory: {
            suggestions: this.directorySuggestionsFrom === (bot.worker?.id ?? "") ? this.directorySuggestions : [],
            onInput: (value) => this.loadDirectorySuggestions(value, bot.worker?.id),
          },
        },
      }) : nothing}
    </div>`;
  }

  private renderBotDialogs() {
    if (this.embeddedPane) return nothing;
    return html`${this.botArchive ? renderBotArchiveDialog(this.botArchive, this.botArchivePending, this.botArchiveError, this.confirmArchiveBot, this.closeBotArchive) : nothing}
    ${this.botDelete ? renderBotDeleteDialog(this.botDelete, this.botDeletePending, this.botDeleteError, this.confirmDeleteBot, this.closeBotDelete) : nothing}
    ${this.renderBotTemplateDialogs()}`;
  }

  private renderBotTemplateDialogs() {
    const importing = this.botImports.importProps();
    const exporting = this.botImports.exportProps();
    return html`${importing ? renderBotImportDialog(importing) : nothing}${exporting ? renderBotExportDialog(exporting) : nothing}`;
  }

  /* ── calls with bots (HUI-18) ─────────────────────────────────────────── */

  /** Captures only the bot's id: a rendered button may keep an older closure, and the bot is read again when used. */
  private paneCallAction(bot: BotView): () => void {
    const botId = bot.id;
    return () => {
      const current = this.bots.find((candidate) => candidate.id === botId);
      if (current) this.openCall(current);
    };
  }

  /** Calls a bot (or returns to its call) and shows its view. One call at a time, on GPT-Live. */
  private openCall = (bot: BotView) => {
    if (!this.voice.startCall({ id: bot.id, sessionId: bot.sessionId, name: bot.name })) {
      this.botNotice = `Hang up the call with ${this.voice.call?.bot.name ?? "the other bot"} first.`;
      this.botNoticeFailed = true;
      return;
    }
    if (this.view !== "bot" || this.activeBotId !== bot.id || this.settingsOpen) this.navigate({ kind: "bot", id: bot.id });
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".bot-call__control--hangup, .bot-call__close")?.focus());
  };

  /** After the call view closes, focus returns to the chat it covered. */
  private focusBotChat() {
    void this.updateComplete.then(() => this.botPaneApp()?.updateComplete).then(() => {
      this.botPaneApp()?.renderRoot.querySelector<HTMLElement>(".bot-call-toggle, .agent-chat__composer-combobox > textarea")?.focus();
    });
  }

  private callViewProps(bot: Pick<BotView, "id" | "name" | "title" | "avatar" | "sessionId" | "memory">, call: NonNullable<VoiceController["call"]>): CallViewProps {
    return {
      bot: { id: bot.id, name: bot.name, ...(bot.title ? { title: bot.title } : {}), ...(bot.avatar ? { avatar: bot.avatar } : {}) },
      state: call.state,
      now: this.voice.now,
      summarizing: Boolean(bot.memory?.waiting),
      // Read every animation frame by the face, never rendered: the bot's voice while it speaks, else the microphone.
      level: this.callLevel,
      onToggleMic: () => this.voice.toggleMic(),
      onToggleSpeaker: () => this.voice.toggleSpeaker(),
      onMinimize: () => {
        this.voice.minimize();
        void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".bot-call-bar__open")?.focus());
      },
      onExpand: () => {
        if (this.view !== "bot" || this.activeBotId !== bot.id || this.settingsOpen) this.navigate({ kind: "bot", id: bot.id });
        this.voice.expand();
        void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(".bot-call__control--hangup")?.focus());
      },
      onHangUp: () => {
        this.voice.hangUp();
        this.focusBotChat();
      },
      onClose: () => {
        this.voice.closeCall();
        this.focusBotChat();
      },
    };
  }

  private readonly callLevel = (): number | undefined =>
    this.voice.call?.state.phase === "speaking" ? this.voice.voiceLevel() : this.voice.micLevel();

  /** The call, while the operator is elsewhere in HUI (another page, another bot, Settings). */
  private floatingCall() {
    const call = this.voice.call;
    if (this.embeddedPane || !call) return undefined;
    if (this.view === "bot" && this.activeBotId === call.bot.id && !this.settingsOpen) return undefined;
    return call;
  }

  /** That call stays in sight in a band above the page's content (`shell--call-bar` makes room), never over it. */
  private renderFloatingCallBar() {
    const call = this.floatingCall();
    if (!call) return nothing;
    const bot = this.bots.find((candidate) => candidate.id === call.bot.id) ?? { id: call.bot.id, name: call.bot.name, sessionId: call.bot.sessionId };
    return renderCallBar({ ...this.callViewProps(bot, call), floating: true });
  }

  /* ── settings ─────────────────────────────────────────────────────────── */

  private async save(patch: Partial<Settings>) {
    const revision = ++this.settingsSaveRevision;
    const pending = patchSettings(patch);
    // Render the store's optimistic snapshot before another control builds a
    // nested patch. Waiting for disk here reintroduced stale Labs/Chat values.
    this.settings = currentSettings();
    const saved = await pending;
    if (revision !== this.settingsSaveRevision) return;
    this.saveFailed = !saved;
    this.settings = currentSettings();
  }

  private chooseMode = (mode: ThemeMode) => {
    applyMode(mode);
    void this.save({ themeMode: mode });
  };

  private chooseTheme = (id: string) => {
    void this.applyTheme(id);
  };

  private chooseAccent = (accent: string) => {
    applyAccent(accent);
    void this.save({ accent });
  };

  private async applyTheme(id: string) {
    // Read the selection back rather than assuming it: a theme whose file fails
    // to load is not applied, and the picker has to snap back to the old one.
    const variant = await applyTheme(id);
    this.themeId = selectedThemeId();
    this.variant = variant ?? this.variant;
    if (variant) {
      await this.save({ theme: selectedThemeId() });
    }
  }

  private importTheme = (url: string) => {
    this.themeImportNote = "Importing…";
    this.themeImportFailed = false;
    void importTheme(url)
      .then(async (id) => {
        this.previews = await loadThemePreviews();
        this.themeImportNote = `Imported ${id}.`;
        this.themeImportFailed = false;
        await this.applyTheme(id);
      })
      .catch((error: unknown) => {
        this.themeImportNote = error instanceof Error ? error.message : "Import failed.";
        this.themeImportFailed = true;
      });
  };

  private closeSettings = () => {
    const exit = settingsCloseNavigation(this.settingsReturnTarget);
    this.navigate(exit.target, exit.replace);
  };

  /**
   * pi's configuration is read on demand rather than at boot: it costs a
   * filesystem walk, and most sessions never open Settings.
   */
  private openSettings = () => {
    const current = resolveNavigation(window.location.pathname).target;
    this.settingsReturnTarget = settingsReturnTarget(current);
    this.navigate({ kind: "settings", page: this.settingsPage });
  };

  private loadSettingsData = () => {
    const stale = Boolean(this.piError || this.healthError || this.workspaceError);
    if (stale || !this.pi || !this.health || !this.workspaceInspection) {
      this.loadControlSurfaceData(stale);
    }
    this.loadAutomationData();
  };

  private loadAutomationData = () => {
    this.automationError = "";
    void loadAutomation()
      .then((snapshot) => {
        this.automation = snapshot;
      })
      .catch((error: unknown) => {
        this.automationError = error instanceof Error ? error.message : "Could not read automation state.";
      });
  };

  /**
   * Run status settles in the scheduler, not in the browser, so the open page
   * re-reads it instead of trusting the snapshot it already has.
   */
  private startAutomationPolling() {
    if (this.automationPoll !== undefined) return;
    this.automationPoll = window.setInterval(() => {
      if (!this.automationPending) this.loadAutomationData();
    }, AUTOMATION_POLL_MS);
  }

  private stopAutomationPolling() {
    if (this.automationPoll === undefined) return;
    window.clearInterval(this.automationPoll);
    this.automationPoll = undefined;
  }

  /**
   * Every automation mutation resolves to a fresh snapshot, so the surface never
   * guesses at scheduler state it does not own.
   */
  private runAutomationMutation = (
    mutate: () => Promise<AutomationSnapshot | void>,
    /** Where a rejection belongs: the create form, or the list that was acted on. */
    surface: "form" | "action",
  ): Promise<boolean> => {
    if (this.automationPending) return Promise.resolve(false);
    this.automationPending = true;
    this.automationFormError = "";
    this.automationActionError = "";
    return mutate()
      .then((snapshot) => {
        if (snapshot) this.automation = snapshot;
        else this.loadAutomationData();
        return true;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "The automation request failed.";
        if (surface === "form") this.automationFormError = message;
        else this.automationActionError = message;
        return false;
      })
      .finally(() => {
        this.automationPending = false;
      });
  };

  private createAutomationTask = (input: AutomationTaskInput) =>
    this.runAutomationMutation(() => createAutomationTask(input), "form");

  private editAutomationTask = (task: AutomationTask) => {
    this.automationEditingId = task.id;
    this.automationFormError = "";
    queueMicrotask(() => this.renderRoot.querySelector<HTMLFormElement>("#automation-task-form")?.scrollIntoView({ block: "start" }));
  };

  private cancelAutomationEdit = () => {
    this.automationEditingId = "";
    this.automationFormError = "";
  };

  private updateAutomationTask = (task: AutomationTask, input: AutomationTaskInput) =>
    this.runAutomationMutation(() => updateAutomationTask(task.id, input), "form");

  private setAutomationEnabled = (task: AutomationTask, enabled: boolean) => {
    this.runAutomationMutation(() =>
      updateAutomationTask(task.id, {
        name: task.name,
        description: task.description,
        sessionId: task.sessionId,
        prompt: task.prompt,
        schedule: task.schedule,
        enabled,
        timeoutSeconds: task.timeoutSeconds,
      }),
      "action",
    );
  };

  private deleteAutomationTask = (task: AutomationTask) => {
    this.runAutomationMutation(() => deleteAutomationTask(task.id), "action");
  };

  private runAutomationTaskNow = (task: AutomationTask) => {
    this.runAutomationMutation(async () => {
      await runAutomationTask(task.id);
    }, "action");
  };

  private cancelAutomationRun = (run: AutomationRun) => {
    this.runAutomationMutation(async () => {
      await cancelAutomationRun(run.id);
    }, "action");
  };

  private reportAutomationFormError = (message: string) => {
    this.automationFormError = message;
  };

  private loadControlSurfaceData = (force = false) => {
    if (this.controlLoading) return;
    if (!force && this.pi && this.health && this.workspaceInspection) return;
    this.controlLoading = true;
    this.piLoading = true;
    this.piError = "";
    this.healthError = "";
    this.workspaceError = "";
    void Promise.allSettled([loadPiConfig(), loadGatewayHealth(), loadWorkspaceInspection()])
      .then(([pi, health, workspaces]) => {
        const message = (reason: unknown, fallback: string) =>
          reason instanceof Error ? reason.message : fallback;
        if (pi.status === "fulfilled") {
          this.pi = pi.value;
          this.seedLaunchPreferences(pi.value);
        }
        else this.piError = message(pi.reason, "Could not read PI configuration.");
        if (health.status === "fulfilled") this.health = health.value;
        else this.healthError = message(health.reason, "Could not read gateway health.");
        if (workspaces.status === "fulfilled") this.workspaceInspection = workspaces.value;
        else this.workspaceError = message(workspaces.reason, "Could not inspect workspaces.");
      })
      .finally(() => {
        this.controlLoading = false;
        this.piLoading = false;
      });
  };

  private seedLaunchPreferences(snapshot: PiSnapshot) {
    if (!this.launchModel) {
      this.launchModel = this.settings.models.primary || (
        snapshot.model.defaultProvider && snapshot.model.defaultModel
          ? `${snapshot.model.defaultProvider}/${snapshot.model.defaultModel}`
          : ""
      );
    }
    if (!this.launchThinking) this.launchThinking = snapshot.model.thinking ?? "medium";
  }

  private loadLaunchWorkers() {
    void loadWorkers().then((list) => {
      this.launchWorkers = list;
      if (this.launchWorker && !list.some((worker) => worker.id === this.launchWorker)) this.launchWorker = undefined;
    }).catch(() => undefined);
  }

  private loadLaunchPreferences() {
    if (this.pi) {
      this.seedLaunchPreferences(this.pi);
      return;
    }
    if (this.launchPiRequest) return;
    this.piLoading = true;
    this.launchPiRequest = loadPiConfig()
      .then((snapshot) => {
        this.pi = snapshot;
        this.piError = "";
        this.seedLaunchPreferences(snapshot);
      })
      .catch((error: unknown) => {
        this.piError = error instanceof Error ? error.message : "Could not read PI configuration.";
      })
      .finally(() => {
        this.piLoading = false;
        this.launchPiRequest = undefined;
      });
  }

  private runPiMutation(
    kind: PiMutationKind,
    target: string,
    operation: () => Promise<PiMutationResult>,
  ) {
    if (this.piOperation?.status === "running") return;
    this.piOperation = { kind, target, status: "running", message: kind === "skill-install" ? "The installer agent is inspecting the skill source." : "PI is updating its package configuration." };
    void operation()
      .then((result) => {
        this.pi = result.snapshot;
        this.piOperation = { kind, target: result.target, status: "ok", message: result.message };
        this.piRemoveCandidate = "";
      })
      .catch((error: unknown) => {
        this.piOperation = {
          kind,
          target,
          status: "error",
          message: error instanceof Error ? error.message : "PI operation failed.",
        };
      });
  }

  private installPiPackage = (url: string) => {
    this.runPiMutation("package-install", url, () => installPiPackage(url));
  };

  private requestPiPackageRemoval = (source: string) => {
    this.piRemoveCandidate = source;
  };

  private cancelPiPackageRemoval = () => {
    this.piRemoveCandidate = "";
  };

  private removePiPackage = (source: string) => {
    this.runPiMutation("package-remove", source, () => removePiPackage(source));
  };

  private installPiSkill = (url: string) => {
    this.runPiMutation("skill-install", url, () => installPiSkill(url));
  };

  private setPiSkillEnabled = (skill: PiSnapshot["skills"][number], enabled: boolean) => {
    const disabledSkills = this.settings.disabledSkills.filter((entry) => entry.path !== skillPreferencePath(skill) && entry.path !== skill.path);
    if (!enabled) disabledSkills.push({ name: skill.name, path: skillPreferencePath(skill) });
    void this.save({ disabledSkills });
  };

  private setPiPluginEnabled = (resource: PiSnapshot["settings"]["resources"][number], enabled: boolean) => {
    const disabledPlugins = this.settings.disabledPlugins.filter((entry) => entry.id !== resource.id);
    if (!enabled) disabledPlugins.push({ id: resource.id, name: resource.label, kind: resource.kind });
    void this.save({ disabledPlugins });
  };

  private readPiResource = (kind: "skill" | "plugin", resource: { id: string; name?: string; label?: string }) => {
    const title = resource.name ?? resource.label ?? "PI resource";
    const request = ++this.piResourceReaderRequest;
    if (this.piResourceCopyTimer !== undefined) window.clearTimeout(this.piResourceCopyTimer);
    this.piResourceCopyTimer = undefined;
    this.piResourceReaderReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.piResourceReader = { title, status: "loading" };
    void loadPiResource(kind, resource.id).then(
      (document) => {
        if (request === this.piResourceReaderRequest) this.piResourceReader = { title, status: "ready", document };
      },
      (error: unknown) => {
        if (request === this.piResourceReaderRequest) {
          this.piResourceReader = { title, status: "error", error: error instanceof Error ? error.message : "Could not read this resource." };
        }
      },
    );
  };

  private copyPiResource = () => {
    const reader = this.piResourceReader;
    if (!reader?.document) return;
    const resourceId = reader.document.id;
    void writeClipboardText(reader.document.content).then((copied) => {
      if (!copied) throw new Error("Clipboard write failed");
      if (this.piResourceReader !== reader) return;
      this.piResourceReader = { ...reader, copied: true };
      if (this.piResourceCopyTimer !== undefined) window.clearTimeout(this.piResourceCopyTimer);
      this.piResourceCopyTimer = window.setTimeout(() => {
        const current = this.piResourceReader;
        if (current && current.document?.id === resourceId) {
          this.piResourceReader = { ...current, copied: false };
        }
      }, 1_500);
    }).catch(() => {
      this.note = "Could not copy the resource to the clipboard.";
      this.noteLevel = "error";
    });
  };

  private closePiResourceReader = () => {
    this.piResourceReaderRequest += 1;
    if (this.piResourceCopyTimer !== undefined) window.clearTimeout(this.piResourceCopyTimer);
    this.piResourceCopyTimer = undefined;
    closeModal(this.renderRoot.querySelector<HTMLDialogElement>(".pi-resource-reader-modal") ?? undefined);
    this.piResourceReader = undefined;
    const target = this.piResourceReaderReturnFocus;
    this.piResourceReaderReturnFocus = undefined;
    target?.focus();
  };

  private loadOperationalData = (force = false) => {
    if (this.observabilityLoading) return;
    this.loadControlSurfaceData(force);
    this.loadAutomationData();
    if (!force && this.observability) return;
    this.observabilityLoading = true;
    this.observabilityError = "";
    void loadObservability()
      .then((snapshot) => { this.observability = snapshot; })
      .catch((error: unknown) => { this.observabilityError = error instanceof Error ? error.message : "Could not read observability state."; })
      .finally(() => { this.observabilityLoading = false; });
  };

  private exportDiagnostics = () => {
    void downloadDiagnostics().catch((error: unknown) => {
      this.observabilityError = error instanceof Error ? error.message : "Could not export diagnostics.";
    });
  };

  private patchOwnedSettings = (patch: Partial<Settings>) => {
    void this.save(patch);
  };

  private openSurfaceSettings = (page: SettingsPage) => {
    const current = resolveNavigation(window.location.pathname).target;
    this.settingsReturnTarget = settingsReturnTarget(current);
    this.navigate({ kind: "settings", page });
  };

  private controlSurfaceError = (page: HuiPage): string => {
    if (page.id === "connection") return [this.piError, this.healthError].filter(Boolean).join(" ");
    if (page.id === "memory-import") return this.workspaceError;
    return this.piError;
  };

  private selectSettingsPage = (page: SettingsPage) => {
    // Removed settings regions still exist in the measured inventory, but are
    // intentionally unreachable in HUI's direct route state.
    const resolved = resolveNavigation(`/settings/${page}`);
    if (resolved.target.kind === "settings") {
      this.navigate(resolved.target);
    }
  };

  /** Slow facts (size, local changes, GitHub) arrive in the background; poll
   * briefly while the server reports them pending and the page is open. */
  private loadWorktreeInventory = () => {
    window.clearTimeout(this.worktreePoll);
    this.worktreePoll = undefined;
    if (this.worktreesLoading) return;
    this.worktreesLoading = true;
    this.worktreesError = "";
    void loadWorktrees()
      .then((inventory) => { this.worktreeInventory = inventory; })
      .catch((error: unknown) => { this.worktreesError = error instanceof Error ? error.message : "Could not read worktrees."; })
      .finally(() => {
        this.worktreesLoading = false;
        if (this.worktreeInventory?.pending && this.settingsOpen && this.settingsPage === "worktrees") {
          this.worktreePoll = window.setTimeout(this.loadWorktreeInventory, 1500);
        }
      });
  };

  private removeWorktreePaths = (paths: readonly string[], mode: "single" | "merged", acknowledged: readonly WorktreeRisk[] = []) => {
    if (this.worktreesRemoving || paths.length === 0) return;
    this.worktreesRemoving = true;
    this.worktreeResults = [];
    void removeWorktrees(paths, mode, acknowledged)
      .then(({ results, inventory }) => {
        this.worktreeResults = results;
        this.worktreeInventory = inventory;
      })
      .catch((error: unknown) => {
        this.worktreesError = error instanceof Error ? error.message : "Could not remove worktrees.";
      })
      .finally(() => {
        this.worktreesRemoving = false;
        this.closeWorktreeDialog();
        this.worktreeConfirm = "";
        this.loadWorktreeInventory();
      });
  };

  private selectSessions = (ids: readonly string[], checked: boolean) => {
    this.sessionsDeleteNotice = "";
    const next = new Set(this.sessionsSelected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    this.sessionsSelected = next;
  };

  private closeSessionsDeleteDialog = () => {
    if (this.sessionsDeleting) return;
    closeModal(this.renderRoot.querySelector?.(".sessions-delete-dialog") as HTMLDialogElement | undefined);
    this.sessionsDeleteConfirm = false;
  };

  /** Deletes each selected tree, then removes worktrees only those sessions used.
   * Worktree removal never forces: local changes or a non-HUI worktree keep it. */
  private deleteSelectedSessions = async (ids: readonly string[], withWorktrees: boolean) => {
    if (this.sessionsDeleting || ids.length === 0) return;
    this.sessionsDeleting = true;
    this.sessionsDeleteNotice = "";
    const all = this.groups.flatMap((group) => group.sessions);
    const deleted = new Set<string>();
    const failures: string[] = [];
    let worktreeNote = "";
    try {
      // Read links before deleting: the inventory forgets a deleted session.
      const worktrees = withWorktrees ? (await loadWorktrees()).worktrees : [];
      for (const id of ids) {
        if (deleted.has(id)) continue; // Already gone with its parent.
        try {
          await deleteSession(id);
          for (const member of sessionTreeIds(all, id)) deleted.add(member);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Could not delete ${id}.`);
        }
      }
      if (this.selected && deleted.has(this.selected.id)) this.clearSessionState();
      let removed = 0;
      const kept: string[] = [];
      for (const path of worktreesOnlyUsedBy(worktrees, deleted)) {
        const result = await removeWorktrees([path], "single").then(({ results }) => results[0]).catch(() => undefined);
        if (result?.removed) removed += 1;
        else kept.push(result?.label ?? path);
      }
      if (withWorktrees) {
        worktreeNote = ` Removed ${removed} worktree${removed === 1 ? "" : "s"}.${kept.length
          ? ` Kept ${kept.join(", ")} (local changes or not created by HUI); review ${kept.length === 1 ? "it" : "them"} in Settings → Worktrees.`
          : ""}`;
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Could not read worktrees.");
    } finally {
      const count = ids.filter((id) => deleted.has(id)).length;
      this.sessionsDeleteNotice = `Deleted ${count} session${count === 1 ? "" : "s"}.${worktreeNote}${failures.length ? ` Failed: ${failures.join("; ")}` : ""}`;
      this.sessionsSelected = new Set([...this.sessionsSelected].filter((id) => !deleted.has(id)));
      this.sessionsDeleting = false;
      this.closeSessionsDeleteDialog();
      void this.refreshSessions();
    }
  };

  private closeWorktreeDialog() {
    const dialog = this.renderRoot.querySelector?.(".worktree-remove-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
  }

  /** Copy a full path from a table row and confirm on the trigger itself. */
  private copyPath = (path: string, trigger: HTMLElement) => {
    void writeClipboardText(path).then((copied) => {
      if (!copied) return;
      trigger.dataset["copied"] = "true";
      trigger.dataset["huiTooltip"] = "Copied";
      window.setTimeout(() => { delete trigger.dataset["copied"]; trigger.dataset["huiTooltip"] = "Copy full path"; }, 1500);
    });
  };

  private openPageById(id: "new-session" | "sessions") {
    const page = HUI_PAGES.find((candidate) => candidate.id === id);
    if (page) this.openPage(page);
  }

  private openNewSession = (group?: SessionGroup) => {
    this.launchDefaults = group
      ? {
          group: group.label === "ungrouped" ? "" : group.label,
          cwd: group.cwd ?? group.sessions[0]?.cwd ?? "",
          ...(group.workspaceMode ? { workspaceMode: group.workspaceMode } : {}),
          ...(group.baseRef ? { baseRef: group.baseRef } : {}),
        }
      : undefined;
    this.workspaceBranch = "";
    this.workspaceWorktree = false;
    this.workspaceBaseRef = "";
    this.workspaceBranchSuggestionsOpen = false;
    this.gitCheckout = undefined;
    this.inspectedCheckoutDirectory = "";
    this.openPageById("new-session");
  };

  private updateSessionOptions = (options: SidebarSessionOptions) => {
    this.menuFor = "";
    this.groupMenuFor = "";
    this.sessionOptions = options;
    writeSidebarSessionOptions(options);
  };

  private openGroupAction = (action: GroupMenuAction, group?: SessionGroup) => {
    const next: typeof this.groupAction = action === "new" ? { action } : group ? { action, group } : undefined;
    if (!next) return;
    this.groupMutationError = "";
    this.groupActionReturnFocus = this.renderRoot.querySelector<HTMLElement>(
      group ? `[data-group-menu-trigger="${CSS.escape(group.label)}"]` : "[data-new-group-trigger]",
    ) ?? undefined;
    this.groupAction = next;
    if (next.action === "defaults") {
      this.groupDefaultCwd = next.group.cwd ?? next.group.sessions[0]?.cwd ?? "~/";
      this.groupDefaultMode = next.group.workspaceMode ?? "branch";
      this.groupDefaultRef = next.group.baseRef ?? "";
      this.groupCheckoutDirectory = "";
      this.requestGroupCheckout(this.groupDefaultCwd, true);
    }
  };

  private requestGroupCheckout(input: string, initial = false) {
    this.groupDefaultCwd = input;
    const directory = input.trim();
    if (directory === this.groupCheckoutDirectory && !initial) return;
    this.groupCheckoutDirectory = directory;
    const marker = ++this.groupCheckoutRequest;
    this.groupCheckout = undefined;
    this.groupCheckoutError = "";
    if (!initial) {
      this.groupDefaultMode = "branch";
      this.groupDefaultRef = "";
    }
    this.groupCheckoutLoading = Boolean(directory);
    if (!directory) return;
    void loadGitCheckout(directory).then((checkout) => {
      if (marker !== this.groupCheckoutRequest) return;
      this.groupCheckout = checkout;
      if (!checkout.available) {
        this.groupDefaultMode = "branch";
        this.groupDefaultRef = "";
      } else if (!this.groupDefaultRef) {
        this.groupDefaultRef = checkout.defaultBranch || checkout.headBranch || "HEAD";
      }
    }).catch((error: unknown) => {
      if (marker === this.groupCheckoutRequest) this.groupCheckoutError = error instanceof Error ? error.message : "Could not inspect this directory.";
    }).finally(() => {
      if (marker === this.groupCheckoutRequest) this.groupCheckoutLoading = false;
    });
  }

  private closeGroupAction = () => {
    this.groupCheckoutRequest += 1;
    const returnFocus = this.groupActionReturnFocus;
    this.groupActionReturnFocus = undefined;
    const dialog = this.renderRoot.querySelector?.(".group-action-dialog");
    if (dialog instanceof HTMLDialogElement) closeModal(dialog);
    this.groupAction = undefined;
    this.groupMutationError = "";
    void this.updateComplete.then(() => {
      const narrow = window.matchMedia(APP_SHELL_DRAWER_MEDIA).matches;
      const target = narrow
        ? this.renderRoot.querySelector<HTMLElement>(".chat-pane__nav-toggle, .topbar-nav-toggle")
        : returnFocus;
      if (target?.isConnected) target.focus();
    });
  };

  private submitGroupAction = (event: SubmitEvent) => {
    event.preventDefault();
    if (!this.groupAction || this.groupMutationPending) return;
    if (this.groupAction.action === "defaults" && (this.groupCheckoutLoading || this.groupCheckoutError)) return;
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const state = this.groupAction;
    this.groupMutationPending = true;
    this.groupMutationError = "";
    const operation = state.action === "new"
      ? createSessionGroup(value("name"))
      : state.action === "rename"
        ? updateSessionGroup(state.group.label, { name: value("name") })
        : state.action === "defaults"
          ? updateSessionGroup(state.group.label, { cwd: value("cwd"),
              workspaceMode: this.groupCheckout?.available ? this.groupDefaultMode : "",
              baseRef: this.groupCheckout?.available ? this.groupDefaultRef : "" })
          : deleteSessionGroup(state.group.label);
    void operation
      .then(({ revision, groups }) => {
        this.receiveSessionList(revision, groups);
        if (state.action === "new") {
          // A successful creation must be visible even when filters hid every row.
          this.search = "";
          this.updateSessionOptions({ ...this.sessionOptions, groupBy: "custom", status: "all", hideEmpty: "filtering" });
          const collapsed = new Set(this.collapsed);
          collapsed.delete(value("name"));
          this.collapsed = collapsed;
          try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* Keep the group visible when storage is unavailable. */ }
        }
        if (this.selected) {
          const refreshed = groups.flatMap((entry) => entry.sessions).find((session) => session.id === this.selected?.id);
          if (refreshed) this.selected = refreshed;
        }
        this.closeGroupAction();
      })
      .catch((error: unknown) => {
        this.groupMutationError = error instanceof Error ? error.message : "Could not update that group.";
      })
      .finally(() => {
        this.groupMutationPending = false;
      });
  };

  private renderGroupActionDialog() {
    const state = this.groupAction;
    if (!state) return null;
    const { action } = state;
    const title = state.action === "defaults"
      ? `New session defaults for “${sessionGroupLabel(state.group.label)}”`
      : state.action === "rename"
        ? `Rename group “${sessionGroupLabel(state.group.label)}”`
        : state.action === "new"
          ? "New group"
          : `Delete group “${sessionGroupLabel(state.group.label)}”`;
    return html`<dialog
      class="hui-modal-dialog group-action-dialog"
      aria-labelledby="group-action-title"
      @cancel=${(event: Event) => { event.preventDefault(); this.closeGroupAction(); }}
    >
      <form class="exec-approval-card" method="dialog" @submit=${this.submitGroupAction}>
        <div class="exec-approval-title" id="group-action-title">${title}</div>
        ${state.action === "defaults" ? html`
          <div class="exec-approval-sub">Choose where sessions created from this group start.</div>
          <div class="field input-dialog__field"><label for="group-default-cwd">Working directory</label>
            ${renderDirectoryPicker({ id: "group-default-cwd", label: "Working directory", value: this.groupDefaultCwd, suggestions: this.directorySuggestions, onInput: this.requestDirectorySuggestions, inputClass: "settings-input", externalLabel: true })}
          </div>
          ${this.groupCheckoutLoading ? html`<p role="status">Checking repository…</p>` : null}
          ${this.groupCheckoutError ? html`<p role="alert">${this.groupCheckoutError}</p>` : null}
          ${this.groupCheckout?.available ? html`
            <div class="field input-dialog__field"><span>Environment</span>
              ${renderPicker({ label: "Environment", value: this.groupDefaultMode, disabled: this.groupMutationPending,
                options: [{ value: "branch", label: "Branch", description: "Work in the current checkout." },
                  { value: "worktree", label: "New worktree", description: "Start each session in an isolated Git worktree." }],
                showSelectedDescription: true,
                onChange: (value) => { this.groupDefaultMode = value === "worktree" ? "worktree" : "branch"; } })}
            </div>
            <div class="field input-dialog__field"><span>Base branch</span>
              ${renderPicker({ label: "Base branch", value: this.groupDefaultRef, disabled: this.groupMutationPending,
                options: [...new Set([this.groupDefaultRef, this.groupCheckout.defaultBranch, ...this.groupCheckout.branches].filter(Boolean))].map((value) => ({ value, label: value })),
                searchable: true, searchPlaceholder: "Search branches or enter a commit",
                customOption: (query) => query.trim() ? { value: query.trim(), label: query.trim() } : null,
                onChange: (value) => { this.groupDefaultRef = value; } })}
            </div>
            ${this.groupDefaultMode === "worktree" ? html`<p class="exec-approval-sub">Choose a branch suffix when starting each session.</p>` : null}
          ` : null}
        ` : action === "delete" ? html`
          <div class="exec-approval-sub">The group is removed. Its sessions move back to OTHER.</div>
        ` : html`
          <label class="field input-dialog__field"><span>Group name</span><input class="settings-input" name="name" type="text" required maxlength="200" .value=${state.action === "rename" ? state.group.label : ""} /></label>
        `}
        ${this.groupMutationError ? html`<p class="group-action-dialog__error" role="alert">${this.groupMutationError}</p>` : null}
        <div class="exec-approval-actions">
          <button type="submit" class="btn ${action === "delete" ? "danger" : "primary"}" ?disabled=${this.groupMutationPending || (action === "defaults" && (this.groupCheckoutLoading || Boolean(this.groupCheckoutError)))}>${this.groupMutationPending ? "Saving…" : action === "delete" ? "Delete" : action === "new" ? "Create group" : "Save"}</button>
          <button type="button" class="btn" @click=${this.closeGroupAction}>Cancel</button>
        </div>
      </form>
    </dialog>`;
  }

  private homeProps(): HomeProps {
    const launchModels = this.pi?.model.catalog ?? [];
    const launchModel = resolveLaunchModel(
      launchModels,
      this.launchModel,
      `${this.pi?.model.defaultProvider}/${this.pi?.model.defaultModel}`,
    );
    return {
      session: this.selected,
      mobileNavLayout: this.embeddedPane ? this.paneMobileNav && this.paneActive : this.mobileNavLayout,
      controlScope: this.embeddedPane ? this.paneId : undefined,
      groups: this.listedGroups,
      ...(this.paneBot && this.onPaneBotPanel ? { bot: {
        ...this.paneBot,
        onTogglePanel: () => this.onPaneBotPanel?.(),
        ...(this.onPaneBotAction ? { onAction: (action: BotHeaderAction) => this.onPaneBotAction?.(action) } : {}),
      } } : {}),
      transcript: this.transcript,
      subagents: this.subagents,
      opening: this.opening,
      openError: this.openError,
      streaming: this.streaming,
      sending: this.sending,
      stopping: this.stopping,
      continuing: this.continuing,
      rewindPending: this.rewindPending,
      forkPending: Boolean(this.forkTarget),
      draft: this.draft,
      chatPreferences: this.settings.chat,
      queue: this.queue,
      thinking: this.thinking,
      question: this.question,
      connection: this.connection,
      copiedId: this.copiedId,
      ...(this.paneCall && this.onPaneCall ? { call: { inCall: this.paneCall.inCall, onCall: this.onPaneCall } } : {}),
      expandedActivityIds: this.expandedActivityIds,
      showScrollToBottom: this.showScrollToBottom,
      models: this.models,
      currentModel: this.currentModel,
      usage: this.usage,
      compaction: this.compaction,
      attachments: this.attachments,
      launching: this.launching,
      note: this.note,
      noteLevel: this.noteLevel,
      onDismissNote: () => { this.note = ""; this.noteLevel = "info"; },
      connectionNote: this.connectionNote,
      onLaunch: this.launch,
      onSelectSession: this.selectSession,
      onClosePane: this.onPaneClose,
      paneMovable: Boolean(this.onPaneClose) && !this.paneNarrow,
      onSplitPane: this.paneNarrow ? undefined : this.onPaneSplit,
      onOpenTerminal: this.onPaneTerminal ? this.openTerminal : undefined,
      onOpenBrowser: this.onPaneBrowser && this.settings.browser.enabled && this.transcript.some((item) => item.kind === "tool" && item.name === "browser")
        ? () => this.onPaneBrowser?.()
        : undefined,
      browserPreview: this.settings.browser.enabled
        ? { visible: this.paneVisible, ...(this.onPaneBrowser ? { onExpand: () => this.onPaneBrowser?.() } : {}) }
        : undefined,
      terminalOpening: this.terminalOpening,
      terminalError: this.terminalError,
      onSelectSubagent: (sessionId) => {
        const session = this.groups.flatMap((group) => group.sessions)
          .find((candidate) => candidate.id === sessionId);
        if (session) this.selectSession(session);
        else void this.refreshSessions().then(() => {
          const refreshed = this.groups.flatMap((group) => group.sessions)
            .find((candidate) => candidate.id === sessionId);
          if (refreshed) this.selectSession(refreshed);
        });
      },
      taskSuggestions: {
        suggestions: this.taskSuggestions,
        index: this.taskSuggestionIndex,
        pendingId: this.taskSuggestionPendingId,
        copied: this.copiedId === `suggestion:${this.taskSuggestions[clampSuggestionIndex(this.taskSuggestionIndex, this.taskSuggestions.length)]?.id ?? ""}`,
        onIndex: (index) => { this.taskSuggestionIndex = clampSuggestionIndex(index, this.taskSuggestions.length); },
        onStart: this.startSuggestion,
        jiraConfigured: this.jiraConfigured === true,
        onCreateJira: this.fileSuggestionInJira,
        onAddToBacklog: this.saveSuggestionToBacklog,
        onCopy: (suggestion) => { void this.copyTranscript(taskSuggestionPrompt(suggestion), `suggestion:${suggestion.id}`); },
        onDismiss: this.dismissSuggestion,
      },
      watchers: this.watchers.length ? {
        watchers: this.watchers,
        pendingId: this.watcherPendingId,
        log: this.watcherLog,
        expanded: this.expandedActivityIds,
        onGroupToggle: (open) => this.setActivityExpanded("watchers", open),
        onToggle: this.toggleWatcher,
        onStop: this.stopWatcher,
        onRestart: this.restartWatcher,
        onDismiss: this.dismissWatcher,
      } : undefined,
      onDraftChange: this.updateDraft,
      onDraftInput: this.typeDraft,
      commandMenu: {
        open: this.slashQuery !== null && !this.sending && !this.opening && !this.launching && (!this.selected || this.connection === "live"),
        commands: filterSlashCommands(this.slashQuery?.startsWith("$") ? this.commands : composerCommands(this.selected ? this.commands : [], !!this.selected, Boolean(this.selected?.bot)), this.slashQuery ?? ""),
        catalog: this.commands,
        paths: this.localPathQuery ? this.localPaths : undefined,
        pathsLoading: this.localPathsLoading,
        pathsError: this.localPathsError,
        onSelectPath: this.selectLocalPath,
        onRetryPaths: this.retryLocalPaths,
        activeIndex: this.slashActiveIndex,
        loading: this.commandsLoading,
        error: this.commandsError,
        streaming: this.streaming,
        onSelect: this.selectSlashCommand,
        onRetry: this.requestCommands,
      },
      onCommandQuery: this.setCommandQuery,
      onCommandKeydown: this.commandKeydown,
      localPathMenu: {
        open: this.localPathQuery !== null && this.slashQuery === null && !this.sending && !this.opening && this.connection === "live",
        paths: this.localPaths,
        activeIndex: this.localPathActiveIndex,
        loading: this.localPathsLoading,
        error: this.localPathsError,
        onSelect: this.selectLocalPath,
        onRetry: this.retryLocalPaths,
      },
      onLocalPathQuery: this.setLocalPathQuery,
      onLocalPathKeydown: this.localPathKeydown,
      onSendPrompt: this.send,
      onContinueInterrupted: this.continueInterrupted,
      runError: this.currentRunError(),
      onContinueAfterError: this.continueAfterError,
      onDismissRunError: this.dismissRunError,
      queueEditingId: this.queueEditingId,
      queueEditingText: this.queueEditingText,
      onQueueEdit: (id) => {
        const item = this.queue.items?.find((candidate) => candidate.id === id);
        if (!item) return;
        this.queueEditingId = id;
        this.queueEditingText = item.text;
      },
      onQueueEditChange: (text) => { this.queueEditingText = text; },
      onQueueEditSubmit: () => {
        const itemId = this.queueEditingId;
        const text = this.queueEditingText.trim();
        if (!itemId || !text) return;
        this.queueMutation({ operation: "edit", itemId, text }, () => {
          this.queueEditingId = "";
          this.queueEditingText = "";
        });
      },
      onQueueEditCancel: () => {
        this.queueEditingId = "";
        this.queueEditingText = "";
      },
      onQueueRemove: (itemId) => this.queueMutation({ operation: "remove", itemId }),
      onQueueMove: (itemId, toIndex) => this.queueMutation({ operation: "move", itemId, toIndex }),
      onQueueSteer: (itemId) => this.queueMutation({ operation: "steer", itemId }),
      onSelectModel: this.selectModel,
      onSelectThinking: this.selectThinking,
      onAbort: this.abort,
      onContinue: this.continueRun,
      onRewind: this.rewindToMessage,
      onFork: this.forkFromMessage,
      onCompact: () => this.compactNow(),
      onCancelCompaction: () => this.cancelCompactionNow(),
      onAddAttachments: this.addAttachments,
      onRemoveAttachment: this.removeAttachment,
      onCopy: this.copyTranscript,
      onActivityExpanded: this.setActivityExpanded,
      onAnswerQuestion: this.answerQuestion,
      onTranscriptScroll: this.transcriptScrolled,
      onTranscriptNavigate: this.navigateTranscript,
      onScrollToBottom: this.scrollToBottom,
      sideChat: this.sideChat,
      onCloseSideChat: () => { this.sideChat = undefined; },
      renaming: this.renamingFor === this.selected?.id,
      confirmingDelete: this.deletingFor === this.selected?.id,
      onCancelRename: this.cancelRename,
      onRename: this.rename,
      onCancelDelete: this.cancelDelete,
      onConfirmDelete: this.confirmDelete,
      onRetry: this.retrySelected,
      onReconnect: this.reconnectSelected,
      launchDefaults: this.launchDefaults,
      launchModels,
      launchModel,
      launchThinking: this.launchThinking || "medium",
      onSelectLaunchModel: (provider, modelId) => { this.launchModel = `${provider}/${modelId}`; },
      onSelectLaunchThinking: (level) => { this.launchThinking = level; },
      launchWorkers: this.launchWorkers,
      ...(this.launchWorker ? { launchWorker: this.launchWorker } : {}),
      onSelectLaunchWorker: (id) => {
        this.launchWorker = id;
        ++this.directorySuggestionRequest;
        this.directorySuggestions = [];
      },
      directorySuggestions: this.directorySuggestions,
      // Git inspection reads this machine's disk; folder suggestions come from the worker.
      onDirectoryInput: this.launchWorker ? (input) => this.loadDirectorySuggestions(input, this.launchWorker) : this.requestDirectorySuggestions,
      branchPrefix: this.settings.branchPrefix,
      gitCheckout: this.gitCheckout,
      gitCheckoutLoading: this.gitCheckoutLoading,
      workspaceWorktree: this.workspaceWorktree,
      workspaceBaseRef: this.workspaceBaseRef,
      workspaceBranchSuggestionsOpen: this.workspaceBranchSuggestionsOpen,
      workspaceBranch: this.workspaceBranch,
      worktreeProgress: this.paneCreating,
      worktreeError: this.paneCreationError,
      onWorkspaceMode: (worktree) => {
        this.workspaceWorktree = worktree;
        this.workspaceBranchSuggestionsOpen = false;
      },
      onWorkspaceBaseRef: (baseRef) => { this.workspaceBaseRef = baseRef; },
      onWorkspaceBranchSuggestionsOpen: (open) => { this.workspaceBranchSuggestionsOpen = open; },
      onWorkspaceBranch: (branch) => { this.workspaceBranch = branch; },
      onOpenBranchPrefixSettings: () => this.openSurfaceSettings("sessions"),
    };
  }

  private automationProps(): AutomationProps {
    return {
      automation: this.automation,
      automationError: this.automationError,
      automationPending: this.automationPending,
      automationFormError: this.automationFormError,
      automationActionError: this.automationActionError,
      sessions: this.groups.flatMap((group) => group.sessions),
      bots: botsEnabled(this.settings),
      onRetryAutomation: this.loadAutomationData,
      onCreateAutomationTask: this.createAutomationTask,
      automationEditingId: this.automationEditingId,
      onEditAutomationTask: this.editAutomationTask,
      onCancelAutomationEdit: this.cancelAutomationEdit,
      onUpdateAutomationTask: this.updateAutomationTask,
      onAutomationFormError: this.reportAutomationFormError,
      onSetAutomationEnabled: this.setAutomationEnabled,
      onDeleteAutomationTask: this.deleteAutomationTask,
      onRunAutomationTask: this.runAutomationTaskNow,
      onCancelAutomationRun: this.cancelAutomationRun,
    };
  }

  override render() {
    const noticesInert = this.mobileNavLayout && Boolean(this.renderRoot.querySelector('.sidebar[data-open="true"], .settings-sidebar[data-open="true"]'));
    return html`<div class="hui-application">
      ${this.embeddedPane ? null : renderUpdateNotice({
        release: availableUpdate(this.updateSnapshot, this.dismissedUpdateVersion),
        inert: noticesInert,
        onReview: this.reviewUpdate,
        onDismiss: () => {
          this.dismissedUpdateVersion = this.updateSnapshot?.check?.latest?.version ?? "";
          this.composerTextarea?.focus();
        },
      })}
      ${this.embeddedPane ? null : renderPowerNotice({
        power: this.power,
        dismissed: this.powerNoticeDismissed,
        inert: noticesInert,
        onTurnOff: () => { this.setLidAwakeFromUi(false); this.composerTextarea?.focus(); },
        onDismiss: () => { this.powerNoticeDismissed = true; this.composerTextarea?.focus(); },
      })}
      <div class="hui-workspace">${this.renderWorkspace()}</div>
      ${this.archiveToast ? html`<div class="app-toast session-archive-toast"
        @pointerenter=${this.pauseArchiveToast} @pointerleave=${this.scheduleArchiveToast}
        @focusin=${this.pauseArchiveToast} @focusout=${this.scheduleArchiveToast}>
        <span class="app-toast__message" role=${this.archiveToast.error ? "alert" : "status"}>
          ${this.archiveToast.error ?? `Archived “${this.archiveToast.session.title}”.`}
        </span>
        <button type="button" class="app-toast__action" ?disabled=${this.archiveToast.restoring}
          @click=${this.restoreArchivedSession}>${this.archiveToast.restoring ? "Restoring…" : "Restore"}</button>
        <button type="button" class="app-toast__dismiss" aria-label="Dismiss archive notification"
          @click=${this.dismissArchiveToast}><span aria-hidden="true">×</span></button>
      </div>` : null}
      ${this.botArchiveToast ? html`<div class="app-toast session-archive-toast bot-archive-toast"
        @pointerenter=${this.pauseBotArchiveToast} @pointerleave=${this.scheduleBotArchiveToast}
        @focusin=${this.pauseBotArchiveToast} @focusout=${this.scheduleBotArchiveToast}>
        <span class="app-toast__message" role=${this.botArchiveToast.error ? "alert" : "status"}>
          ${this.botArchiveToast.error ?? `Archived “${this.botArchiveToast.bot.name}”. Its chat and memory are kept.`}
        </span>
        <button type="button" class="app-toast__action" ?disabled=${this.botArchiveToast.restoring}
          @click=${this.restoreArchivedBot}>${this.botArchiveToast.restoring ? "Restoring…" : "Restore"}</button>
        <button type="button" class="app-toast__dismiss" aria-label="Dismiss archive notification"
          @click=${this.dismissBotArchiveToast}><span aria-hidden="true">×</span></button>
      </div>` : null}
    </div>`;
  }

  /** Chat panes only: terminals and the browser view live in the Work pane. */
  private renderSessionPane = (pane: SessionPane, state: PanePresentation) => html`
    <hui-app
      class="chat-split-view__pane hui-session-pane-app"
      embedded-pane
      pane-session-id=${pane.sessionId}
      .paneSession=${this.groups.flatMap((group) => group.sessions).find(({ id }) => id === pane.sessionId)}
      .paneId=${pane.id}
      .paneActive=${state.active}
      .paneVisible=${state.visible}
      .paneNarrow=${state.narrow}
      .paneMobileNav=${this.mobileNavLayout}
      .onPaneClose=${state.split ? () => this.closePane(pane.id) : undefined}
      .onPaneSplit=${!state.narrow ? (direction: SplitDirection) => this.splitPane(pane, direction) : undefined}
      .onPaneTerminal=${() => this.openTerminalWorkView(pane)}
      .onPaneBrowser=${() => this.openBrowserWorkView(pane)}
      .onPaneNavigate=${(id: string) => this.changePaneSession(pane.id, id)}
      .onPaneRegistryChange=${() => this.refreshSessions(true).then(() => this.updateComplete).then(() => {})}
      .paneCreating=${this.listedSession(pane.sessionId)?.creating}
      .paneCreationError=${this.listedSession(pane.sessionId)?.creationError}
      .paneUnsentPrompt=${this.listedSession(pane.sessionId)?.initialPrompt}
      .paneGroups=${this.sessionListRevision ? this.groups : undefined}
      .onPaneUpdate=${(text: string, attachments: readonly Attachment[]) => this.handleUpdateCommand(text, attachments)}
      .onPaneDraftChange=${(sessionId: string, hasDraft: boolean) => this.markSessionDraft(sessionId, hasDraft)}
    ></hui-app>`;

  private paneLabel = (pane: SessionPane) => this.listedSession(pane.sessionId)?.title ?? "Session";

  private listedSession(id: string): SessionView | undefined {
    return this.groups.flatMap((group) => group.sessions).find((session) => session.id === id);
  }

  private renderSessionMultiplex() {
    if (!this.selected || !this.sessionLayout) return renderHome(this.homeProps());
    const panes = sessionPanes(this.sessionLayout);
    const workSessionId = activeSessionPane(this.sessionLayout).sessionId;
    const work = sessionWorkPane(this.workPanes, workSessionId);
    this.workRetained = retainWorkSessions(this.workRetained, workSessionId, this.workPanes);
    const workShown = this.workNarrow && this.workNarrowShown;
    return html`<div class="hui-workspace-panels ${workShown ? "hui-workspace-panels--work" : ""}">
    ${renderPanelSelector({
      panes,
      activePaneId: this.sessionLayout.activePaneId,
      sessionTitle: (sessionId) => this.groups.flatMap((group) => group.sessions).find(({ id }) => id === sessionId)?.title,
      workViews: work.views.flatMap((ref) => {
        const kind = workViewKind(ref.kind);
        return kind ? [{ key: workViewKey(ref), title: kind.title(ref), icon: kind.icon }] : [];
      }),
      launchers: launchableWorkViewKinds(work).map((kind) => ({ kind: kind.kind, label: kind.label, icon: kind.icon, unavailable: kind.unavailable?.(workSessionId) })),
      activeWorkKey: workShown ? work.active ?? "" : undefined,
      workShown,
      onSelectPane: (id) => { this.workNarrowShown = false; this.focusSessionPane(id); },
      onSelectWork: (key) => { this.commitWorkPanes(activateWorkView(this.workPanes, workSessionId, key, false)); this.workNarrowShown = true; },
      onShowWork: () => { this.workNarrowShown = true; },
      onLaunch: (kind) => void this.launchWorkView(kind),
    })}
    <div class="hui-workspace-row">
    <hui-session-multiplexer
      .layout=${this.sessionLayout}
      .sessionIds=${new Set(this.groups.flatMap((group) => group.sessions.map(({ id }) => id)))}
      .draggingSessionId=${this.draggingSessionId}
      .renderPane=${this.renderSessionPane}
      .onFocusPane=${this.focusSessionPane}
      .onDropSession=${this.dropSession}
      .onMovePane=${this.movePane}
      .onClosePane=${this.closePane}
      .paneLabel=${this.paneLabel}
      .columnMinimum=${!this.workNarrow && work.open ? WORK_PANE_CHAT_MIN_WIDTH : PANE_COLUMN_MIN_WIDTH}
      .onResize=${(columnId: string | undefined, index: number, ratio: number) => {
        if (this.sessionLayout) this.sessionLayout = resizeSessionLayout(this.sessionLayout, columnId, index, ratio);
      }}
      .onResizeEnd=${() => {
        this.persistSessionLayout();
        window.history.replaceState({ ...window.history.state, huiSessionLayout: this.sessionLayout }, "");
      }}
    ></hui-session-multiplexer>
    <hui-work-pane
      .store=${this.workPanes}
      .sessionId=${workSessionId}
      .retained=${this.workRetained}
      .narrow=${this.workNarrow}
      .chatColumns=${this.sessionLayout.columns.length}
      .narrowShown=${this.workNarrowShown}
      .launchedKey=${this.workLaunchedKey}
      .launching=${this.workLaunching}
      .error=${this.workError}
      .onLaunch=${(kind: string) => void this.launchWorkView(kind)}
      .onReopen=${(ref: WorkViewRef) => this.showWorkView(workSessionId, ref)}
      .onActivate=${(key: string) => {
        // Only a view just launched may take focus; switching tabs never refocuses an older one.
        if (key !== this.workLaunchedKey) this.workLaunchedKey = "";
        this.commitWorkPanes(activateWorkView(this.workPanes, workSessionId, key));
      }}
      .onClose=${(sessionId: string, key: string) => {
        if (this.workLaunchedKey === key) this.workLaunchedKey = "";
        this.commitWorkPanes(closeWorkView(this.workPanes, sessionId, key));
      }}
      .onReorder=${(key: string, index: number) => this.commitWorkPanes(reorderWorkView(this.workPanes, workSessionId, key, index))}
      .onToggle=${(open: boolean) => this.commitWorkPanes(setWorkPaneOpen(this.workPanes, workSessionId, open))}
      .onResize=${(width: number, available: number, done: boolean) => {
        this.workPanes = setWorkPaneWidth(this.workPanes, workSessionId, width, available, this.sessionLayout?.columns.length ?? 1);
        if (done) this.persistWorkPanes();
      }}
      .onBack=${this.leaveWorkPane}
      .onEscape=${this.leaveWorkPane}
      .onDismissError=${() => { this.workError = ""; }}
    ></hui-work-pane>
    </div></div>`;
  }

  private renderWorkspace() {
    if (this.embeddedPane) {
      return html`<div class="hui-embedded-session">${this.selected ? renderHome(this.homeProps()) : html`<p role="status">Opening session…</p>`}${this.renderJiraCreateDialog()}${this.renderForkDialog()}</div>`;
    }

    if (this.settingsOpen) {
      return html`<div class="shell shell--settings settings-shell ${this.mobileNavLayout ? "shell--mobile-nav" : ""} ${this.floatingCall() ? "shell--call-bar" : ""}">
        ${renderSettingsPage({
          page: this.settingsPage,
          worktrees: {
            inventory: this.worktreeInventory,
            loading: this.worktreesLoading,
            error: this.worktreesError,
            query: this.worktreeQuery,
            filter: this.worktreeFilter,
            confirm: this.worktreeConfirm,
            removing: this.worktreesRemoving,
            results: this.worktreeResults,
            onQuery: (value) => { this.worktreeQuery = value; },
            onFilter: (filter) => { this.worktreeFilter = filter; },
            onRefresh: this.loadWorktreeInventory,
            onOpenSession: (id) => this.navigate({ kind: "session", id }),
            onRequestRemove: (path) => { this.worktreeConfirm = path; this.worktreeResults = []; },
            onRequestCleanup: () => { this.worktreeConfirm = "merged"; this.worktreeResults = []; },
            onCancel: () => { this.closeWorktreeDialog(); this.worktreeConfirm = ""; },
            onDismissResults: () => { this.worktreeResults = []; },
            onCopyPath: this.copyPath,
            onConfirmRemove: (path, acknowledged) => this.removeWorktreePaths([path], "single", acknowledged),
            onConfirmCleanup: (paths) => this.removeWorktreePaths(paths, "merged"),
          },
          pi: this.pi,
          piLoading: this.piLoading,
          piError: this.piError,
          health: this.health,
          healthError: this.healthError,
          power: this.power,
          workspaces: this.workspaceInspection,
          workspaceError: this.workspaceError,
          observability: this.observability,
          observabilityError: this.observabilityError,
          onRefreshObservability: () => this.loadOperationalData(true),
          onExportDiagnostics: this.exportDiagnostics,
          onRetryPi: () => this.loadControlSurfaceData(true),
          onSelectPage: this.selectSettingsPage,
          previews: this.previews,
          settings: this.settings,
          themeId: this.themeId,
          variant: this.variant,
          saveFailed: this.saveFailed,
          importNote: this.themeImportNote,
          importFailed: this.themeImportFailed,
          onSelectTheme: this.chooseTheme,
          onSelectMode: this.chooseMode,
          onSelectAccent: this.chooseAccent,
          onChangeBranchPrefix: (branchPrefix) => void this.save({ branchPrefix }),
          onChangeAppearance: (next) => void this.save(next),
          onChangeChat: (chat) => void this.save({ chat }),
          onChangeBrowser: (browser) => this.save({ browser }),
          onChangeCalls: (calls) => void this.save({ calls }),
          onChangePower: (power) => void this.save({ power }).then(() => this.refreshPower()),
          onSetLidAwake: this.setLidAwakeFromUi,
          onChangeModels: (models) => {
            this.launchModel = models.primary;
            void this.save({ models });
          },
          onImportTheme: this.importTheme,
          onClose: this.closeSettings,
          piOperation: this.piOperation,
          piRemoveCandidate: this.piRemoveCandidate,
          onInstallPackage: this.installPiPackage,
          onRequestRemovePackage: this.requestPiPackageRemoval,
          onCancelRemovePackage: this.cancelPiPackageRemoval,
          onConfirmRemovePackage: this.removePiPackage,
          onInstallSkill: this.installPiSkill,
          onSetSkillEnabled: this.setPiSkillEnabled,
          onSetPluginEnabled: this.setPiPluginEnabled,
          onReadSkill: (skill) => this.readPiResource("skill", skill),
          onReadPlugin: (resource) => this.readPiResource("plugin", resource),
          ...this.automationProps(),
        })}
        ${this.renderFloatingCallBar()}
        ${this.commandPalette()}
        ${this.updateDialog()}
        ${renderPiResourceReader(this.piResourceReader, this.closePiResourceReader, this.copyPiResource)}
      </div>`;
    }

    const props = {
      view: this.view,
      activePage: this.activePage,
      selectedSessionId: this.view === "bot" ? "" : this.selected?.id ?? "",
      splitSessionId: "",
      openSessionIds: new Set(this.sessionLayout && sessionPanes(this.sessionLayout).length > 1 ? sessionPanes(this.sessionLayout).map(({ sessionId }) => sessionId) : []),
      groups: this.listedGroups,
      bots: this.shellBotsProps(),
      draftSessionIds: this.draftSessionIds,
      collapsed: this.collapsed,
      loading: this.sessionsLoading,
      error: this.sessionsError,
      importNote: this.importNote,
      importFailed: this.importFailed,
      search: this.search,
      menuFor: this.menuFor,
      groupMenuFor: this.groupMenuFor,
      sessionOptions: this.sessionOptions,
      draggingSessionId: this.draggingSessionId,
      sessionDropTarget: this.sessionDropTarget,
      sessionMovePendingId: this.sessionMovePendingId,
      sessionMoveNotice: this.sessionMoveNotice,
      sessionMoveFailed: this.sessionMoveFailed,
      draggingGroup: this.draggingGroup,
      groupDropTarget: this.groupDropTarget,
      groupReorderPending: this.groupReorderPending,
      onGroupDragStart: (group: string) => {
        this.groupMenuFor = "";
        this.draggingGroup = group;
        this.groupDropTarget = undefined;
      },
      onGroupDragEnd: () => {
        this.draggingGroup = "";
        this.groupDropTarget = undefined;
      },
      onGroupDragOver: (target: GroupDropTarget) => { this.groupDropTarget = target; },
      onGroupDragLeave: (group: string) => {
        if (this.groupDropTarget?.group === group) this.groupDropTarget = undefined;
      },
      onReorderGroup: this.reorderGroup,
      onSessionOptions: this.updateSessionOptions,
      onNewGroup: () => this.openGroupAction("new"),
      onSelectView: this.selectView,
      onOpenKanban: () => this.navigate({ kind: "kanban" }),
      onOpenPage: this.openPage,
      onSelectSession: this.selectSession,
      onSplitSession: this.openSplitSession,
      onToggleGroup: this.toggleGroup,
      toggledSessionTrees: this.toggledSessionTrees,
      onToggleSessionTree: this.toggleSessionTree,
      onToggleMenu: this.toggleMenu,
      onCloseMenu: () => {
        this.menuFor = "";
      },
      onToggleGroupMenu: (group: string) => {
        this.menuFor = "";
        this.groupMenuFor = this.groupMenuFor === group ? "" : group;
      },
      onCloseGroupMenu: () => {
        this.groupMenuFor = "";
      },
      onGroupAction: this.openGroupAction,
      onNewSession: this.openNewSession,
      onRenameSession: this.renameFromMenu,
      onTogglePin: this.togglePin,
      onUpdateSession: this.setSessionMetadata,
      onCopySession: this.copySession,
      onOpenSession: this.openSessionElsewhere,
      onCreateJiraIssue: this.openJiraCreate,
      onLinkJiraIssue: this.openJiraLink,
      onSessionDragStart: (session: SessionView) => {
        this.draggingSessionId = session.id;
        this.sessionDropTarget = "";
      },
      onSessionDragEnd: () => {
        this.draggingSessionId = "";
        this.sessionDropTarget = "";
      },
      onSessionDragOver: (group: string) => { this.sessionDropTarget = group; },
      onSessionDragLeave: (group: string) => {
        if (this.sessionDropTarget === group) this.sessionDropTarget = "";
      },
      onMoveSession: this.moveSession,
      onDeleteSession: this.deleteFromMenu,
      onOpenSettings: () => {
        this.openSettings();
      },
      onSearch: this.updateSearch,
    };

    const chatLikeRoute =
      (this.view === "home" && Boolean(this.selected)) ||
      this.view === "bot" ||
      (this.view === "surface" && this.activePage?.id === "new-session");

    return html`<div
      class="shell app-shell ${this.mobileNavLayout ? "shell--mobile-nav" : ""} ${chatLikeRoute ? "shell--chat" : ""} ${chatLikeRoute && this.mobileNavLayout ? "shell--merged-chat-chrome" : ""} ${this.floatingCall() ? "shell--call-bar" : ""}"
      @keydown=${closeDrawerOnEscape}
    >
      ${renderSidebar(props)}
      ${this.renderGroupActionDialog()}
      ${this.renderJiraCreateDialog()}
      ${this.renderJiraLinkDialog()}
      ${this.renderBacklogStartDialog()}
      ${this.renderBacklogRemoveDialog()}
      ${this.renderForkDialog()}
      ${this.renderBotDialogs()}
      ${this.renderFloatingCallBar()}
      ${this.commandPalette()}
      ${this.updateDialog()}
      ${renderPiResourceReader(this.piResourceReader, this.closePiResourceReader, this.copyPiResource)}
      ${renderMain(
        props,
        this.view === "home"
          ? this.renderSessionMultiplex()
          : this.view === "bot"
            ? this.renderBotWorkspace()
          : this.view === "kanban"
            ? renderKanbanPage({
                groups: this.listedGroups,
                loading: this.sessionsLoading,
                error: this.sessionsError,
                query: this.kanbanQuery,
                options: this.kanbanOptions,
                movePendingId: this.kanbanMovePendingId,
                notice: this.kanbanNotice,
                noticeFailed: this.kanbanNoticeFailed,
                draggingId: this.kanbanDraggingId,
                dropTarget: this.kanbanDropTarget,
                onQuery: (value) => { this.kanbanQuery = value; },
                onOptions: (options) => { this.kanbanOptions = options; writeKanbanOptions(options); },
                onOpen: this.selectSession,
                onMove: this.moveKanbanSession,
                onDragStart: (id) => { this.kanbanDraggingId = id; this.kanbanDropTarget = ""; },
                onDragEnd: () => { this.kanbanDraggingId = ""; this.kanbanDropTarget = ""; },
                onDragOver: (cell) => { this.kanbanDropTarget = cell; },
                onRefresh: () => { void this.refreshSessions(); void this.refreshBacklog(true); },
                backlog: this.backlog,
                backlogLoading: this.backlogLoading,
                backlogError: this.backlogError,
                backlogJira: this.backlogJira,
                backlogPendingId: this.backlogPendingId,
                onBacklogGroup: this.setBacklogGroup,
                onBacklogStart: this.openBacklogStart,
                onBacklogAction: this.backlogCardAction,
                onSessionAction: this.kanbanSessionAction,
              })
            : this.view === "surface" && this.activePage
              ? this.activePage.id === "new-session"
                ? renderNewSession(this.homeProps())
                : this.activePage.id === "cron" || this.activePage.id === "tasks"
                  ? renderAutomationSurface(this.automationProps(), this.activePage.id === "cron" ? "Automations" : "Tasks")
                : this.activePage.id === "sessions"
                  ? renderSessionsPage({
                      groups: this.listedGroups,
                      loading: this.sessionsLoading,
                      error: this.sessionsError,
                      query: this.search,
                      state: this.sessionsPageState,
                      filters: this.sessionsPageFilters,
                      onQuery: this.updateSearch,
                      onState: (state) => { this.sessionsPageState = state; },
                      onFilters: (filters) => { this.sessionsPageFilters = filters; },
                      onOpen: this.selectSession,
                      onRestore: (session) => this.setSessionMetadata(session, { archived: false }, "Session restored."),
                      onCopyPath: this.copyPath,
                      onNew: () => this.openPageById("new-session"),
                      onRefresh: () => void this.refreshSessions(),
                      selected: this.sessionsSelected,
                      onSelect: this.selectSessions,
                      confirmingDelete: this.sessionsDeleteConfirm,
                      deleting: this.sessionsDeleting,
                      deleteNotice: this.sessionsDeleteNotice,
                      onDeleteSelected: () => { this.sessionsDeleteConfirm = true; },
                      onCancelDelete: this.closeSessionsDeleteDialog,
                      onConfirmDelete: (ids, withWorktrees) => void this.deleteSelectedSessions(ids, withWorktrees),
                    })
                  : this.activePage.id === "contributions"
                    ? html`<hui-contributions-page .onOpenSettings=${() => this.navigate({ kind: "settings", page: "integrations" })}
                      .onOpenSession=${(id: string) => this.navigate({ kind: "session", id })}></hui-contributions-page>`
                  : isPiSurface(this.activePage)
                    ? renderPiSurface({
                        page: this.activePage,
                        pi: this.pi,
                        health: this.health,
                        workspaces: this.workspaceInspection,
                        loading: this.controlLoading,
                        error: this.controlSurfaceError(this.activePage),
                        onRefresh: () => this.loadControlSurfaceData(true),
                        onOpenSettings: this.openSurfaceSettings,
                        onSessions: () => this.openPageById("sessions"),
                        operation: this.piOperation,
                        removeCandidate: this.piRemoveCandidate,
                        onInstallPackage: this.installPiPackage,
                        onRequestRemovePackage: this.requestPiPackageRemoval,
                        onCancelRemovePackage: this.cancelPiPackageRemoval,
                        onConfirmRemovePackage: this.removePiPackage,
                        onInstallSkill: this.installPiSkill,
                        disabledSkills: this.settings.disabledSkills,
                        onSetSkillEnabled: this.setPiSkillEnabled,
                        disabledPlugins: this.settings.disabledPlugins,
                        onSetPluginEnabled: this.setPiPluginEnabled,
                        onReadSkill: (skill) => this.readPiResource("skill", skill),
                        onReadPlugin: (resource) => this.readPiResource("plugin", resource),
                      })
                    : isObservabilitySurface(this.activePage)
                      ? renderObservabilitySurface({
                          page: this.activePage,
                          snapshot: this.observability,
                          health: this.health,
                          loading: this.observabilityLoading,
                          error: this.observabilityError,
                          dense: this.settings.labs.denseObservability,
                          detailedDebug: this.settings.labs.detailedDebug,
                          onRefresh: () => this.loadOperationalData(true),
                          onExport: this.exportDiagnostics,
                        })
                      : isOwnedSurface(this.activePage)
                        ? renderOwnedSurface({
                            page: this.activePage,
                            settings: this.settings,
                            health: this.health,
                            onSettings: this.patchOwnedSettings,
                          })
                    : html``
            : html``,
      )}
    </div>`;
  }
}

/** Upgrades the page's `<hui-app>`, which renders at once. */
export function defineHuiApp(): void {
  if (!customElements.get("hui-app")) customElements.define("hui-app", HuiApp);
}
