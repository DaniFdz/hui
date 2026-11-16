/**
 * The worker's own trigger hook endpoint: the loopback port a worker's host
 * opens so that a listener running on that machine (the program the operator
 * wrote to watch a Slack, a Jira board, a repo) reports to the trigger it wakes
 * on the machine the listener runs on, instead of reaching the gateway's
 * `POST /__hui/hooks/<token>` across the tailnet.
 *
 *   POST http://127.0.0.1:<hookPort>/__hui/hooks/<token>   { "events": [...] }
 *
 * The report is relayed to a connected gateway as `hooks.report { token, body }`,
 * body unparsed, and the gateway's answer (the trigger decision its own route
 * makes: 202, 404, 409, 413, 400, with its JSON) is returned to the listener
 * verbatim. With no gateway attached, or one too old to serve `hooks.report`,
 * the report waits in this host's queue instead of being lost: one JSON file
 * per report, `{ token, body }`, named by its place in line and a random id,
 * never by the token, which is a secret. A report is written under a private
 * temporary name and renamed to its place in line, so a drain reading the
 * queue sees whole reports only, and one that arrives while older ones wait
 * goes behind them instead of overtaking the queue. A report that waited is
 * relayed, in order, when the next gateway attaches, and an answer of 500 or
 * more (the gateway could not decide) keeps it, with the rest behind it, for
 * the next attach or for the next offer a retry makes: a drain that stopped at
 * a link that failed or timed out asks again after `retryMs` while a gateway
 * is attached, while one an older gateway refused waits for a gateway that can
 * take it. The queue holds `HOOK_QUEUE_LIMIT` reports, and a listener that
 * arrives past it is told to send its report again later (503) rather than
 * having it dropped. `close()` stops taking reports and waits for the relay in
 * flight only, leaving what still waits on disk.
 *
 * Only loopback: the host binds `127.0.0.1`, never another address, so nothing
 * off this machine reaches the endpoint, and the gateway's tailnet rule never
 * applies here. A report's token and body are never logged.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import { HookBodyError, HOOK_ROUTE, readHookText } from "../bots/triggers-listener.ts";

/** Under the host's state directory: its reports waiting for a gateway. */
export const HOOK_QUEUE_DIR = "hook-queue";
/** Reports one worker keeps for the next gateway; past this a listener is asked to report again later. */
export const HOOK_QUEUE_LIMIT = 500;
/** How long the listener waits for a gateway to decide a report before it is kept in the queue instead. */
export const HOOK_RELAY_TIMEOUT_MS = 12_000;
/** How long a drain that stopped at a retryable failure waits before it offers the queue again by itself. */
export const HOOK_RETRY_MS = 15_000;
/** The only address the endpoint ever listens on. */
const HOOK_HOST = "127.0.0.1";
/** A report being written, under a name no drain reads: it becomes a report only when it is renamed. */
const TEMPORARY = ".tmp-";

/** Nothing answered the report: no gateway is attached, the one attached predates `hooks.report`, or the link failed
 * or timed out. Its body waits in the queue; nothing about it is logged. `retry` says whether waiting can end without
 * a new gateway: a link that failed or timed out is tried again, while a gateway too old to serve the relay only
 * changes when another one attaches. */
export class HookRelayUnavailable extends Error {
  override name = "HookRelayUnavailable";
  /** Whether offering the report again without a new gateway could deliver it. */
  readonly retry: boolean;

  constructor(message: string, options: { retry?: boolean } = {}) {
    super(message);
    this.retry = options.retry !== false;
  }
}

/** A trigger decision, as the gateway's own route makes it. */
export type HookAnswer = { status: number; body: Record<string, unknown> };

/** `<nine digits or more>-<uuid>.json`: its place in line, then an id no other report shares. */
const QUEUED = /^(\d{9,})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/u;

/** A queued report as the drain reads it back. */
type QueuedReport = { token: string; body: string };

export type WorkerHookEndpointOptions = {
  /** Where reports that no gateway could take wait: `join(stateDir, HOOK_QUEUE_DIR)`. */
  dir: string;
  /** The loopback port to bind; `0` binds any free one. */
  port: number;
  /** Hands one report to a connected gateway; throws `HookRelayUnavailable` when none can take it. */
  relay(token: string, body: string): Promise<HookAnswer>;
  /** Whether a gateway is attached now: a report that waits behind a failure is offered again by itself while one is.
   * Absent: only `drain()` offers it again. */
  canRelay?(): boolean;
  /** How long a retry waits before it offers the queue again; `HOOK_RETRY_MS` by default. */
  retryMs?: number;
  /** A report started or ended here: the host is at work, never idle. */
  onActivity?(): void;
};

export class WorkerHookEndpoint {
  readonly #dir: string;
  readonly #port: number;
  readonly #relay: (token: string, body: string) => Promise<HookAnswer>;
  readonly #canRelay: () => boolean;
  readonly #retryMs: number;
  readonly #onActivity: (() => void) | undefined;
  #server: Server | undefined;
  #bound: number | undefined;
  /** Requests being answered and drains running; the host is not idle while one is. */
  #handling = 0;
  #draining = false;
  /** `drain()` was asked for while one ran: it runs once more when that one ends. */
  #drainAgain = false;
  /** A retry waiting for its turn; none while a drain runs. */
  #retry: NodeJS.Timeout | undefined;
  #closed = false;
  /** Queue writes, one at a time, so each report gets its own place in line. */
  #writes: Promise<unknown> = Promise.resolve();
  /** The newest place in line handed out, also read back from the queue so a restart keeps the order. */
  #sequence = 0;
  /** In-flight work, waited for by `close()`. */
  readonly #work = new Set<Promise<unknown>>();

  constructor(options: WorkerHookEndpointOptions) {
    this.#dir = options.dir;
    this.#port = options.port;
    this.#relay = options.relay;
    this.#canRelay = options.canRelay ?? (() => false);
    this.#retryMs = options.retryMs ?? HOOK_RETRY_MS;
    this.#onActivity = options.onActivity;
  }

  /** The port it bound, or undefined before `listen()` and after `close()`. */
  get port(): number | undefined {
    return this.#bound;
  }

  /** Where a listener on this machine reports, `http://127.0.0.1:<port>`; undefined while it is not listening. */
  get url(): string | undefined {
    return this.#bound === undefined ? undefined : `http://${HOOK_HOST}:${this.#bound}`;
  }

  /** The address it bound, `127.0.0.1`; undefined before `listen()` and after `close()`. */
  get address(): string | undefined {
    const address = this.#server?.address();
    return address && typeof address === "object" ? address.address : undefined;
  }

  /** A report is being handled, or queued reports are being drained: the host never stops meanwhile. */
  get busy(): boolean {
    return this.#handling > 0 || this.#draining;
  }

  /** Binds loopback. Rejects when it cannot bind; the host keeps running. */
  async listen(): Promise<void> {
    if (this.#server) return;
    // A write cut off by the last stop left a temporary name behind: it was never a report, and nothing else writes
    // in this directory yet.
    for (const name of await readdir(this.#dir).catch(() => [] as string[])) {
      if (name.startsWith(TEMPORARY)) await rm(join(this.#dir, name), { force: true }).catch(() => undefined);
    }
    const server = createServer((request, response) => { this.#track(this.#handle(request, response)); });
    this.#server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        // Loopback and nothing else, whatever this machine's addresses are: the listener runs here.
        server.listen(this.#port, HOOK_HOST, () => { server.off("error", reject); resolve(); });
      });
    } catch (error) {
      this.#server = undefined;
      server.close();
      throw error;
    }
    const address = server.address();
    this.#bound = address && typeof address === "object" ? address.port : undefined;
    // Its port never keeps the host alive; the host's own decisions do.
    server.unref();
  }

  /** Relays what waited, in order, one report at a time. A drain already running is the one that sends them, and a
   * request it has to hear about (a gateway attached while it runs) makes it run once more when it ends. */
  drain(): void {
    if (this.#closed) return;
    if (this.#draining) {
      this.#drainAgain = true;
      return;
    }
    this.#clearRetry();
    this.#draining = true;
    this.#track(this.#drain().finally(() => {
      this.#draining = false;
      if (!this.#drainAgain) return;
      this.#drainAgain = false;
      if (!this.#closed) this.drain();
    }));
  }

  /** Stops accepting, waits for the relay in flight, and closes the port. What still waits stays on disk. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#clearRetry();
    const server = this.#server;
    this.#server = undefined;
    this.#bound = undefined;
    if (server) {
      await new Promise<void>((done) => { server.close(() => done()); server.closeIdleConnections(); });
    }
    await Promise.allSettled([...this.#work]);
    await this.#writes.catch(() => undefined);
  }

  #track<T>(work: Promise<T>): Promise<T> {
    this.#work.add(work);
    void work.then(() => this.#work.delete(work), () => this.#work.delete(work));
    return work;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.#handling += 1;
    this.#onActivity?.();
    try {
      if (request.method !== "POST") return this.#answer(response, 405, { error: "method not allowed" });
      const path = (request.url ?? "/").split("?")[0]!;
      const token = HOOK_ROUTE.exec(path)?.[1];
      if (!token) return this.#answer(response, 404, { error: "No trigger has this URL." });
      let body: string;
      try {
        body = await readHookText(request);
      } catch (error) {
        if (error instanceof HookBodyError) return this.#answer(response, error.status, { error: error.message });
        return this.#answer(response, 400, { error: "The report could not be read." });
      }
      // A report that arrives while older ones wait goes behind them: relayed now, it would overtake the queue.
      if (await this.#waiting()) return await this.#queue(response, token, body);
      try {
        const answer = await this.#relay(token, body);
        return this.#answer(response, answer.status, answer.body);
      } catch {
        // Nothing took it: it waits here for the next gateway instead of the listener losing it.
        return await this.#queue(response, token, body);
      }
    } finally {
      this.#handling -= 1;
      this.#onActivity?.();
    }
  }

  /** Keeps one report for the next gateway, or tells the listener to report again later. */
  async #queue(response: ServerResponse, token: string, body: string): Promise<void> {
    let result: "queued" | "full";
    try {
      const write = this.#writes.then(() => this.#writeReport(token, body));
      this.#writes = write.catch(() => undefined);
      result = await write;
    } catch {
      return this.#answer(response, 500, { error: "The report could not be kept on this machine." });
    }
    if (result === "full") {
      return this.#answer(response, 503, { error: `${HOOK_QUEUE_LIMIT} reports are already waiting for HUI to reconnect: report this one again later.` });
    }
    // Behind reports that were already here, over the gateway attached now when nothing is sending them yet.
    if (!this.#draining && this.#canRelay()) this.drain();
    this.#answer(response, 202, { status: "queued" });
  }

  /** Whether a report has to wait its turn: a drain sends what is queued, or the queue holds a report. */
  async #waiting(): Promise<boolean> {
    return this.#draining || (await this.#queued()).length > 0;
  }

  /** The reports in the queue, oldest first: their final names only, never one being written. */
  async #queued(): Promise<string[]> {
    return (await readdir(this.#dir).catch(() => [] as string[])).filter((name) => QUEUED.test(name)).sort();
  }

  /** Writes one report under a private temporary name and renames it to its place in line, mode 0600 in a directory
   * only this user reads. The rename is what makes it a report: a drain reading the queue never sees half of one. */
  async #writeReport(token: string, body: string): Promise<"queued" | "full"> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    // A directory that already existed keeps its mode until it is set: 0700, as the host's own state.
    await chmod(this.#dir, 0o700);
    const names = (await readdir(this.#dir)).filter((name) => QUEUED.test(name));
    if (names.length >= HOOK_QUEUE_LIMIT) return "full";
    for (const name of names) this.#sequence = Math.max(this.#sequence, Number(QUEUED.exec(name)![1]));
    const sequence = ++this.#sequence;
    const report: QueuedReport = { token, body };
    const temporary = join(this.#dir, `${TEMPORARY}${randomUUID()}`);
    const final = join(this.#dir, `${String(sequence).padStart(9, "0")}-${randomUUID()}.json`);
    try {
      // `wx`: a name two writers somehow shared is never overwritten by one of them.
      await writeFile(temporary, JSON.stringify(report), { mode: 0o600, flag: "wx" });
      // The same directory, so the rename is atomic: the report is absent or whole, never a file to read half of.
      await rename(temporary, final);
    } catch (error) {
      // A half-written report is no report: nothing reads a temporary name, and its writer drops it.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return "queued";
  }

  /** Relays the queue oldest first, one report at a time; the first report nothing takes keeps the rest waiting. */
  async #drain(): Promise<void> {
    this.#onActivity?.();
    try {
      for (;;) {
        // Shutdown waits for the relay in flight and leaves the rest on disk for the next host.
        if (this.#closed) return;
        const name = (await this.#queued())[0];
        if (!name) return;
        const file = join(this.#dir, name);
        const report = await this.#readQueued(file);
        if (!report) {
          // A report that cannot be read back can never be relayed: the one file that made it is dropped, never kept as a
          // block in front of the queue. Only a final name is a report: a writer's temporary one is left to its writer.
          if (QUEUED.test(name)) await rm(file, { force: true });
          continue;
        }
        let answer: HookAnswer;
        try {
          answer = await this.#relay(report.token, report.body);
        } catch (error) {
          // The gateway went away, timed out, or is too old to serve it: this report and the rest wait for the next one,
          // and for a failure that can pass, for one more offer without waiting for a new gateway.
          if (this.#retryable(error)) this.#scheduleRetry();
          return;
        }
        if (answer.status >= 500) {
          // The gateway could not decide: the report is not settled, so it and the rest wait for the next attach, or the
          // next offer a retry makes.
          this.#scheduleRetry();
          return;
        }
        // Any other answer settles it, a refusal included: the gateway keeps nothing of a report it refused.
        await rm(file, { force: true });
      }
    } finally {
      this.#onActivity?.();
    }
  }

  /** Whether offering the queue again without a new gateway could deliver the report: a failure that may pass, never
   * one that says the attached gateway cannot serve this relay at all. */
  #retryable(error: unknown): boolean {
    return !(error instanceof HookRelayUnavailable) || error.retry;
  }

  /** Offers the queue again after `retryMs`, while a gateway is still attached: once, never after `close()`. */
  #scheduleRetry(): void {
    if (this.#closed || this.#retry !== undefined || !this.#canRelay()) return;
    const timer = setTimeout(() => {
      this.#retry = undefined;
      this.drain();
    }, this.#retryMs);
    // A retry never keeps the host alive on its own: the host's own decisions do.
    timer.unref();
    this.#retry = timer;
  }

  #clearRetry(): void {
    if (this.#retry === undefined) return;
    clearTimeout(this.#retry);
    this.#retry = undefined;
  }

  async #readQueued(file: string): Promise<QueuedReport | undefined> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(file, "utf8"));
    } catch {
      return undefined;
    }
    if (typeof value !== "object" || value === null) return undefined;
    const { token, body } = value as Record<string, unknown>;
    return typeof token === "string" && token !== "" && typeof body === "string" ? { token, body } : undefined;
  }

  #answer(response: ServerResponse, status: number, body: Record<string, unknown>): void {
    if (response.writableEnded || response.destroyed) return;
    const json = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(json),
    });
    response.end(json);
  }
}
