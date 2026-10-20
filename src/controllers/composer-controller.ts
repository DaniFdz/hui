/**
 * `ComposerController` owns the open conversation's composer outside `hui-app.ts`: the session's message queue, with
 * the edit of one queued message and the requests that edit, remove, move and steer queued messages. The shell reads
 * its props and hands it the queue from the conversation's snapshots and events.
 */
import type { ReactiveControllerHost } from "lit";
import { mutateQueuedMessage, type QueueSnapshot, type SessionSnapshot, type SessionView } from "../api/sessions.ts";
import { EMPTY_QUEUE } from "../lib/composer/state.ts";
import { isSelectedSession, type NoteLevel } from "../lib/session/ui-state.ts";
import type { HomeProps } from "../views/home.ts";

type ComposerDeps = {
  selected: () => SessionView | undefined;
  showNote: (message: string, level: NoteLevel) => void;
};

export class ComposerController {
  queue: QueueSnapshot = EMPTY_QUEUE;
  queueEditingId = "";
  queueEditingText = "";
  readonly #host: ReactiveControllerHost;
  readonly #deps: ComposerDeps;

  constructor(host: ReactiveControllerHost, deps: ComposerDeps) {
    this.#host = host;
    this.#deps = deps;
  }

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
    const session = this.#deps.selected();
    if (!session) return;
    void mutateQueuedMessage(session.id, mutation)
      .then(() => {
        if (isSelectedSession(session.id, this.#deps.selected()?.id)) onSuccess?.();
      })
      .catch((error: unknown) => {
        if (!isSelectedSession(session.id, this.#deps.selected()?.id)) return;
        this.#deps.showNote(error instanceof Error ? error.message : "Could not update the queue.", "error");
      });
  }

  props(): Pick<HomeProps, "queue" | "queueEditingId" | "queueEditingText" | "onQueueEdit" | "onQueueEditChange" | "onQueueEditSubmit" | "onQueueEditCancel" | "onQueueRemove" | "onQueueMove" | "onQueueSteer"> {
    return {
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
