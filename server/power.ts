import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renameSync, rmSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
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

/** macOS sleep prevention bounded by the gateway's lifetime.
 *
 * Idle sleep: a `caffeinate -i -w <pid>` child, which also exits if the gateway
 * is killed. Lid close: `pmset -a disablesleep 1` needs root, so one password
 * prompt starts a root watcher. It restores `disablesleep 0` and deletes its flag
 * once the flag is renamed to `.stop` (off, gateway stop) or the gateway process
 * is gone (crash). A flag that outlives its watcher (reboot) marks the setting as
 * HUI's, so HUI restores it rather than calling it an outside setting.
 * ponytail: one gateway per config dir; two with lid-awake on would treat each
 * other's flags as leftovers. */
export class MacPower {
  readonly #options: PowerOptions;
  #keepAwake: PowerState = OFF;
  #lidAwake: PowerState = OFF;
  #caffeinate?: ChildProcess;
  #flag?: string;
  #prompt?: AbortController;
  #lidWanted?: boolean;
  /** An earlier HUI run left `disablesleep 1` without a watcher. */
  #leftover = false;
  #lidQueue = Promise.resolve();

  constructor(options: PowerOptions = MACOS) {
    this.#options = options;
  }

  status(): PowerStatus {
    return { keepAwake: this.#keepAwake, lidAwake: this.#lidAwake };
  }

  /** Idle sleep changes immediately. The lid change may wait on a password
   * dialog, so it is serialized and the returned promise can be left running;
   * turning it off withdraws a dialog that is still open. */
  apply(power: Settings["power"]): Promise<void> {
    this.#applyKeepAwake(power.keepAwake);
    if (!power.lidAwake) this.#prompt?.abort();
    this.#lidQueue = this.#lidQueue
      .then(() => this.#applyLidAwake(power.lidAwake))
      .catch((error: unknown) => {
        this.#lidAwake = { state: "error", detail: error instanceof Error ? error.message : String(error) };
      });
    return this.#lidQueue;
  }

  dispose(): void {
    this.#applyKeepAwake(false);
    this.#prompt?.abort();
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

  async #applyLidAwake(want: boolean): Promise<void> {
    // Only a changed choice acts, so unrelated settings saves never re-prompt.
    if (want === this.#lidWanted) return;
    this.#lidWanted = want;
    if (this.#flag) {
      // A vanished flag already stopped its watcher; #settle handles the rest.
      await rename(this.#flag, `${this.#flag}.stop`).catch(() => undefined);
      this.#flag = undefined;
    }
    if (await this.#settle()) this.#leftover = true;
    const disabled = await this.#sleepDisabled();
    if (!want) {
      if (!disabled) this.#lidAwake = OFF;
      else if (!this.#leftover) this.#lidAwake = { state: "off", detail: "Still on for this Mac outside HUI." };
      else {
        this.#lidAwake = { state: "pending", detail: "Waiting for administrator approval to restore lid-close sleep." };
        await this.#admin(`${quote(this.#options.pmset)} -a disablesleep 0`).catch((error: Error) => {
          throw new Error(`An earlier HUI run left lid-close sleep off. ${error.message}`);
        });
        this.#leftover = false;
        this.#lidAwake = OFF;
      }
      return;
    }
    if (disabled && !this.#leftover) {
      this.#lidAwake = { state: "active", detail: "Already on for this Mac outside HUI, so HUI leaves it unchanged." };
      return;
    }
    this.#lidAwake = { state: "pending", detail: "Waiting for administrator approval on this Mac." };
    const flag = join(this.#options.flagDir, `${FLAG_PREFIX}${randomUUID()}`);
    this.#flag = flag;
    try {
      await mkdir(this.#options.flagDir, { recursive: true });
      await writeFile(flag, "");
      await this.#admin(this.#watcherScript(flag));
    } catch (error) {
      await rm(flag, { force: true });
      if (this.#flag === flag) this.#flag = undefined;
      throw error;
    }
    this.#leftover = false;
    this.#lidAwake = { state: "active", detail: "" };
  }

  #watcherScript(flag: string): string {
    const pmset = quote(this.#options.pmset);
    return [
      `${pmset} -a disablesleep 1 || exit 1`,
      `(while kill -0 ${this.#options.pid} 2>/dev/null && [ -e ${quote(flag)} ]; do sleep 1; done; ${pmset} -a disablesleep 0; rm -f ${quote(flag)} ${quote(`${flag}.stop`)}) >/dev/null 2>&1 &`,
    ].join("\n");
  }

  async #admin(script: string): Promise<void> {
    const prompt = new AbortController();
    this.#prompt = prompt;
    try {
      await execFileAsync(this.#options.osascript, [...ADMIN_SCRIPT, PROMPT, script], { timeout: APPROVAL_TIMEOUT_MS, signal: prompt.signal });
    } catch (error) {
      throw new Error(approvalError(error));
    } finally {
      if (this.#prompt === prompt) this.#prompt = undefined;
    }
  }

  /** Waits for watchers to restore sleep and delete their flags. Flags left after
   * a few watcher polls outlived their watcher (reboot, crash with a reused PID):
   * they are deleted, and true says HUI left `disablesleep` as it was set. */
  async #settle(): Promise<boolean> {
    const flags = async () => (await readdir(this.#options.flagDir).catch(() => [] as string[])).filter((name) => name.startsWith(FLAG_PREFIX));
    for (let i = 0; i < 12; i++) {
      if (!(await flags()).length) return false;
      await delay(250);
    }
    await Promise.all((await flags()).map((name) => rm(join(this.#options.flagDir, name), { force: true })));
    return true;
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
