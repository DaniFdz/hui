/**
 * `ComposerController` owns the open conversation's composer outside `hui-app.ts`: its draft and attachments, kept
 * per session through `lib/composer/drafts.ts`, with the sessions that hold a draft (the sidebar's pencil); the slash
 * command menu and the commands it lists; local path and bot mention completion; and the session's message queue, with
 * the edit of one queued message and the requests that edit, remove, move and steer queued messages. The shell reads
 * its props, measures its textarea and hands it the queue from the conversation's snapshots and events.
 */
import type { LitElement, ReactiveControllerHost } from "lit";
import { loadCommands, mutateQueuedMessage, type Attachment, type QueueSnapshot, type RuntimeCommand, type SessionSnapshot, type SessionView } from "../api/sessions.ts";
import { loadLocalPathSuggestions } from "../api/local-paths.ts";
import { readAttachment, validateAttachmentTotal } from "../lib/attachments.ts";
import type { BotView } from "../lib/bots/bots.ts";
import { listComposerDraftSessionIds, mayUseComposerDraftKey, NEW_SESSION_DRAFT_KEY, readComposerDraft, sessionIdFromDraftKey, writeComposerDraft } from "../lib/composer/drafts.ts";
import { EMPTY_QUEUE } from "../lib/composer/state.ts";
import { botMentionSuggestions, completeLocalPath, type LocalPathQuery, type LocalPathSuggestion } from "../lib/local-paths.ts";
import { isSelectedSession, type NoteLevel } from "../lib/session/ui-state.ts";
import { completeCommandReference, composerCommands, filterSlashCommands, slashCommandQuery, type CommandQuery, type ComposerCommand } from "../lib/slash-commands.ts";
import type { HomeProps } from "../views/home.ts";
import type { ConversationController } from "./conversation-controller.ts";

type ComposerDeps = {
  conversation: ConversationController;
  showNote: (message: string, level: NoteLevel) => void;
  embeddedPane: () => boolean;
  /** Reports a session's draft presence to the shell that owns the sidebar; only an embedded pane does. */
  draftChanged: (sessionId: string, hasDraft: boolean) => void;
  /** The session the composer drafts for: none on New Session, which keeps the last chat selected. */
  composerSession: () => SessionView | undefined;
  /** The commands a draft without a runtime offers: the local PI skills it will start with. */
  draftCommands: () => readonly RuntimeCommand[];
  defaultCwd: () => string | undefined;
  mentionable: () => readonly BotView[];
  textarea: () => HTMLTextAreaElement | null;
  sending: () => boolean;
  launching: () => boolean;
};

type ComposerHost = ReactiveControllerHost & Pick<LitElement, "renderRoot">;

export class ComposerController {
  /** The composer's live text, deliberately not rendered from: a keystroke only
   * changes what its own textarea already shows, so typing must not re-render
   * the transcript behind it. Code-owned changes go through `setDraft`. */
  draft = "";
  /** Bumped by `setDraft` so the shell measures a textarea whose value code
   * replaced, never one the operator is typing into. */
  draftRevision = 0;
  /** Picked but not yet sent; cleared on send and on switching session. */
  attachments: readonly Attachment[] = [];
  draftSessionIds: ReadonlySet<string> = new Set();
  draftKey = NEW_SESSION_DRAFT_KEY;
  draftLoad = 0;
  draftEdit = 0;
  draftHydrated = false;
  /** Opens the command menu once the launched session is idle. */
  pendingCommandBrowse = false;
  commands: readonly RuntimeCommand[] = [];
  commandsLoading = false;
  commandsError = "";
  slashQuery: CommandQuery | null = null;
  slashActiveIndex = 0;
  localPathQuery: LocalPathQuery | null = null;
  localPaths: readonly LocalPathSuggestion[] = [];
  localPathsLoading = false;
  localPathsError = "";
  localPathActiveIndex = 0;
  queue: QueueSnapshot = EMPTY_QUEUE;
  queueEditingId = "";
  queueEditingText = "";
  readonly #host: ComposerHost;
  readonly #deps: ComposerDeps;
  #draftIndicatorRevision = 0;
  #commandsLoaded = false;
  #commandsRequest = 0;
  #localPathsRequest = 0;
  #localPathCwd = "";

  constructor(host: ComposerHost, deps: ComposerDeps) {
    this.#host = host;
    this.#deps = deps;
  }

  persistDraft(
    key = this.draftKey,
    text = this.draft,
    attachments: readonly Attachment[] = this.attachments,
  ) {
    if (!mayUseComposerDraftKey(this.#deps.embeddedPane(), key)) return;
    const sessionId = sessionIdFromDraftKey(key);
    if (sessionId) {
      const hasDraft = Boolean(text || attachments.length);
      this.markSessionDraft(sessionId, hasDraft);
      this.#deps.draftChanged(sessionId, hasDraft);
    }
    return writeComposerDraft(key, { text, attachments });
  }

  markSessionDraft(sessionId: string, hasDraft: boolean): void {
    if (this.draftSessionIds.has(sessionId) === hasDraft) return;
    const next = new Set(this.draftSessionIds);
    hasDraft ? next.add(sessionId) : next.delete(sessionId);
    this.#draftIndicatorRevision += 1;
    this.draftSessionIds = next;
    this.#host.requestUpdate();
  }

  refreshDraftIndicators(): void {
    const revision = this.#draftIndicatorRevision;
    void listComposerDraftSessionIds().then((sessionIds) => {
      if (revision !== this.#draftIndicatorRevision) return;
      this.draftSessionIds = new Set(sessionIds);
      this.#host.requestUpdate();
    });
  }

  switchDraft(key: string): void {
    if (!mayUseComposerDraftKey(this.#deps.embeddedPane(), key)) return;
    if (key === this.draftKey && this.draftHydrated) return;
    if (key !== this.draftKey) void this.persistDraft();
    this.draftKey = key;
    this.draftHydrated = true;
    const load = ++this.draftLoad;
    const edit = ++this.draftEdit;
    this.setDraft("");
    this.attachments = [];
    void readComposerDraft(key).then((draft) => {
      if (load !== this.draftLoad || edit !== this.draftEdit || key !== this.draftKey) return;
      this.setDraft(draft.text);
      this.attachments = draft.attachments;
    });
  }

  /** A keystroke. The textarea already shows this text, so the value itself
   * needs no update; only what the draft makes the composer show (Send/Stop
   * instead of nothing to send) does, and that flips at most twice per message. */
  #typeDraft = (draft: string) => {
    const hadText = this.draft.trim() !== "";
    this.draftEdit += 1;
    this.draft = draft;
    if ((draft.trim() !== "") !== hadText) this.#host.requestUpdate();
    void this.persistDraft();
  };

  /** A draft HUI set, not one typed into the textarea: it has to reach the
   * value, the controls derived from it and the textarea's measured height. */
  setDraft(draft: string): void {
    this.draft = draft;
    this.draftRevision += 1;
    this.#host.requestUpdate();
  }

  updateDraft = (draft: string) => {
    this.draftEdit += 1;
    this.setDraft(draft);
    void this.persistDraft();
  };

  resetCommands(): void {
    this.#commandsRequest += 1;
    this.commands = [];
    this.#commandsLoaded = false;
    this.commandsLoading = false;
    this.commandsError = "";
    this.slashQuery = null;
    this.slashActiveIndex = 0;
    this.#host.requestUpdate();
  }

  closeCommands(): void {
    this.slashQuery = null;
    this.#host.requestUpdate();
  }

  resetLocalPaths(): void {
    this.#localPathsRequest += 1;
    // Typing text that opens no `@` mention repeats this reset on every
    // keystroke, and reassigning the values it already holds would schedule a
    // second full app render alongside the draft's own update.
    if (this.localPathQuery === null && this.localPaths.length === 0 && !this.localPathsLoading
      && this.localPathsError === "" && this.localPathActiveIndex === 0 && this.#localPathCwd === "") {
      return;
    }
    this.localPathQuery = null;
    this.localPaths = [];
    this.localPathsLoading = false;
    this.localPathsError = "";
    this.localPathActiveIndex = 0;
    this.#localPathCwd = "";
    this.#host.requestUpdate();
  }

  /** The launched session is idle: its command draft opens the menu at its end. */
  browseCommands(textarea: HTMLTextAreaElement): void {
    this.pendingCommandBrowse = false;
    textarea.focus();
    textarea.setSelectionRange(this.draft.length, this.draft.length);
    this.#setCommandQuery(slashCommandQuery(this.draft, this.draft.length));
  }

  #requestCommands = () => {
    const session = this.#deps.composerSession();
    if (!session || session.status === "starting" || session.status === "error" || this.commandsLoading) return;
    const request = ++this.#commandsRequest;
    const current = () => this.#deps.conversation.selected?.id === session.id && request === this.#commandsRequest;
    const returnFocus = document.activeElement?.closest(".slash-menu") !== null;
    this.commandsLoading = true;
    this.commandsError = "";
    this.#host.requestUpdate();
    void loadCommands(session.id).then((commands) => {
      if (!current()) return;
      this.commands = commands;
      this.#commandsLoaded = true;
      this.slashActiveIndex = 0;
      if (returnFocus) void this.#host.updateComplete.then(() => {
        if (current() && this.slashQuery !== null) this.#deps.textarea()?.focus();
      });
    }).catch((error: unknown) => {
      if (current()) this.commandsError = error instanceof Error ? error.message : "Could not load commands.";
    }).finally(() => {
      if (!current()) return;
      this.commandsLoading = false;
      this.#host.requestUpdate();
    });
  };

  #runtimeCommands(): readonly RuntimeCommand[] {
    if (this.#deps.composerSession()) return this.commands;
    return this.#deps.draftCommands();
  }

  #menuCommands(): ComposerCommand[] {
    const query = this.slashQuery ?? { text: "", start: 0 };
    const runtime = this.#runtimeCommands();
    if (query.start > 0) return filterSlashCommands(runtime.filter((command) => command.source === "skill"), query.text.slice(1));
    const session = this.#deps.composerSession();
    return filterSlashCommands(query.text.startsWith("$") ? runtime : composerCommands(runtime, !!session, Boolean(session?.bot)), query.text);
  }

  #setCommandQuery = (query: CommandQuery | null) => {
    // Scheduling an update on every keystroke re-renders the whole app: only a
    // changed query may schedule one.
    if (query?.text !== this.slashQuery?.text || query?.start !== this.slashQuery?.start) {
      this.slashActiveIndex = 0;
      this.slashQuery = query;
      this.#host.requestUpdate();
    }
    if (query !== null && !this.#commandsLoaded && !this.commandsError) this.#requestCommands();
  };

  #selectSlashCommand = (command: ComposerCommand) => {
    const completed = completeCommandReference(this.draft, command, this.#runtimeCommands(), this.slashQuery?.start ?? 0);
    this.updateDraft(completed.text);
    this.resetLocalPaths();
    this.slashQuery = null;
    void this.#host.updateComplete.then(() => {
      const textarea = this.#deps.textarea();
      if (!textarea) return;
      textarea.value = completed.text;
      textarea.focus();
      textarea.setSelectionRange(completed.caret, completed.caret);
    });
  };

  #commandKeydown = (event: KeyboardEvent) => {
    if (this.slashQuery === null || event.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
    const commands = this.#menuCommands();
    const paths = this.localPathQuery ? this.localPaths : [];
    const count = commands.length + paths.length;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeCommands();
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
      this.#host.requestUpdate();
      void this.#host.updateComplete.then(() => this.#host.renderRoot.querySelector('.slash-menu [aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" || event.key === "Tab") {
      const command = commands[this.slashActiveIndex];
      if (command) {
        event.preventDefault();
        this.#selectSlashCommand(command);
      } else {
        const path = paths[this.slashActiveIndex - commands.length];
        if (path) { event.preventDefault(); this.#selectLocalPath(path); }
      }
    }
  };

  #setLocalPathQuery = (query: LocalPathQuery | null, cwd?: string) => {
    if (!query) {
      this.resetLocalPaths();
      return;
    }
    const workspace = this.#deps.composerSession()?.cwd || cwd?.trim() || this.#deps.defaultCwd() || "~/";
    const sameQuery = this.localPathQuery?.input === query.input
      && this.localPathQuery.start === query.start
      && this.localPathQuery.end === query.end
      && this.localPathQuery.mention === query.mention
      && this.#localPathCwd === workspace;
    this.localPathQuery = query;
    this.#localPathCwd = workspace;
    this.#host.requestUpdate();
    if (sameQuery && (this.localPathsLoading || this.localPaths.length > 0 || this.localPathsError)) return;
    this.localPathActiveIndex = 0;
    this.slashActiveIndex = 0;
    // A mention tags a bot as well as naming a file: the bots it matches come first, at once. A session still on PI's SDK
    // worker has no message_bot.
    const selected = this.#deps.conversation.selected;
    const bots = query.mention && selected?.tool !== "pi" ? botMentionSuggestions(this.#deps.mentionable(), query.input, selected?.bot?.id) : [];
    this.localPaths = bots;
    const request = ++this.#localPathsRequest;
    this.localPathsLoading = true;
    this.localPathsError = "";
    void loadLocalPathSuggestions(workspace, query.input).then((paths) => {
      if (request !== this.#localPathsRequest) return;
      this.localPaths = [...bots, ...paths];
    }).catch((error: unknown) => {
      if (request !== this.#localPathsRequest) return;
      this.localPaths = bots;
      this.localPathsError = error instanceof Error ? error.message : "Could not load local paths.";
    }).finally(() => {
      if (request !== this.#localPathsRequest) return;
      this.localPathsLoading = false;
      this.#host.requestUpdate();
    });
  };

  #retryLocalPaths = () => {
    const query = this.localPathQuery;
    const cwd = this.#localPathCwd;
    this.resetLocalPaths();
    if (query) this.#setLocalPathQuery(query, cwd);
  };

  #selectLocalPath = (suggestion: LocalPathSuggestion) => {
    const query = this.localPathQuery;
    if (!query) return;
    this.slashQuery = null;
    const completed = completeLocalPath(this.draft, query, suggestion);
    this.updateDraft(completed.text);
    if (suggestion.kind === "directory") {
      this.#setLocalPathQuery({
        input: suggestion.path,
        start: query.start,
        end: completed.caret,
        mention: query.mention,
      }, this.#localPathCwd);
    } else {
      this.resetLocalPaths();
    }
    void this.#host.updateComplete.then(() => {
      const textarea = this.#deps.textarea();
      if (!textarea) return;
      textarea.value = completed.text;
      textarea.focus();
      textarea.setSelectionRange(completed.caret, completed.caret);
      if (suggestion.kind !== "directory") {
        requestAnimationFrame(() => this.resetLocalPaths());
      }
    });
  };

  #localPathKeydown = (event: KeyboardEvent) => {
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
      this.#host.requestUpdate();
      void this.#host.updateComplete.then(() => this.#host.renderRoot.querySelector('.mention-menu [aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Enter" || event.key === "Tab") {
      const suggestion = this.localPaths[this.localPathActiveIndex];
      if (suggestion) {
        event.preventDefault();
        this.#selectLocalPath(suggestion);
      }
    }
  };

  #addAttachments = (files: readonly File[]) => {
    const key = this.draftKey;
    if (this.#deps.sending() || this.#deps.launching()) {
      return;
    }
    void Promise.all(files.map((file) => readAttachment(file)))
      .then(async (added) => {
        if (key !== this.draftKey) {
          const stored = await readComposerDraft(key);
          const attachments = [...stored.attachments, ...added];
          validateAttachmentTotal(attachments);
          await this.persistDraft(key, stored.text, attachments);
          return;
        }
        const next = [...this.attachments, ...added];
        validateAttachmentTotal(next);
        this.draftEdit += 1;
        this.attachments = next;
        this.#host.requestUpdate();
        await this.persistDraft();
      })
      .catch((error: unknown) => {
        if (key !== this.draftKey) {
          return;
        }
        this.#deps.showNote(error instanceof Error ? error.message : "Could not read that file.", "error");
      });
  };

  #removeAttachment = (index: number) => {
    if (this.#deps.sending()) return;
    this.draftEdit += 1;
    this.attachments = this.attachments.filter((_, at) => at !== index);
    this.#host.requestUpdate();
    void this.persistDraft();
  };

  adoptQueue(queue: QueueSnapshot): void {
    this.queue = queue;
    this.#host.requestUpdate();
  }

  adoptSnapshot({ queue }: SessionSnapshot): void {
    this.adoptQueue(queue);
    if (this.queueEditingId && !queue.items?.some((item) => item.id === this.queueEditingId)) this.#setQueueEdit("", "");
  }

  #setQueueEdit(id: string, text: string): void {
    this.queueEditingId = id;
    this.queueEditingText = text;
    this.#host.requestUpdate();
  }

  #queueMutation(mutation: Parameters<typeof mutateQueuedMessage>[1], onSuccess?: () => void): void {
    const session = this.#deps.conversation.selected;
    if (!session) return;
    void mutateQueuedMessage(session.id, mutation)
      .then(() => {
        if (isSelectedSession(session.id, this.#deps.conversation.selected?.id)) onSuccess?.();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.#deps.conversation.selected?.id)) return;
        this.#deps.showNote(error instanceof Error ? error.message : "Could not update the queue.", "error");
      });
  }

  props(): Pick<HomeProps, "draft" | "attachments" | "onDraftChange" | "onDraftInput" | "commandMenu" | "onCommandQuery" | "onCommandKeydown" | "localPathMenu" | "onLocalPathQuery" | "onLocalPathKeydown" | "onAddAttachments" | "onRemoveAttachment" | "queue" | "queueEditingId" | "queueEditingText" | "onQueueEdit" | "onQueueEditChange" | "onQueueEditSubmit" | "onQueueEditCancel" | "onQueueRemove" | "onQueueMove" | "onQueueSteer"> {
    const { conversation } = this.#deps;
    const sending = this.#deps.sending();
    return {
      draft: this.draft,
      attachments: this.attachments,
      onDraftChange: this.updateDraft,
      onDraftInput: this.#typeDraft,
      commandMenu: {
        open: this.slashQuery !== null && !sending && !conversation.opening && !this.#deps.launching() && (!this.#deps.composerSession() || conversation.connection === "live"),
        commands: this.#menuCommands(),
        catalog: this.#runtimeCommands(),
        paths: this.localPathQuery ? this.localPaths : undefined,
        pathsLoading: this.localPathsLoading,
        pathsError: this.localPathsError,
        onSelectPath: this.#selectLocalPath,
        onRetryPaths: this.#retryLocalPaths,
        activeIndex: this.slashActiveIndex,
        loading: this.commandsLoading,
        error: this.commandsError,
        streaming: conversation.streaming,
        onSelect: this.#selectSlashCommand,
        onRetry: this.#requestCommands,
      },
      onCommandQuery: this.#setCommandQuery,
      onCommandKeydown: this.#commandKeydown,
      localPathMenu: {
        open: this.localPathQuery !== null && this.slashQuery === null && !sending && !conversation.opening && conversation.connection === "live",
        paths: this.localPaths,
        activeIndex: this.localPathActiveIndex,
        loading: this.localPathsLoading,
        error: this.localPathsError,
        onSelect: this.#selectLocalPath,
        onRetry: this.#retryLocalPaths,
      },
      onLocalPathQuery: this.#setLocalPathQuery,
      onLocalPathKeydown: this.#localPathKeydown,
      onAddAttachments: this.#addAttachments,
      onRemoveAttachment: this.#removeAttachment,
      queue: this.queue,
      queueEditingId: this.queueEditingId,
      queueEditingText: this.queueEditingText,
      onQueueEdit: (id) => {
        const item = this.queue.items?.find((candidate) => candidate.id === id);
        if (!item) return;
        this.#setQueueEdit(id, item.text);
      },
      onQueueEditChange: (text) => this.#setQueueEdit(this.queueEditingId, text),
      onQueueEditSubmit: () => {
        const itemId = this.queueEditingId;
        const text = this.queueEditingText.trim();
        if (!itemId || !text) return;
        this.#queueMutation({ operation: "edit", itemId, text }, () => this.#setQueueEdit("", ""));
      },
      onQueueEditCancel: () => this.#setQueueEdit("", ""),
      onQueueRemove: (itemId) => this.#queueMutation({ operation: "remove", itemId }),
      onQueueMove: (itemId, toIndex) => this.#queueMutation({ operation: "move", itemId, toIndex }),
      onQueueSteer: (itemId) => this.#queueMutation({ operation: "steer", itemId }),
    };
  }
}
