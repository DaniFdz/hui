/**
 * `ConversationController` owns the open conversation outside `hui-app.ts`: the session on screen, its transcript,
 * subagents, opening and connection state, with the request that opens it and the event stream that keeps it current;
 * the models it can switch to and the one it runs on, its context usage, thinking level and fast mode, with the
 * requests that change them and the once-per-selection model list request; the pending question with the focus it
 * returns to; the live compaction; and the copied-message mark. The shell reads its props and receives the stream's
 * frames that belong to the composer, the backlog and the sidebar; and the refresh that reads the session again and
 * asks the agent to bring the task progress card up to date.
 */
import type { LitElement, ReactiveController, ReactiveControllerHost } from "lit";
import { followUpSession, loadModels, openSession, sendPrompt, setSessionFast, setSessionModel, setSessionThinking, subscribeSession, type RuntimeCompaction, type RuntimeEvent, type RuntimeModel, type RuntimeQuestion, type RuntimeUsage, type SessionConnection, type SessionStatus, type SessionStreamSnapshot, type SessionView, type SubagentTaskView, type TranscriptItem } from "../api/sessions.ts";
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

/** The card is the agent's own writing, so only the agent can bring it up to date; HUI asks in a normal user turn. */
const REFRESH_PROGRESS_PROMPT = "Refresh the task progress card to match where this work stands now. Update only the card, then stop.";

export class ConversationController implements ReactiveController {
  selected: SessionView | undefined;
  transcript: readonly TranscriptItem[] = [];
  subagents: readonly SubagentTaskView[] = [];
  opening = false;
  /** A refresh is in flight: from the click until the agent's turn for it ends. */
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
  /** The refresh's prompt was accepted, so the agent's next settle ends the busy state. */
  #refreshAccepted = false;

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
    this.#endRefresh();
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
    this.#endRefresh();
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
    this.#endRefresh();
    this.openError = "";
    this.streaming = false;
    this.transcript = [];
    this.subagents = [];
    this.connectionNote = "";
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
    try {
      const opened = await openSession(id);
      if (!isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        // A different session or a newer retry won while this was starting.
        return;
      }
      this.selected = opened.session;
      this.applySnapshot(opened.snapshot, true);
      this.thinking = opened.snapshot.thinking ?? opened.session.thinking ?? "medium";
      this.streaming = streamingForStatus(opened.session.status);
      this.connection = "live";
      this.#startStream(id, opened.revision);
      this.requestModelsWhenReady(id, opened.session.status);
    } catch (error) {
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        // In place of the conversation, which never arrived: an empty transcript
        // would read as a session with nothing in it.
        this.openError = error instanceof Error ? error.message : "Could not open that session.";
      }
    } finally {
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        this.opening = false;
        this.#host.requestUpdate();
        this.#deps.flushLaunchPrompt();
      }
    }
  }

  /** Reads the open session again and asks the agent for a card that matches the work as it stands now. */
  async refresh(): Promise<void> {
    const id = this.selected?.id;
    if (!id || this.refreshing) return;
    const requestToken = this.#openRequestToken;
    this.refreshing = true;
    this.#refreshAccepted = false;
    this.#host.requestUpdate();
    try {
      const opened = await openSession(id);
      if (!isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) return;
      this.selected = opened.session;
      this.applySnapshot(opened.snapshot);
      // Accepted after the snapshot's own status, which says nothing about the turn to come. A running
      // session takes it as the follow-up the composer would send, rather than refusing it.
      await (this.streaming ? followUpSession : sendPrompt)(id, REFRESH_PROGRESS_PROMPT);
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) this.#refreshAccepted = true;
    } catch (error) {
      this.#endRefresh();
      if (isCurrentSessionRequest(id, this.selected?.id, requestToken, this.#openRequestToken)) {
        this.#deps.showError(error instanceof Error ? error.message : "Could not refresh that session.");
      }
    } finally {
      this.#host.requestUpdate();
    }
  }

  /** The click's work is done once the agent's own turn for it has ended. */
  #endRefresh(): void {
    this.#refreshAccepted = false;
    if (!this.refreshing) return;
    this.refreshing = false;
    this.#host.requestUpdate();
  }

  #startStream(id: string, heldRevision?: number): void {
    // An older attempt may have installed a stream while a newer open request
    // was pending. Replacing it is an ownership transfer, so close it first.
    this.#streamStop?.();
    const current = () => this.selected?.id === id;
    this.#streamStop = subscribeSession(id, {
      onSnapshot: (snapshot) => {
        if (current()) this.applySnapshot(snapshot);
      },
      onTranscript: (entries) => {
        if (current()) {
          this.transcript = normalizeTranscript(entries);
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
        this.connection = state;
        if (state !== "live") this.#deps.connectionLost();
        this.connectionNote = state === "live" ? "" : detail || "Reconnecting…";
        if (state === "stopped") {
          this.streaming = false;
        }
        this.#host.requestUpdate();
      },
    }, heldRevision);
  }

  applySnapshot(snapshot: SessionStreamSnapshot, initial = false): void {
    if (snapshot.transcript) {
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
        if (this.#refreshAccepted) this.#endRefresh();
        break;
      case "settled":
        // `settled` explains why the next status may become idle, but the
        // status SSE remains the single authority that unlocks the composer.
        this.streaming = streamingAfterEvent(this.streaming, event.type);
        if (this.#refreshAccepted) this.#endRefresh();
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
    // A refresh waits for the turn it started; a session that stops working has nothing more to send.
    if (this.#refreshAccepted && status !== "running" && status !== "waiting") this.#endRefresh();
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
    if (!session || this.streaming) return;
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
    if (!session || this.streaming) return;
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
