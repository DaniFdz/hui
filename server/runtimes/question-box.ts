/**
 * Questions a Durable session asks the operator itself, beside the ones its PI
 * extensions ask (`durable-extensions.ts`): they travel through the same
 * runtime contract (`question` events, `pendingQuestions`, `respondQuestion`),
 * so the chat, `hui bot chat` and a remote worker's gateway show and answer
 * them like any other. Only those routes answer them: nothing a model, a
 * routine or another bot sends can.
 */
import { randomUUID } from "node:crypto";
import type { RuntimeQuestion, RuntimeQuestionResponse } from "./types.ts";

/** A question before the box gives it an id. */
export type QuestionDraft = RuntimeQuestion extends infer Each ? Each extends RuntimeQuestion ? Omit<Each, "id"> : never : never;

type Pending = { question: RuntimeQuestion; settle(response: RuntimeQuestionResponse | undefined): void };

export class QuestionBox {
  readonly #emit: (question: RuntimeQuestion) => void;
  #pending = new Map<string, Pending>();

  /** `emit` announces each new question, as a runtime's `question` event. */
  constructor(emit: (question: RuntimeQuestion) => void) {
    this.#emit = emit;
  }

  /** Resolves with the operator's answer; undefined when it is dismissed, cancelled, or `signal` aborts first. */
  ask(draft: QuestionDraft, signal?: AbortSignal): Promise<RuntimeQuestionResponse | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const id = randomUUID();
      const dismiss = () => finish(undefined);
      const finish = (response: RuntimeQuestionResponse | undefined) => {
        if (!this.#pending.delete(id)) return;
        signal?.removeEventListener("abort", dismiss);
        resolve(response);
      };
      signal?.addEventListener("abort", dismiss, { once: true });
      const question = { ...draft, id } as RuntimeQuestion;
      this.#pending.set(id, { question, settle: finish });
      this.#emit(question);
    });
  }

  pending(): RuntimeQuestion[] {
    return [...this.#pending.values()].map((entry) => entry.question);
  }

  has(id: string): boolean {
    return this.#pending.has(id);
  }

  /** A confirmation needs `confirmed`; every other question a text `value`. */
  respond(id: string, response: RuntimeQuestionResponse): void {
    const entry = this.#pending.get(id);
    if (!entry) throw new Error(`Unknown question: ${id}`);
    if (entry.question.method === "confirm" ? !("confirmed" in response) : !("value" in response)) {
      throw new Error(entry.question.method === "confirm" ? "A confirmation response is required." : "A text response is required.");
    }
    entry.settle(response);
  }

  cancel(id: string): void {
    const entry = this.#pending.get(id);
    if (!entry) throw new Error(`Unknown question: ${id}`);
    entry.settle(undefined);
  }

  /** Dismisses every open question, as closing the session does. */
  cancelAll(): void {
    for (const entry of [...this.#pending.values()]) entry.settle(undefined);
  }
}
