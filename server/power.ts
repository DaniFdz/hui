import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renameSync, rmSync, statSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { uptime } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import type { PowerState, PowerStatus } from "../shared/power.ts";
import type { Settings } from "../src/lib/settings.ts";
import { CONFIG_DIR } from "./paths.ts";

const execFileAsync = promisify(execFile);
const OFF: PowerState = { state: "off", detail: "" };
/** An unanswered macOS password dialog is abandoned after this long. */
const APPROVAL_TIMEOUT_MS = 120_000;
const PROMPT = "HUI needs administrator permission to change whether this Mac sleeps with the lid closed.";
/** `do shell script` runs the shell script it is given as root. */
const ADMIN_SCRIPT = [
  "-e", "on run argv",
  "-e", "do shell script (item 2 of argv) with prompt (item 1 of argv) with administrator privileges",
  "-e", "end run",
];
const FLAG_PREFIX = "lid-awake-";

export type PowerOptions = {
  caffeinate: string;
  osascript: string;
  pmset: string;
  /** Holds the flag files whose existence keeps a root lid watcher going. */
  flagDir: string;
  /** The process whose lifetime bounds both assertions. */
  pid: number;
};

const MACOS: PowerOptions = {
  caffeinate: "/usr/bin/caffeinate",
  osascript: "/usr/bin/osascript",
  pmset: "/usr/bin/pmset",
  flagDir: join(CONFIG_DIR, "power"),
  pid: process.pid,
};

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const forget = (paths: readonly string[]) => Promise.all(paths.map((path) => rm(path, { force: true })));

/** Another live gateway's flag, such as a development server sharing this config
 * dir. Gateways run as this user, so a PID we cannot signal is not one, and a
 * flag from before the last boot never is: its PID may belong to anything now.
 * ponytail: a crashed gateway's PID reused within a second keeps its watcher. */
function othersActiveFlag(dir: string, name: string, ownPid: number): boolean {
  const pid = Number(/^lid-awake-(\d+)-/u.exec(name)?.[1]);
  if (name.endsWith(".stop") || !(pid > 0) || pid === ownPid) return false;
  try {
    return statSync(join(dir, name)).mtimeMs > Date.now() - uptime() * 1_000 && process.kill(pid, 0);
  } catch {
    return false;
  }
}

/** macOS sleep prevention bounded by the gateway's lifetime.
 *
 * Idle sleep: a `caffeinate -i -w <pid>` child, which also exits if the gateway
 * is killed. Lid close: `pmset -a disablesleep 1` needs root, so one password
 * prompt starts a root watcher. It restores `disablesleep 0` and deletes its flag
 * once the flag is renamed to `.stop` (off, gateway stop) or the gateway process
 * is gone (crash). A flag that outlives its watcher (reboot) marks the setting as
 * HUI's until HUI takes it over or restores it, rather than an outside setting.
 * Flags carry their gateway PID, so another live gateway's flag is left alone. */
export class MacPower {
  readonly #options: PowerOptions;
  #keepAwake: PowerState = OFF;
  #lidAwake: PowerState = OFF;
  #caffeinate?: ChildProcess;
  #flag?: string;
  #prompt?: AbortController;
  /** Aborted by dispose, so queued lid work never prompts after the gateway stops. */
  #life = new AbortController();
  #lidWanted?: boolean;
  /** The latest requested choice; a step for an older one gives way to it. */
  #lidTarget = false;
  #lidQueue = Promise.resolve();

  constructor(options: PowerOptions = MACOS) {
    this.#options = options;
  }

  status(): PowerStatus {
    return { keepAwake: this.#keepAwake, lidAwake: this.#lidAwake };
  }

  /** Idle sleep changes immediately. The lid change may wait on a password
   * dialog, so it is serialized and the returned promise can be left running.
   * Turning it off withdraws a dialog still asking to turn it on; a dialog
   * restoring sleep is left to finish. */
  apply(power: Settings["power"]): Promise<void> {
    this.#applyKeepAwake(power.keepAwake);
    if (!power.lidAwake && this.#lidWanted) {
      // Withdraw a dialog still asking to turn it on; the next step re-decides.
      this.#prompt?.abort();
      this.#lidWanted = undefined;
    }
    this.#lidTarget = power.lidAwake;
    const life = this.#life.signal;
    this.#lidQueue = this.#lidQueue
      .then(() => this.#applyLidAwake(power.lidAwake, life))
      .catch((error: unknown) => {
        if (!life.aborted) this.#lidAwake = { state: "error", detail: error instanceof Error ? error.message : String(error) };
      });
    return this.#lidQueue;
  }

  dispose(): void {
    this.#applyKeepAwake(false);
    this.#life.abort();
    this.#life = new AbortController();
    // A running watcher restores on `.stop`, and a quickly restarted gateway
    // waits for it; a flag still waiting on approval has no watcher yet.
    try {
      if (this.#flag && this.#lidAwake.state === "active") renameSync(this.#flag, `${this.#flag}.stop`);
      else if (this.#flag) rmSync(this.#flag, { force: true });
    } catch {
      // Already gone: its watcher has restored sleep.
    }
    this.#flag = undefined;
    this.#lidWanted = undefined;
    this.#lidAwake = OFF;
  }

  #applyKeepAwake(want: boolean): void {
    if (!want) {
      const child = this.#caffeinate;
      this.#caffeinate = undefined;
      child?.kill();
      this.#keepAwake = OFF;
      return;
    }
    if (this.#caffeinate) return;
    const child = spawn(this.#options.caffeinate, ["-i", "-w", String(this.#options.pid)], { stdio: "ignore" });
    this.#caffeinate = child;
    this.#keepAwake = { state: "pending", detail: "" };
    child.once("spawn", () => {
      if (this.#caffeinate === child) this.#keepAwake = { state: "active", detail: "" };
    });
    const fail = (detail: string) => {
      if (this.#caffeinate !== child) return;
      this.#caffeinate = undefined;
      this.#keepAwake = { state: "error", detail };
    };
    child.once("error", (error) => fail(error.message));
    child.once("exit", (code, signal) => fail(`caffeinate exited (${signal ?? `code ${code}`}).`));
  }

  async #applyLidAwake(want: boolean, life: AbortSignal): Promise<void> {
    // Stopped, or switched again since: the later step decides.
    const current = () => !life.aborted && want === this.#lidTarget;
    // Only a changed choice acts, so unrelated settings saves never re-prompt.
    if (!current() || want === this.#lidWanted) return;
    this.#lidWanted = want;
    // #settle stops this flag's watcher along with any other.
    this.#flag = undefined;
    const leftovers = await this.#settle();
    const disabled = await this.#sleepDisabled();
    if (!current()) return;
    this.#lidWanted = want;
    if (!disabled) await forget(leftovers);
    const ours = disabled && leftovers.length > 0;
    if (!want) {
      if (!disabled) this.#lidAwake = OFF;
      else if (!ours) this.#lidAwake = { state: "off", detail: "Still on for this Mac outside HUI." };
      else {
        this.#lidAwake = { state: "pending", detail: "Waiting for administrator approval to restore lid-close sleep." };
        await this.#admin(`${quote(this.#options.pmset)} -a disablesleep 0`, life, current).catch((error: Error) => {
          throw new Error(`An earlier HUI run left lid-close sleep off. ${error.message}`);
        });
        await forget(leftovers);
        this.#lidAwake = OFF;
      }
      return;
    }
    if (disabled && !ours) {
      this.#lidAwake = { state: "active", detail: "Already on for this Mac outside HUI, so HUI leaves it unchanged." };
      return;
    }
    this.#lidAwake = { state: "pending", detail: "Waiting for administrator approval on this Mac." };
    const flag = join(this.#options.flagDir, `${FLAG_PREFIX}${this.#options.pid}-${randomUUID()}`);
    this.#flag = flag;
    try {
      await mkdir(this.#options.flagDir, { recursive: true });
      await writeFile(flag, "");
      await this.#admin(this.#watcherScript(flag), life, current);
    } catch (error) {
      await rm(flag, { force: true });
      if (this.#flag === flag) this.#flag = undefined;
      throw error;
    }
    await forget(leftovers);
    this.#lidAwake = { state: "active", detail: "" };
  }

  #watcherScript(flag: string): string {
    const pmset = quote(this.#options.pmset);
    return [
      `${pmset} -a disablesleep 1 || exit 1`,
      `(while kill -0 ${this.#options.pid} 2>/dev/null && [ -e ${quote(flag)} ]; do sleep 1; done; ${pmset} -a disablesleep 0; rm -f ${quote(flag)} ${quote(`${flag}.stop`)}) >/dev/null 2>&1 &`,
    ].join("\n");
  }

  async #admin(script: string, life: AbortSignal, current: () => boolean): Promise<void> {
    if (!current()) throw new Error("Superseded by a newer choice.");
    const prompt = new AbortController();
    this.#prompt = prompt;
    try {
      await execFileAsync(this.#options.osascript, [...ADMIN_SCRIPT, PROMPT, script], {
        timeout: APPROVAL_TIMEOUT_MS,
        signal: AbortSignal.any([prompt.signal, life]),
      });
    } catch (error) {
      throw new Error(approvalError(error));
    } finally {
      if (this.#prompt === prompt) this.#prompt = undefined;
    }
  }

  /** Stops every watcher but another live gateway's and waits until each has
   * restored sleep and deleted its flag. Flags still there after a few watcher
   * polls have no watcher (reboot) and are returned: HUI left `disablesleep` as
   * they set it, and they stay until HUI takes it over or restores it. */
  async #settle(): Promise<string[]> {
    const dir = this.#options.flagDir;
    const flags = async () => (await readdir(dir).catch(() => [] as string[]))
      .filter((name) => name.startsWith(FLAG_PREFIX) && !othersActiveFlag(dir, name, this.#options.pid));
    for (const name of await flags()) {
      if (!name.endsWith(".stop")) await rename(join(dir, name), join(dir, `${name}.stop`)).catch(() => undefined);
    }
    for (let i = 0; i < 12; i++) {
      if (!(await flags()).length) return [];
      await delay(250);
    }
    return (await flags()).map((name) => join(dir, name));
  }

  async #sleepDisabled(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(this.#options.pmset, ["-g"], { timeout: 5_000 });
      return /^\s*SleepDisabled\s+1\s*$/mu.test(stdout);
    } catch {
      return false;
    }
  }
}

/** osascript's own message never includes the root script. */
function approvalError(error: unknown): string {
  const failure = error as { name?: string; killed?: boolean; stderr?: string };
  if (failure.name === "AbortError") return "Administrator approval was withdrawn.";
  if (failure.killed) return "Administrator approval timed out.";
  if (/-128/u.test(failure.stderr ?? "")) return "Administrator approval was cancelled.";
  return failure.stderr?.trim() || "Could not change the lid-close sleep setting.";
}
