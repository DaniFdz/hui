/**
 * `ConversationController` owns the open conversation's runtime choices outside `hui-app.ts`: the models the session
 * can switch to and the one it runs on, its context usage, thinking level and fast mode, with the requests that change
 * them and the once-per-selection model list request. The shell feeds it the stream's frames and reads its props.
 */
import type { ReactiveControllerHost } from "lit";
import { loadModels, setSessionFast, setSessionModel, setSessionThinking, type RuntimeModel, type RuntimeUsage, type SessionSnapshot, type SessionStatus, type SessionView } from "../api/sessions.ts";
import { isSelectedSession, modelRequestMarkerAfterFailure, shouldRequestModels } from "../lib/session/ui-state.ts";
import type { HomeProps } from "../views/home.ts";

type ConversationDeps = {
  selected: () => SessionView | undefined;
  streaming: () => boolean;
  showError: (message: string) => void;
  refreshSessions: () => Promise<void>;
};

export class ConversationController {
  /** Models the open session can switch to, and the one it is running on. */
  models: readonly RuntimeModel[] = [];
  currentModel: RuntimeModel | undefined;
  usage: RuntimeUsage | undefined;
  thinking = "medium";
  /** Fast mode; undefined while the runtime cannot change speed. */
  fast: boolean | undefined;
  readonly #host: ReactiveControllerHost;
  readonly #deps: ConversationDeps;
  /** Session whose model list has already been requested for this selection. */
  #modelsRequestedFor = "";

  constructor(host: ReactiveControllerHost, deps: ConversationDeps) {
    this.#host = host;
    this.#deps = deps;
  }

  resetModels(): void {
    this.models = [];
    this.currentModel = undefined;
    this.usage = undefined;
    this.#modelsRequestedFor = "";
  }

  adoptSnapshot(snapshot: SessionSnapshot): void {
    if (snapshot.model) this.currentModel = snapshot.model;
    this.usage = snapshot.usage;
    if (snapshot.thinking) this.thinking = snapshot.thinking;
    this.fast = snapshot.fast;
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
        if (this.#deps.selected()?.id === id) {
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
          this.#deps.selected()?.id,
        );
      });
  }

  #selectModel = (provider: string, modelId: string) => {
    const session = this.#deps.selected();
    if (!session) {
      return;
    }
    void setSessionModel(session.id, provider, modelId)
      .then((model) => {
        if (!isSelectedSession(session.id, this.#deps.selected()?.id)) {
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
        if (!isSelectedSession(session.id, this.#deps.selected()?.id)) {
          return;
        }
        this.#deps.showError(error instanceof Error ? error.message : "Could not switch model.");
      });
  };

  #selectThinking = (level: string) => {
    const session = this.#deps.selected();
    if (!session || this.#deps.streaming()) return;
    void setSessionThinking(session.id, level)
      .then((authoritative) => {
        if (isSelectedSession(session.id, this.#deps.selected()?.id)) {
          this.thinking = authoritative;
          this.#host.requestUpdate();
        }
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.#deps.selected()?.id)) return;
        // The backend broadcasts either the compensated level or the live
        // divergent level. Never overwrite that authoritative SSE state with
        // this request's stale optimistic value.
        this.#deps.showError(error instanceof Error ? error.message : "Could not switch thinking level.");
      });
  };

  #selectFast = (fast: boolean) => {
    const session = this.#deps.selected();
    if (!session || this.#deps.streaming()) return;
    void setSessionFast(session.id, fast)
      .then((authoritative) => {
        if (isSelectedSession(session.id, this.#deps.selected()?.id)) {
          this.fast = authoritative;
          this.#host.requestUpdate();
        }
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.#deps.selected()?.id)) return;
        // The gateway broadcasts the speed the session kept.
        this.#deps.showError(error instanceof Error ? error.message : "Could not change the speed.");
      });
  };

  props(): Pick<HomeProps, "thinking" | "fast" | "models" | "currentModel" | "usage" | "onSelectModel" | "onSelectThinking" | "onSelectFast"> {
    return {
      thinking: this.thinking,
      ...(this.fast === undefined ? {} : { fast: this.fast }),
      models: this.models,
      currentModel: this.currentModel,
      usage: this.usage,
      onSelectModel: this.#selectModel,
      onSelectThinking: this.#selectThinking,
      onSelectFast: this.#selectFast,
    };
  }
}
