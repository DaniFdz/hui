/**
 * `ConversationController` owns the open conversation outside `hui-app.ts`: the session on screen, its transcript,
 * subagents, opening and connection state, with the request that opens it and the event stream that keeps it current;
 * the models it can switch to and the one it runs on, its context usage, thinking level and fast mode, with the
 * requests that change them and the once-per-selection model list request; the pending question with the focus it
 * returns to; the live compaction; and the copied-message mark. The shell reads its props and receives the stream's
 * frames that belong to the composer, the backlog and the sidebar; and the request that reads the session again when
 * a view shows something the stream left behind.
 */
import type { LitElement, ReactiveController, ReactiveControllerHost } from "lit";
import { loadModels, openSession, setSessionFast, setSessionModel, setSessionThinking, subscribeSession, type RuntimeCompaction, type RuntimeEvent, type RuntimeModel, type RuntimeQuestion, type RuntimeUsage, type SessionConnection, type SessionStatus, type SessionStreamSnapshot, type SessionView, type SubagentTaskView, type TranscriptItem } from "../api/sessions.ts";
import { isGatewayUnavailable } from "../api/request.ts";
import { OutdatedBuildError } from "../api/offline.ts";
import { forgetConversation, readSavedConversation, saveConversation, type SavedConversation } from "../lib/session/offline-store.ts";
import { writeClipboardText } from "../lib/clipboard.ts";
import { announceTurnEnd } from "../lib/session/turn-end.ts";
import { emptySessionPresentation, isCurrentSessionRequest, isSelectedSession, modelRequestMarkerAfterFailure, shouldRequestModels, streamingAfterEvent, streamingForStatus } from "../lib/session/ui-state.ts";
import { FINISHED_BATCH_VISIBLE_MS, isSubagentActive } from "../lib/subagent-activity.ts";
import { keepSentPreviews, normalizeTranscript, reduceTranscript } from "../lib/transcript-state.ts";
import type { HomeProps } from "../views/home.ts";

type ConversationDeps = {
  showError: (message: string) => void;
  refreshSessions: () => Promise<void>;
  paneCreating: () => boolean;
  paneCreationFailed: () => boolean;
  resetSession: () => void;
  connectionLost: () => void;
  adoptSnapshot: (snapshot: SessionStreamSnapshot) => void;
  adoptEvent: (event: RuntimeEvent) => void;
  statusChanged: (id: string, status: SessionStatus, interrupted: SessionView["interrupted"]) => void;
  flushLaunchPrompt: () => void;
};

type ConversationHost = ReactiveControllerHost & Pick<LitElement, "renderRoot">;

export class ConversationController implements ReactiveController {
  selected: SessionView | undefined;
  transcript: readonly TranscriptItem[] = [];
  subagents: readonly SubagentTaskView[] = [];
  opening = false;
  /** A re-read of the open session is in flight. */
  refreshing = false;
  /** Why the selected session's open request failed; its view offers a retry. */
  openError = "";
  streaming = false;
  /** `sessionId\0errorKey` of run errors the operator dismissed this page load. */
  dismissedRunErrors: ReadonlySet<string> = new Set();
  stopping = false;
  connection: SessionConnection = "live";
  /** Empty while the stream is live; otherwise a muted line saying why. */
  connectionNote = "";
  savedCopy: Pick<SavedConversation, "savedAt" | "truncated"> | undefined;
  copiedId = "";
  /** Models the open session can switch to, and the one it is running on. */
  models: readonly RuntimeModel[] = [];
  currentModel: RuntimeModel | undefined;
  usage: RuntimeUsage | undefined;
  thinking = "medium";
  /** Fast mode; undefined while the runtime cannot change speed. */
  fast: boolean | undefined;
  question: RuntimeQuestion | undefined;
  compaction: RuntimeCompaction | undefined;
  readonly #host: ConversationHost;
  readonly #deps: ConversationDeps;
  /** Session whose model list has already been requested for this selection. */
  #modelsRequestedFor = "";
  #questionReturnFocus: HTMLElement | undefined;
  /** Ends the current event stream; replaced on every session switch. */
  #streamStop: (() => void) | undefined;
  /** Monotonic ownership token for open responses from the selected session. */
  #openRequestToken = 0;
  #subagentExpiryTimer: number | undefined;
  #frameUpdate: number | undefined;
  #copyTimer: number | undefined;
  #disconnected = false;

  constructor(host: ConversationHost, deps: ConversationDeps) {
    this.#host = host;
    this.#deps = deps;
    host.addController(this);
  }

  hostConnected(): void {
    this.#disconnected = false;
  }

  hostDisconnected(): void {
    this.#disconnected = true;
    this.#openRequestToken += 1;
    this.#streamStop?.();
    this.#streamStop = undefined;
    this.#clearSubagentExpiry();
    window.clearTimeout(this.#copyTimer);
    this.#copyTimer = undefined;
    this.opening = false;
    this.copiedId = "";
  }

  get streamOpen(): boolean {
    return this.#streamStop !== undefined;
  }

  /** Background rows use the lightweight status stream. A detailed stream is
   * also the server's read receipt, so it must exist only while chat is shown. */
  suspend(): void {
    this.#openRequestToken += 1;
    this.#streamStop?.();
    this.#streamStop = undefined;
    this.opening = false;
    this.#host.requestUpdate();
  }

  clear(): void {
    // Invalidates an open response even if it resolves after the selection is
    // cleared and before another session is chosen.
    this.#openRequestToken += 1;
    this.#streamStop?.();
    this.#streamStop = undefined;
    this.selected = undefined;
    const empty = emptySessionPresentation();
    this.transcript = empty.transcript;
    this.subagents = [];
    this.#clearSubagentExpiry();
    this.opening = empty.opening;
    this.openError = "";
    this.streaming = empty.streaming;
    this.connectionNote = empty.connectionNote;
    this.savedCopy = undefined;
    this.resetModels();
    this.compaction = undefined;
    this.stopping = false;
    this.dropQuestion();
    this.connection = "live";
  }

  /** Opens (starting a runtime if needed) and begins streaming. */
  async open(id: string): Promise<void> {
    const requestToken = ++this.#openRequestToken;
    this.#streamStop?.();
    this.#streamStop = undefined;
    this.opening = true;
    this.openError = "";
    this.streaming = false;
    this.transcript = [];
    this.subagents = [];
    this.connectionNote = "";
    this.savedCopy = undefined;
    this.connection = "reconnecting";
    this.resetModels();
    this.compaction = undefined;
    this.#deps.resetSession();
    this.#host.requestUpdate();
    // Nothing to open until the gateway has created the worktree session.
    if (this.#deps.paneCreating() || this.#deps.paneCreationFailed()) {
      if (this.#deps.paneCreationFailed() && this.selected) this.selected = { ...this.selected, status: "error" };
      this.opening = false;
      return;
    }
    const pending = openSession(id);
    let settled = false;
    const saved = readSavedConversation(id);
    void saved.then((copy) => {
      if (!settled && copy && isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) this.#showSaved(copy);
    });
    try {
      const opened = await pending;
      settled = true;
      if (!isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) return;
      this.savedCopy = undefined;
      this.selected = opened.session;
      this.applySnapshot(opened.snapshot, true);
      this.thinking = opened.snapshot.thinking ?? opened.session.thinking ?? "medium";
      this.streaming = streamingForStatus(opened.session.status);
      this.connection = "live";
      this.#startStream(id, opened.revision);
      this.requestModelsWhenReady(id, opened.session.status);
    } catch (error) {
      settled = true;
      const copy = await readSavedConversation(id);
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        if (error instanceof OutdatedBuildError) {
          if (copy) this.#showSaved(copy);
          this.connection = "outdated";
          this.connectionNote = error.message;
        } else if (copy && isGatewayUnavailable(error)) {
          this.#showSaved(copy);
          this.#startStream(id);
        } else {
          this.savedCopy = undefined;
          this.transcript = [];
          this.connection = "stopped";
          this.openError = error instanceof Error ? error.message : "Could not open that session.";
        }
      }
    } finally {
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        this.opening = false;
        this.#host.requestUpdate();
        this.#deps.flushLaunchPrompt();
      }
    }
  }

  #showSaved(copy: SavedConversation): void {
    this.selected = copy.session;
    this.transcript = normalizeTranscript(copy.transcript);
    this.savedCopy = { savedAt: copy.savedAt, truncated: copy.truncated };
    this.connection = "saved";
    this.connectionNote = "Reconnecting; your draft stays on this device.";
    this.opening = false;
    this.streaming = false;
    this.question = undefined;
    this.#host.requestUpdate();
  }

  forgetSaved = async (): Promise<void> => {
    await forgetConversation();
    if (this.savedCopy) this.transcript = [];
    this.savedCopy = undefined;
    this.connectionNote = "Saved conversations removed from this device. Your draft is unchanged.";
    this.#host.requestUpdate();
    await this.#deps.refreshSessions();
  };

  /** Reads the open session again, so a card whose update never reached this page shows the gateway's copy. */
  async refresh(): Promise<void> {
    const id = this.selected?.id;
    if (!id || this.refreshing || this.connection !== "live") return;
    const requestToken = this.#openRequestToken;
    this.refreshing = true;
    this.#host.requestUpdate();
    try {
      const opened = await openSession(id);
      if (!isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) return;
      this.selected = opened.session;
      this.applySnapshot(opened.snapshot);
    } catch (error) {
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        this.#deps.showError(error instanceof Error ? error.message : "Could not refresh that session.");
      }
    } finally {
      this.refreshing = false;
      this.#host.requestUpdate();
    }
  }

  #startStream(id: string, heldRevision?: number): void {
    // An older attempt may have installed a stream while a newer open request
    // was pending. Replacing it is an ownership transfer, so close it first.
    this.#streamStop?.();
    const requestToken = this.#openRequestToken;
    const current = () => isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken);
    this.#streamStop = subscribeSession(id, {
      onSnapshot: (snapshot) => {
        if (current()) this.applySnapshot(snapshot);
      },
      onTranscript: (entries) => {
        if (current()) {
          this.transcript = normalizeTranscript(entries);
          if (this.selected) void saveConversation(this.selected, entries);
          this.#host.requestUpdate();
        }
      },
      onEvent: (event) => {
        if (current()) {
          this.#applyEvent(event);
        }
      },
      onStatus: (status) => {
        if (current()) {
          this.#setStatus(status);
        }
      },
      onModel: (model) => {
        if (current()) {
          this.currentModel = model;
          this.#host.requestUpdate();
        }
      },
      onThinking: (level) => {
        if (current()) {
          this.thinking = level;
          this.#host.requestUpdate();
        }
      },
      onFast: (fast) => {
        if (current()) {
          this.fast = fast;
          this.#host.requestUpdate();
        }
      },
      onConnection: (state, detail) => {
        if (!current()) {
          return;
        }
        this.connection = state === "reconnecting" && this.savedCopy ? "saved" : state;
        if (state !== "live") {
          this.#deps.connectionLost();
          this.dropQuestion();
        }
        if (state === "live") this.savedCopy = undefined;
        this.connectionNote = state === "live" ? "" : detail || (this.savedCopy ? "Reconnecting; your draft stays on this device." : "Reconnecting…");
        if (state === "stopped" || state === "outdated") {
          this.streaming = false;
          if (state === "stopped" && this.savedCopy) {
            this.savedCopy = undefined;
            this.transcript = [];
          }
        }
        this.#host.requestUpdate();
      },
    }, heldRevision);
  }

  applySnapshot(snapshot: SessionStreamSnapshot, initial = false): void {
    if (snapshot.transcript) {
      if (this.selected) void saveConversation(this.selected, snapshot.transcript);
      this.transcript = keepSentPreviews(normalizeTranscript(snapshot.transcript, {
        streaming: streamingForStatus(snapshot.status),
      }), this.transcript);
    }
    const previousTasks = this.subagents.map((task) => `${task.sessionId}:${task.status}:${task.updatedAt}`).join("|");
    this.subagents = snapshot.subagents ?? [];
    this.#scheduleSubagentExpiry();
    const nextTasks = this.subagents.map((task) => `${task.sessionId}:${task.status}:${task.updatedAt}`).join("|");
    this.#deps.adoptSnapshot(snapshot);
    if (!initial && previousTasks !== nextTasks) void this.#deps.refreshSessions();
    this.adoptSnapshot(snapshot);
    this.#setStatus(snapshot.status);
  }

  #requestFrameUpdate(): void {
    if (this.#frameUpdate !== undefined) return;
    const update = () => { this.#frameUpdate = undefined; this.#host.requestUpdate(); };
    this.#frameUpdate = requestAnimationFrame(update);
  }

  #clearSubagentExpiry(): void {
    if (this.#subagentExpiryTimer !== undefined) window.clearTimeout(this.#subagentExpiryTimer);
    this.#subagentExpiryTimer = undefined;
  }

  /** OpenClaw keeps a finished batch of subagents visible for a while. Schedule
   * the render that removes it even if the session stays idle. */
  #scheduleSubagentExpiry(): void {
    this.#clearSubagentExpiry();
    const now = Date.now();
    const nextExpiry = this.subagents
      .filter((task) => !isSubagentActive(task.status))
      .map((task) => Date.parse(task.endedAt ?? task.updatedAt) + FINISHED_BATCH_VISIBLE_MS)
      .filter((expiry) => Number.isFinite(expiry) && expiry > now)
      .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;
    this.#subagentExpiryTimer = window.setTimeout(() => {
      this.#subagentExpiryTimer = undefined;
      this.#host.requestUpdate();
      this.#scheduleSubagentExpiry();
    }, nextExpiry - now + 16);
  }

  #applyEvent(event: RuntimeEvent): void {
    this.#deps.adoptEvent(event);
    if (event.type === "question") {
      // Another one waits for the snapshot after the open one is answered.
      if (!this.question) this.showQuestion(event.question);
      return;
    }
    if (event.type === "thinking_level") {
      this.thinking = event.level;
      this.#host.requestUpdate();
      return;
    }
    // Views of what the agent may have changed (the Files view) refresh once its turn is over.
    if (event.type === "settled" && this.selected) announceTurnEnd(this.selected.id);
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
    if (event.type === "text" || event.type === "thinking" || event.type === "tool_update") this.#requestFrameUpdate();
    else this.#host.requestUpdate();
  }

  #setStatus(status: SessionStatus): void {
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
    this.#host.requestUpdate();
    this.requestModelsWhenReady(id, status);
    this.#deps.statusChanged(id, status, interrupted);
  }

  copy = (text: string, id: string): Promise<boolean> => {
    return writeClipboardText(text).then((copied) => {
      if (!copied) throw new Error("Clipboard write failed");
      if (this.#disconnected) return true;
      this.copiedId = id;
      this.#host.requestUpdate();
      if (this.#copyTimer !== undefined) window.clearTimeout(this.#copyTimer);
      this.#copyTimer = window.setTimeout(() => {
        this.copiedId = "";
        this.#host.requestUpdate();
      }, 1_500);
      return true;
    }).catch(() => {
      this.#deps.showError("Could not copy to the clipboard.");
      return false;
    });
  };

  select(session: SessionView | undefined): void {
    this.selected = session;
    this.#host.requestUpdate();
  }

  resetModels(): void {
    this.models = [];
    this.currentModel = undefined;
    this.usage = undefined;
    this.#modelsRequestedFor = "";
  }

  adoptSnapshot(snapshot: SessionStreamSnapshot): void {
    // The open question stays while it is pending, whatever else arrives meanwhile.
    const question = snapshot.questions.find(({ id }) => id === this.question?.id) ?? snapshot.questions[0];
    if (question) this.showQuestion(question);
    else if (this.question) {
      this.question = undefined;
      this.restoreQuestionFocus();
    }
    if (snapshot.model) this.currentModel = snapshot.model;
    this.usage = snapshot.usage;
    this.compaction = snapshot.compaction;
    if (snapshot.thinking) this.thinking = snapshot.thinking;
    this.fast = snapshot.fast;
    this.#host.requestUpdate();
  }

  showQuestion(question: RuntimeQuestion): void {
    // Every snapshot re-sends the open question: keep it, and the operator's focus in it.
    if (this.question?.id === question.id) return;
    if (!this.question) {
      const composer = this.#host.renderRoot.querySelector?.(".agent-chat__composer-combobox textarea");
      this.#questionReturnFocus = composer instanceof HTMLElement
        ? composer
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
    }
    this.question = question;
    this.#host.requestUpdate();
  }

  restoreQuestionFocus(): void {
    const target = this.#questionReturnFocus;
    this.#questionReturnFocus = undefined;
    void this.#host.updateComplete.then(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      const composer = this.#host.renderRoot.querySelector?.(".agent-chat__composer-combobox textarea");
      if (composer instanceof HTMLTextAreaElement) composer.focus();
    });
  }

  dropQuestion(): void {
    this.question = undefined;
    this.#questionReturnFocus = undefined;
    this.#host.requestUpdate();
  }

  /**
   * Models are listed only for the session on screen, and only once it has a
   * runtime: asking a tool that has not booted returns nothing useful.
   */
  requestModelsWhenReady(id: string, status: SessionStatus): void {
    if (!shouldRequestModels(id, status, this.#modelsRequestedFor)) {
      return;
    }
    // Claim this session before the request starts. Repeated idle frames are
    // common during reconnects and must not fan out duplicate requests.
    this.#modelsRequestedFor = id;
    void loadModels(id)
      .then((models) => {
        if (this.selected?.id === id) {
          this.models = models;
          this.#host.requestUpdate();
        }
      })
      .catch(() => {
        // A transient failure can retry on a later ready status/reconnect, but
        // a late failure from a deselected session cannot touch the new gate.
        this.#modelsRequestedFor = modelRequestMarkerAfterFailure(
          this.#modelsRequestedFor,
          id,
          this.selected?.id,
        );
      });
  }

  #selectModel = (provider: string, modelId: string) => {
    const session = this.selected;
    if (!session || this.connection !== "live") return;
    void setSessionModel(session.id, provider, modelId)
      .then((model) => {
        if (!isSelectedSession(session.id, this.selected?.id)) {
          return;
        }
        if (model) {
          this.currentModel = model;
          this.#host.requestUpdate();
        }
        // The record now carries the choice, so the sidebar reflects it too.
        return this.#deps.refreshSessions();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) {
          return;
        }
        this.#deps.showError(error instanceof Error ? error.message : "Could not switch model.");
      });
  };

  #selectThinking = (level: string) => {
    const session = this.selected;
    if (!session || this.streaming || this.connection !== "live") return;
    void setSessionThinking(session.id, level)
      .then((authoritative) => {
        if (isSelectedSession(session.id, this.selected?.id)) {
          this.thinking = authoritative;
          this.#host.requestUpdate();
        }
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        // The backend broadcasts either the compensated level or the live
        // divergent level. Never overwrite that authoritative SSE state with
        // this request's stale optimistic value.
        this.#deps.showError(error instanceof Error ? error.message : "Could not switch thinking level.");
      });
  };

  #selectFast = (fast: boolean) => {
    const session = this.selected;
    if (!session || this.streaming || this.connection !== "live") return;
    void setSessionFast(session.id, fast)
      .then((authoritative) => {
        if (isSelectedSession(session.id, this.selected?.id)) {
          this.fast = authoritative;
          this.#host.requestUpdate();
        }
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.selected?.id)) return;
        // The gateway broadcasts the speed the session kept.
        this.#deps.showError(error instanceof Error ? error.message : "Could not change the speed.");
      });
  };

  props(): Pick<HomeProps, "thinking" | "fast" | "models" | "currentModel" | "usage" | "refreshing" | "onSelectModel" | "onSelectThinking" | "onSelectFast" | "onRefreshSession"> {
    return {
      thinking: this.thinking,
      ...(this.fast === undefined ? {} : { fast: this.fast }),
      models: this.models,
      currentModel: this.currentModel,
      usage: this.usage,
      refreshing: this.refreshing,
      onSelectModel: this.#selectModel,
      onSelectThinking: this.#selectThinking,
      onSelectFast: this.#selectFast,
      onRefreshSession: () => void this.refresh(),
    };
  }
}
