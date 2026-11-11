/**
 * The verification evidence an autonomous session must earn before it may open a pull request: a check command it
 * declared itself, run to success after the last change it made. HUI watches the session's tool calls, so a claim
 * without a run earns nothing, and a new edit throws the evidence away again.
 *
 * The declared command lasts for the session's lifetime in the gateway's memory. A restart loses it, which fails in
 * the safe direction: the next pull request is refused until the session declares and runs it again.
 *
 * What this cannot see: a check run by a script the command invokes under another name, a `codemode` script, or work
 * done outside the shell. It also cannot judge whether the command is a good check; it only insists one passed.
 */
export interface CheckEvidenceState {
  /** The command the session declared, trimmed, or undefined before it declares one. */
  command?: string;
  /** When the declared command last ran and passed, if it has since the last edit. */
  passedAt?: number;
}

export class CheckEvidence {
  #state: CheckEvidenceState = {};

  /** The command the session will have to run; a new declaration invalidates nothing it already proved. */
  declare(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) throw new Error("The check command cannot be empty.");
    this.#state = { ...this.#state, command: trimmed };
  }

  /** A change to tracked files: earlier evidence no longer describes this code. */
  edited(): void {
    this.#state = { ...this.#state, passedAt: undefined };
  }

  /** A shell command that ran; only the declared check counts, and only when it succeeded. */
  ran(command: string, ok: boolean, now = Date.now()): void {
    if (!ok || this.#state.command === undefined) return;
    if (command.trim() !== this.#state.command) return;
    this.#state = { ...this.#state, passedAt: now };
  }

  state(): CheckEvidenceState {
    return { ...this.#state };
  }
}
