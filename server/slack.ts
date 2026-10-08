/**
 * Slack (HUI-18, Slack triggers): the gateway's one Slack connection and its Web API client.
 *
 * The operator connects a User OAuth Token (`xoxp-…`) of an app they created in their own workspace (the manifest is
 * `shared/slack.ts`'s). HUI keeps it in `~/.config/hui/slack.json`, written like Jira's credentials (`jira.ts`): mode 0600, a
 * temporary file and a rename. The token never crosses a `/__hui/` response, a diagnostic or a log line, and is only sent
 * to Slack's API origin, in an Authorization header, with redirects refused.
 *
 * The client calls only read methods (auth.test, search.messages, users.info, conversations.replies): nothing here
 * posts, reacts or edits, and the scopes the manifest asks for allow none of it. A 429 carries Slack's Retry-After;
 * an answer that means the token is no good any more (revoked, expired, the app removed) marks the connection so the
 * status says to connect again.
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SLACK_REVOKED_MESSAGE, SLACK_SCOPE_NAMES, SLACK_USER_TOKEN, type SlackConnection, type SlackConnectionStatus } from "../shared/slack.ts";
import { CONFIG_DIR } from "./paths.ts";

export const SLACK_CONFIG_FILE = join(CONFIG_DIR, "slack.json");
export const SLACK_API_ORIGIN = "https://slack.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** How long a status read from Slack stays fresh before `view({ verify })` asks again. */
const VERIFY_AFTER_MS = 10 * 60_000;

/** Who a token acts as, as auth.test answers. */
export type SlackIdentity = { userId: string; user: string; teamId: string; team: string; url: string; enterpriseId?: string };
export type SlackConfig = SlackIdentity & { token: string; scopes?: string[]; connectedAt: string };

/** Input HUI refuses before asking Slack (400). Its message never quotes the token. */
export class SlackInputError extends Error {
  override name = "SlackInputError";
}

/** Slack answered `ok: false`, an HTTP error, or could not be reached. `code` is Slack's error (`invalid_auth`, `ratelimited`…)
 * or HUI's (`unreachable`, `timeout`, `http_502`, `invalid_response`). */
export class SlackApiError extends Error {
  override name = "SlackApiError";
  readonly code: string;
  readonly status: number | undefined;
  /** A 429's Retry-After, in milliseconds. */
  readonly retryAfterMs: number | undefined;
  constructor(code: string, options: { status?: number; retryAfterMs?: number; message?: string } = {}) {
    super(options.message ?? slackErrorMessage(code));
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Slack's answers that mean the token is no good any more: connect again. */
export const SLACK_AUTH_ERRORS: ReadonlySet<string> = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"]);

export const isSlackAuthError = (error: unknown): boolean => error instanceof SlackApiError && SLACK_AUTH_ERRORS.has(error.code);

/** One plain line for an error code: what happened and what to do. */
export function slackErrorMessage(code: string): string {
  if (SLACK_AUTH_ERRORS.has(code)) return SLACK_REVOKED_MESSAGE;
  if (code === "missing_scope") return "The Slack token lacks a scope this needs: add the scopes of HUI's manifest to your Slack app (OAuth & Permissions → User Token Scopes), reinstall it and connect again.";
  if (code === "ratelimited") return "Slack's rate limit: HUI waits as long as Slack asks before reading again.";
  if (code === "timeout") return "Slack did not answer in time.";
  if (code === "unreachable") return "Slack could not be reached.";
  if (code === "invalid_response") return "Slack answered something HUI could not read.";
  if (code === "not_allowed_token_type") return "That is not a user token: connect the User OAuth Token (xoxp-…) of your Slack app.";
  if (/^http_\d{3}$/u.test(code)) return `Slack answered HTTP ${code.slice(5)}.`;
  return `Slack answered ${code.replace(/[^a-z0-9_.-]/giu, "").slice(0, 60) || "an error"}.`;
}

/** Where the Web API lives: slack.com, or one exact loopback origin (`HUI_SLACK_TEST_ORIGIN`) so tests and Browser E2E run against a
 * fake Slack. Anything else is refused: a token goes nowhere but Slack. */
export function slackOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const test = env["HUI_SLACK_TEST_ORIGIN"]?.trim();
  if (!test) return SLACK_API_ORIGIN;
  let url: URL;
  try {
    url = new URL(test);
  } catch {
    return SLACK_API_ORIGIN;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  return url.protocol === "http:" && loopback && !url.username && !url.password && url.pathname === "/" ? url.origin : SLACK_API_ORIGIN;
}

/** A pasted token, trimmed and checked; the error never quotes it. */
export function normalizeSlackToken(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) throw new SlackInputError("Paste your Slack app's User OAuth Token (it starts with xoxp-).");
  if (token.length > 500) throw new SlackInputError("That Slack token is too long.");
  if (/^xox[abr]-/u.test(token)) throw new SlackInputError("That is a bot or app token: connect the User OAuth Token (xoxp-…) from your Slack app's OAuth & Permissions page.");
  if (!SLACK_USER_TOKEN.test(token)) throw new SlackInputError("That doesn't look like a Slack User OAuth Token: it starts with xoxp-.");
  return token;
}

/* ── the stored connection ─────────────────────────────────────────────── */

const ID = /^[A-Z0-9]{2,40}$/u;
const line = (value: unknown, max = 200): string => (typeof value === "string" ? value.replace(/[\p{Cc}]+/gu, " ").trim().slice(0, max) : "");

function parseConfig(raw: unknown): SlackConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const token = typeof source["token"] === "string" ? source["token"].trim() : "";
  const userId = line(source["userId"], 40);
  const teamId = line(source["teamId"], 40);
  if (!SLACK_USER_TOKEN.test(token) || !ID.test(userId) || !ID.test(teamId)) return undefined;
  const enterpriseId = line(source["enterpriseId"], 40);
  const scopes = Array.isArray(source["scopes"]) ? source["scopes"].filter((scope): scope is string => typeof scope === "string" && /^[a-z:._-]{1,60}$/u.test(scope)).slice(0, 100) : undefined;
  return {
    token, userId, teamId,
    user: line(source["user"], 120), team: line(source["team"], 200), url: line(source["url"], 300),
    connectedAt: line(source["connectedAt"], 40),
    ...(ID.test(enterpriseId) ? { enterpriseId } : {}),
    ...(scopes ? { scopes } : {}),
  };
}

/** `slack.json`: the token and who it is, readable by the operator only. */
export class SlackConfigStore {
  readonly path: string;
  constructor(path = SLACK_CONFIG_FILE) {
    this.path = path;
  }

  async read(): Promise<SlackConfig | undefined> {
    try {
      return parseConfig(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return undefined;
    }
  }

  async write(config: SlackConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async remove(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

/* ── the Web API ───────────────────────────────────────────────────────── */

export type SlackFetch = (url: string, init: RequestInit) => Promise<Response>;
type Params = Record<string, string | number | boolean | undefined>;

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new SlackApiError("invalid_response", { message: "Slack returned more data than HUI accepts." });
    }
    text += decoder.decode(value, { stream: true });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A read-only Slack Web API client for one user token. */
export class SlackClient {
  readonly #token: string;
  readonly #fetch: SlackFetch;
  readonly #origin: string;
  /** Requests made, for status lines and tests. */
  requests = 0;

  constructor(token: string, options: { fetch?: SlackFetch; origin?: string } = {}) {
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#origin = options.origin ?? slackOrigin();
  }

  /** One method, its arguments form-encoded in a POST (never in a URL), the token in the Authorization header. */
  async call(method: string, params: Params = {}): Promise<{ body: Record<string, unknown>; headers: Headers }> {
    if (!/^[a-z]+(?:\.[a-zA-Z]+)+$/u.test(method)) throw new SlackApiError("invalid_arguments");
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) form.set(key, String(value));
    let response: Response;
    this.requests += 1;
    try {
      response = await this.#fetch(`${this.#origin}/api/${method}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${this.#token}`,
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: form.toString(),
      });
    } catch (error) {
      throw new SlackApiError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable");
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => {});
      const seconds = Number(response.headers.get("retry-after"));
      throw new SlackApiError("ratelimited", { status: 429, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3_600) * 1_000 : 60_000 });
    }
    const text = await readBounded(response);
    if (!response.ok) throw new SlackApiError(`http_${response.status}`, { status: response.status });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new SlackApiError("invalid_response", { status: response.status });
    }
    if (!isRecord(body)) throw new SlackApiError("invalid_response", { status: response.status });
    if (body["ok"] !== true) {
      const code = typeof body["error"] === "string" && /^[a-z0-9_.-]{1,80}$/iu.test(body["error"]) ? body["error"] : "unknown_error";
      const seconds = Number(response.headers.get("retry-after"));
      throw new SlackApiError(code, { status: response.status, ...(code === "ratelimited" ? { retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 60_000 } : {}) });
    }
    return { body, headers: response.headers };
  }

  /** Who the token acts as, and its scopes when Slack reports them (`x-oauth-scopes`). */
  async authTest(): Promise<SlackIdentity & { scopes?: string[] }> {
    const { body, headers } = await this.call("auth.test");
    const userId = line(body["user_id"], 40);
    const teamId = line(body["team_id"], 40);
    if (!ID.test(userId) || !ID.test(teamId)) throw new SlackApiError("invalid_response");
    const enterpriseId = line(body["enterprise_id"], 40);
    const scopes = headers.get("x-oauth-scopes")?.split(",").map((scope) => scope.trim()).filter((scope) => /^[a-z:._-]{1,60}$/u.test(scope));
    return {
      userId, teamId, user: line(body["user"], 120), team: line(body["team"], 200), url: line(body["url"], 300),
      ...(ID.test(enterpriseId) ? { enterpriseId } : {}),
      ...(scopes?.length ? { scopes } : {}),
    };
  }

  /** One page of search.messages, newest first. */
  async searchMessages(query: string, page = 1, count = 100): Promise<{ matches: Record<string, unknown>[]; pages: number }> {
    const { body } = await this.call("search.messages", { query, sort: "timestamp", sort_dir: "desc", count, page, highlight: false });
    const messages = isRecord(body["messages"]) ? body["messages"] : {};
    const matches = Array.isArray(messages["matches"]) ? messages["matches"].filter(isRecord) : [];
    const paging = isRecord(messages["paging"]) ? messages["paging"] : isRecord(messages["pagination"]) ? messages["pagination"] : {};
    const pages = Number(paging["pages"] ?? paging["page_count"]);
    return { matches, pages: Number.isSafeInteger(pages) && pages > 0 ? Math.min(pages, 100) : 1 };
  }

  /** A member, or undefined when Slack doesn't know them (a stranger it won't describe). */
  async userInfo(user: string): Promise<Record<string, unknown> | undefined> {
    try {
      const { body } = await this.call("users.info", { user });
      return isRecord(body["user"]) ? body["user"] : undefined;
    } catch (error) {
      if (error instanceof SlackApiError && (error.code === "user_not_found" || error.code === "user_not_visible")) return undefined;
      throw error;
    }
  }

  /** The message a thread starts with: conversations.replies' first message, when it is the thread's. */
  async threadParent(channel: string, threadTs: string): Promise<Record<string, unknown> | undefined> {
    const { body } = await this.call("conversations.replies", { channel, ts: threadTs, limit: 1, inclusive: true });
    const first = Array.isArray(body["messages"]) ? body["messages"].find(isRecord) : undefined;
    return first && first["ts"] === threadTs ? first : undefined;
  }
}

/* ── the connection ────────────────────────────────────────────────────── */

type CheckState = { status: Exclude<SlackConnectionStatus, "not_connected">; message: string; checkedAt?: string };

/** The scopes Slack triggers need that a token lacks; nothing when Slack didn't report the token's scopes. */
export function missingSlackScopes(scopes: readonly string[] | undefined): string[] {
  if (!scopes) return [];
  return SLACK_SCOPE_NAMES.filter((scope) => !scopes.includes(scope));
}

function connectedState(config: SlackIdentity & { scopes?: string[] }, at: string): CheckState {
  const missing = missingSlackScopes(config.scopes);
  const who = `${config.user || config.userId} in ${config.team || config.teamId}`;
  if (missing.length) return { status: "missing_scopes", message: `Connected as ${who}, but the token lacks ${missing.join(", ")}: add them to your Slack app (OAuth & Permissions → User Token Scopes), reinstall it and connect again.`, checkedAt: at };
  return { status: "connected", message: `Connected as ${who}.`, checkedAt: at };
}

export type SlackConnectorDeps = {
  store?: SlackConfigStore;
  fetch?: SlackFetch;
  origin?: string;
  now?: () => number;
};

/**
 * The gateway's Slack connection: the stored token, a client for it, and what Slack last said about it. Connecting
 * verifies the token with auth.test before anything is stored; the Slack triggers' poller reports what Slack answers
 * it (`refused`, `accepted`), so a revoked token shows in the status without a check of its own.
 */
export class SlackConnector {
  readonly #store: SlackConfigStore;
  readonly #fetch: SlackFetch | undefined;
  readonly #origin: string;
  readonly #now: () => number;
  #config?: SlackConfig;
  #state?: CheckState;
  #loaded?: Promise<void>;
  readonly #listeners = new Set<() => void>();

  constructor(deps: SlackConnectorDeps = {}) {
    this.#store = deps.store ?? new SlackConfigStore();
    this.#fetch = deps.fetch;
    this.#origin = deps.origin ?? slackOrigin();
    this.#now = deps.now ?? Date.now;
  }

  async #load(): Promise<void> {
    this.#loaded ??= this.#store.read().then((config) => { this.#config = config; });
    await this.#loaded;
  }

  /** The stored connection, the token included: for the gateway's own use, never for a route. */
  async config(): Promise<SlackConfig | undefined> {
    await this.#load();
    return this.#config;
  }

  /** A client for the stored token, or undefined while none is stored. */
  async client(): Promise<SlackClient | undefined> {
    const config = await this.config();
    return config ? this.clientFor(config.token) : undefined;
  }

  clientFor(token: string): SlackClient {
    return new SlackClient(token, { ...(this.#fetch ? { fetch: this.#fetch } : {}), origin: this.#origin });
  }

  /** Hears every connect and disconnect (the poller starts again from a new baseline). */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Verifies a pasted token with auth.test, then stores it in place of the old one. */
  async connect(raw: unknown): Promise<SlackConfig> {
    const token = normalizeSlackToken(raw);
    await this.#load();
    const identity = await this.clientFor(token).authTest();
    const at = new Date(this.#now()).toISOString();
    const config: SlackConfig = { ...identity, token, connectedAt: at };
    await this.#store.write(config);
    this.#config = config;
    this.#state = connectedState(identity, at);
    for (const listener of this.#listeners) listener();
    return config;
  }

  async disconnect(): Promise<void> {
    await this.#load();
    await this.#store.remove();
    this.#config = undefined;
    this.#state = undefined;
    for (const listener of this.#listeners) listener();
  }

  /** Slack refused the stored token (revoked, expired, the app removed), or another call failed with `error`. */
  refused(error: unknown): void {
    if (!this.#config || !(error instanceof SlackApiError)) return;
    const at = new Date(this.#now()).toISOString();
    if (SLACK_AUTH_ERRORS.has(error.code)) this.#state = { status: "revoked", message: SLACK_REVOKED_MESSAGE, checkedAt: at };
    else if (error.code === "missing_scope") this.#state = { status: "missing_scopes", message: error.message, checkedAt: at };
  }

  /** Slack accepted the stored token. */
  accepted(): void {
    if (!this.#config) return;
    if (this.#state?.status === "revoked" || !this.#state) this.#state = connectedState(this.#config, new Date(this.#now()).toISOString());
  }

  /** Whether Slack last refused the token: polling waits for the operator to connect again. */
  get revoked(): boolean {
    return this.#state?.status === "revoked";
  }

  /** The credential-free view; `verify` asks Slack again when the last answer is older than ten minutes. */
  async view(watch: SlackConnection["watch"], options: { verify?: boolean } = {}): Promise<SlackConnection> {
    await this.#load();
    const config = this.#config;
    if (!config) return { configured: false, status: "not_connected", message: "Not connected.", watch };
    const stale = !this.#state?.checkedAt || this.#now() - Date.parse(this.#state.checkedAt) > VERIFY_AFTER_MS;
    if (options.verify && (stale || this.#state?.status === "unverified")) {
      try {
        const identity = await this.clientFor(config.token).authTest();
        this.#state = connectedState({ ...config, ...identity }, new Date(this.#now()).toISOString());
      } catch (error) {
        if (isSlackAuthError(error)) this.#state = { status: "revoked", message: SLACK_REVOKED_MESSAGE, checkedAt: new Date(this.#now()).toISOString() };
        else this.#state = { status: "unverified", message: `${error instanceof Error ? error.message : "Slack could not be reached."} HUI keeps the token and tries again.` };
      }
    }
    const state = this.#state ?? connectedState(config, config.connectedAt);
    const missing = missingSlackScopes(config.scopes);
    return {
      configured: true,
      status: state.status,
      message: state.message,
      user: config.user,
      userId: config.userId,
      team: config.team,
      teamId: config.teamId,
      url: config.url,
      ...(config.scopes ? { scopes: [...config.scopes] } : {}),
      ...(missing.length ? { missingScopes: missing } : {}),
      ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
      watch,
    };
  }
}
