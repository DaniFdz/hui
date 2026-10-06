/**
 * Secrets an agent asks the operator for with the `secret_request` tool.
 *
 * The value never enters a transcript, a tool result or a HUI store: the
 * operator types it into a masked question card, the gateway writes it to a
 * private temporary file (0600 in its own 0700 directory) and the agent only
 * learns that file's path. The file is deleted after `SECRET_FILE_TTL_MS` or
 * when the gateway stops, and its directory names the gateway's PID so the
 * next gateway can remove what a crashed one left. Pending requests are
 * gateway memory, like suggestion cards: a restart drops them.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** How long the operator has to answer, OpenClaw's default for its secret requests. */
export const SECRET_REQUEST_TIMEOUT_MS = 15 * 60_000;
/** How long the agent can read a delivered secret. */
export const SECRET_FILE_TTL_MS = 10 * 60_000;

/** A pending request as the session's question list carries it. */
export type SecretQuestion = { id: string; method: "secret"; title: string; message: string };

type SecretRequestResult =
  | { status: "provided"; label: string; path: string; expiresAt: string }
  | { status: "cancelled" | "expired"; label: string };

type Outcome = { value: string } | { status: "cancelled" | "expired" };
type Pending = { sessionId: string; question: SecretQuestion; settle(outcome: Outcome): void };

/** Whether a process exists; one owned by another user does too. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function field(params: Record<string, unknown>, key: string, maximum: number): string {
  const raw = params[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error(`${key} must be non-empty text.`);
  if (value.length > maximum) throw new Error(`${key} must be at most ${maximum} characters.`);
  return value;
}

export class SecretRequests {
  #pending = new Map<string, Pending>();
  /** Removers for delivered files that still exist. */
  #files = new Set<() => void>();
  #onChange: (sessionId: string) => void;
  #root: string;

  constructor(options: { onChange?: (sessionId: string) => void; root?: string } = {}) {
    this.#onChange = options.onChange ?? (() => {});
    this.#root = options.root ?? tmpdir();
  }

  questions(sessionId: string): SecretQuestion[] {
    return [...this.#pending.values()].filter((pending) => pending.sessionId === sessionId).map(({ question }) => question);
  }

  /** The tool call: waits until the operator answers or cancels, `signal`
   * aborts (Stop, or the caller went away) or the request expires. */
  async request(sessionId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<SecretRequestResult> {
    const label = field(params, "label", 120);
    const reason = field(params, "reason", 500);
    if (signal?.aborted) return { status: "cancelled", label };
    const id = randomUUID();
    const outcome = await new Promise<Outcome>((resolve) => {
      const settle = (next: Outcome) => {
        if (!this.#pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        this.#onChange(sessionId);
        resolve(next);
      };
      const cancel = () => settle({ status: "cancelled" });
      const timer = setTimeout(() => settle({ status: "expired" }), SECRET_REQUEST_TIMEOUT_MS);
      timer.unref();
      signal?.addEventListener("abort", cancel, { once: true });
      this.#pending.set(id, { sessionId, question: { id, method: "secret", title: label, message: reason }, settle });
      this.#onChange(sessionId);
    });
    if (!("value" in outcome)) return { status: outcome.status, label };
    return { status: "provided", label, ...(await this.#deliver(outcome.value)) };
  }

  /** Settles one of the session's pending requests from the question route.
   * False when `id` is none of them, so the route asks the runtime instead. */
  answer(sessionId: string, id: string, answer: Record<string, unknown>): boolean {
    const pending = this.#pending.get(id);
    if (pending?.sessionId !== sessionId) return false;
    if (answer["cancelled"] === true) {
      pending.settle({ status: "cancelled" });
      return true;
    }
    const value = answer["value"];
    if (typeof value !== "string" || !value) throw new Error("Enter the secret, or cancel the request.");
    pending.settle({ value });
    return true;
  }

  async #deliver(value: string): Promise<{ path: string; expiresAt: string }> {
    const dir = await mkdtemp(join(this.#root, `hui-secret-${process.pid}-`));
    const remove = () => {
      clearTimeout(timer);
      this.#files.delete(remove);
      rmSync(dir, { recursive: true, force: true });
    };
    const timer = setTimeout(remove, SECRET_FILE_TTL_MS);
    timer.unref();
    this.#files.add(remove);
    const path = join(dir, "secret");
    try {
      await writeFile(path, value, { mode: 0o600, flag: "wx" });
    } catch {
      remove();
      throw new Error("HUI could not hand the secret to the agent; ask for it again.");
    }
    return { path, expiresAt: new Date(Date.now() + SECRET_FILE_TTL_MS).toISOString() };
  }

  /** Gateway start: a gateway that crashed left its files without a timer. */
  async sweep(): Promise<void> {
    for (const name of await readdir(this.#root).catch(() => [])) {
      const pid = Number(/^hui-secret-(\d+)-/u.exec(name)?.[1]);
      if (pid && pid !== process.pid && !running(pid)) await rm(join(this.#root, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Gateway stop: pending requests end cancelled and delivered files go. */
  dispose(): void {
    for (const { settle } of [...this.#pending.values()]) settle({ status: "cancelled" });
    for (const remove of [...this.#files]) remove();
  }
}
