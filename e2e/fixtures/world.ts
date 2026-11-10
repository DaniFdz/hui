/**
 * Fixture worlds the shared suite can start for one test: a second disposable gateway, launched from this checkout's own
 * visual-verification launcher with the flag that seeds it (`--jira-fixture`, `--github-fixture`, `--activity-fixture`,
 * `--datadog-fixture` for the fake `pup`, `--quota-fixture` for provider usage),
 * because a world is set on the gateway's *process environment* and the suite's own launcher starts once per target
 * without those flags (`e2e.config.ts` passes `--fast-fixture` and nothing else). A world therefore never replaces or
 * reconfigures that launcher: it is another gateway on another port, which a test opens like the app.
 *
 * What each world is comes from `e2e/visual-verification.mjs`; this module only starts it, reads the receipt it prints
 * on stdout, answers with the handful of gateway calls a board, contribution or calendar test needs, and stops it again
 * with the launcher's own SIGTERM path. The worlds are dev builds rather than the shipped bundle the target serves:
 * a production launch builds the app first, which costs more per world than the tests around it, and none of these
 * worlds' use cases read the shipped service worker or offline files.
 *
 * A world is the web target's business only. The Android app loads the gateway it was launched with (`phone.ts` passes
 * it as the `huiGatewayUrl` extra and the WebView has one page and one context), so `hui.world()` refuses there and a
 * test that needs a world stays off the phone's required list until the target starts it too.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "e2e";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The worlds the launcher can seed, and the flag it takes for each. */
export type WorldName = "jira" | "github" | "activity" | "datadog" | "quota";

/** A receipt the launcher printed: the public half of `receipt.json`, plus the path of the private one. */
type Receipt = { url: string; providerUrl: string; workspace: string; huiConfig: string; receipt: string; artifacts: string; jiraUrl?: string };

export type World = {
  name: WorldName;
  /** The world's own gateway. A test opens pages of it with `hui.open(...)` and calls it with `api`. */
  url: string;
  /** The fake services this world seeded: Jira's local Cloud subset in the `jira` world. */
  jiraUrl?: string;  /** The launcher's run directory: its state, artifacts, and the fake CLIs' own files (`gh`, `pup`). */
  runDir: string;
  /** A `/__hui/` call to the world's gateway, with the `x-hui` guard every browser request carries. */
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** A session in the world, created the way the app's own New Session does. */
  createSession(input: { title: string; group?: string; model?: string; tool?: "pi" }): Promise<{ id: string }>;
  /** Sends a prompt once the session's runtime is live, as the fixture's `hui.prompt` does for the app's gateway. */
  prompt(session: { id: string }, text: string): Promise<void>;
  /** Stops the world and everything it started, then waits for the launcher's own receipt to say so. */
  stop(): Promise<void>;
};

type ListedSession = { id: string; title: string; status: string; runtime?: { active: true } };
type SessionList = { groups: { sessions: ListedSession[] }[] };

/** The branch the launcher checks the checkout against, as `e2e.config.ts` reads it. */
function branch(): string {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}


/** The receipt the launcher prints once its gateway is ready, or the reason it never did. The timer is a failure bound on
 * a child that never answers, never a wait in place of a state: the launcher prints its receipt exactly once. */
function ready(child: ChildProcess, timeoutMs = 180_000): { receipt: Promise<Receipt> } {
  let errors = "";
  child.stderr?.on("data", (chunk) => { errors += chunk; });
  const receipt = new Promise<Receipt>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => done(new Error(`the world's launcher printed no receipt within ${Math.round(timeoutMs / 1000)} s: ${errors.trim().slice(-2_000)}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const line = output.split("\n").find((candidate) => candidate.startsWith("{"));
      if (line === undefined) return;
      try {
        done(undefined, JSON.parse(line) as Receipt);
      } catch {
        done(new Error(`the world's launcher printed a line that is not its receipt: ${line.slice(0, 500)}`));
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => done(new Error(`the world's launcher exited before its gateway was ready (${code ?? signal}): ${errors.trim().slice(-2_000)}`));
    function done(error?: Error, value?: Receipt) {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(value!);
    }
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
  return { receipt };
}

/** Starts one world and answers with the gateway a test drives, or fails saying why it could not start. */
export async function startWorld(name: WorldName): Promise<World> {
  const child = spawn(process.execPath, [
    join(repoRoot, "e2e", "visual-verification.mjs"), "launch", "--branch", branch(), `--${name}-fixture`,
  ], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  const { receipt: printed } = ready(child);
  let receipt: Receipt;
  try {
    receipt = await printed;
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  const runDir = dirname(receipt.artifacts);
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(receipt.url + path, {
      method,
      headers: { "x-hui": "1", "content-type": "application/json", connection: "close" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`world ${name}: ${method} ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  };
  const sessions = async () => (await api<SessionList>("GET", "/__hui/sessions")).groups.flatMap((group) => group.sessions);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const running = child.exitCode === null && child.signalCode === null;
    if (running) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((done) => setTimeout(done, 30_000))]);
      // The launcher rewrites its private receipt as it stops; a gateway still up would keep the world's port. A launcher
      // that died by itself leaves nothing to wait for, and its own last write says why.
      await expect.poll(async () => (await readFile(receipt.receipt, "utf8").then((text) => (JSON.parse(text) as { state?: string }).state, () => undefined)),
        { timeout: 30_000, message: `world ${name} did not stop: its receipt at ${receipt.receipt} never said so` }).toBe("stopped");
    }
    if (process.env["E2E_KEEP_WORLDS"] !== "1") await rm(runDir, { recursive: true, force: true });
  };
  return {
    name,
    url: receipt.url,
    ...(receipt.jiraUrl === undefined ? {} : { jiraUrl: receipt.jiraUrl }),
    runDir,
    api,
    createSession: async (input) => (await api<{ session: { id: string } }>("POST", "/__hui/sessions", { cwd: receipt.workspace, ...input })).session,
    prompt: async (session, text) => {
      const state = async () => (await sessions()).find(({ id }) => id === session.id);
      if ((await state())?.runtime?.active !== true) await api("POST", `/__hui/sessions/${session.id}/open`);
      await expect.poll(async () => {
        const found = await state();
        return found?.runtime?.active === true && found.status === "idle";
      }, { timeout: 60_000, message: `world ${name}: session ${session.id} never became idle enough to prompt` }).toBe(true);
      await api("POST", `/__hui/sessions/${session.id}/prompt`, { text });
    },
    stop,
  };
}
