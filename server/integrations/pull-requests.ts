/**
 * Pull requests created by a session.
 *
 * The reference comes from the live runtime transcript: a tool call that ran
 * `gh pr create` (or a dedicated create-pull-request tool) and printed a GitHub
 * pull request URL. Nothing is persisted. GitHub state, title and description
 * come from the shared GitHub previews (`gh api graphql` with the Settings →
 * Integrations → GitHub login), which batch the lookups a listing starts, cached
 * in memory, and refreshed in the background so that listing sessions never
 * waits on the network. Until GitHub answers, a pull request carries only its reference.
 */
import type { PullRequestState, SessionPullRequest } from "../api/github.ts";
import type { TranscriptEntry } from "../runtimes/types.ts";

export type PullRequestRef = Pick<SessionPullRequest, "repository" | "number" | "url">;
export type PullRequestDetails = { state: PullRequestState; title: string; body: string };
export type PullRequestFetcher = (url: string) => Promise<PullRequestDetails>;

const PULL_REQUEST_URL = /https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?!\d)/gu;
const CREATE_COMMAND = /\bgh\s+pr\s+create\b/u;
const CREATE_TOOL = /create[_-]?pull[_-]?request|pull[_-]?request[_-]?create/iu;
const MAX_SCANNED_TEXT = 64 * 1024;
const MAX_SESSION_PULL_REQUESTS = 20;
const MAX_BODY = 4_000;

type ToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;

/** One model message of a stored history, as far as pull-request evidence needs it. */
export type PullRequestMessage = {
  readonly role?: unknown;
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly content?: unknown;
};

/** Tool entries are replaced, not mutated, when their result arrives, so one
 * scan per entry object keeps the three-second sidebar refresh cheap. */
const scanned = new WeakMap<ToolEntry, readonly PullRequestRef[]>();

function commandText(args: unknown): string {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const command = (args as Record<string, unknown>)["command"];
    if (typeof command === "string") return command.slice(0, MAX_SCANNED_TEXT);
  }
  try {
    return (JSON.stringify(args) ?? "").slice(0, MAX_SCANNED_TEXT);
  } catch {
    return "";
  }
}

export function pullRequestUrls(text: string): PullRequestRef[] {
  const found: PullRequestRef[] = [];
  for (const match of text.slice(0, MAX_SCANNED_TEXT).matchAll(PULL_REQUEST_URL)) {
    const repository = `${match[1]}/${match[2]!.replace(/\.git$/u, "")}`;
    const number = Number(match[3]);
    if (!Number.isSafeInteger(number) || number < 1) continue;
    found.push({ repository, number, url: `https://github.com/${repository}/pull/${number}` });
  }
  return found;
}

function createdPullRequests(entry: ToolEntry): readonly PullRequestRef[] {
  const cached = scanned.get(entry);
  if (cached) return cached;
  const creates = CREATE_TOOL.test(entry.name) || CREATE_COMMAND.test(commandText(entry.args));
  // An unfinished call has no output yet; do not memoize its empty result.
  if (creates && entry.output === undefined) return [];
  const refs = creates && entry.output ? pullRequestUrls(entry.output) : [];
  scanned.set(entry, refs);
  return refs;
}

/**
 * Collects the pull requests a stored history created while its entries stream
 * by: a create call and the result that answers it arrive in different entries,
 * so the call is remembered by its ID until its result names a URL. A usage
 * scan reads no transcript, so this keeps only references, bounded like the
 * live scan above.
 */
export class CreatedPullRequestScan {
  readonly #calls = new Set<string>();
  readonly #refs: PullRequestRef[] = [];
  readonly #urls = new Set<string>();

  /** The references found so far, in the order the history first reported them. */
  get refs(): readonly PullRequestRef[] { return this.#refs; }

  /** Feeds one model message and returns the references it added. */
  add(message: PullRequestMessage): readonly PullRequestRef[] {
    if (this.#refs.length >= MAX_SESSION_PULL_REQUESTS) return [];
    if (message.role === "assistant") {
      this.#remember(message.content);
      return [];
    }
    if (message.role !== "toolResult") return [];
    // A resumed scan can start after the call it answers; the tool's own name
    // still identifies a dedicated create tool.
    const named = typeof message.toolName === "string" && CREATE_TOOL.test(message.toolName);
    const id = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    if (!named && !(id && this.#calls.has(id))) return [];
    const text = toolResultText(message.content);
    if (!text) return [];
    const added: PullRequestRef[] = [];
    for (const ref of pullRequestUrls(text)) {
      const key = ref.url.toLowerCase();
      if (this.#urls.has(key) || this.#refs.length >= MAX_SESSION_PULL_REQUESTS) continue;
      this.#urls.add(key);
      this.#refs.push(ref);
      added.push(ref);
    }
    return added;
  }

  #remember(content: unknown): void {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const call = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
      if (call.type !== "toolCall" || typeof call.id !== "string") continue;
      const name = typeof call.name === "string" ? call.name : "";
      if (CREATE_TOOL.test(name) || CREATE_COMMAND.test(commandText(call.arguments))) this.#calls.add(call.id);
      // A dedicated create tool carries no URL of its own; only a result can.
    }
  }
}

/** The readable text of a tool result's content, bounded like a live call's output. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, MAX_SCANNED_TEXT);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let length = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const text = (part as { type?: unknown; text?: unknown }).type === "text" ? (part as { text?: unknown }).text : undefined;
    if (typeof text !== "string") continue;
    const kept = text.slice(0, Math.max(0, MAX_SCANNED_TEXT - length));
    parts.push(kept);
    length += kept.length;
    if (length >= MAX_SCANNED_TEXT) break;
  }
  return parts.join("\n");
}

/** Pull requests in the order the session first reported them. */
export function pullRequestsFromTranscript(entries: readonly TranscriptEntry[]): PullRequestRef[] {
  const seen = new Set<string>();
  const output: PullRequestRef[] = [];
  for (const entry of entries) {
    if (entry.kind !== "tool") continue;
    for (const ref of createdPullRequests(entry)) {
      const key = ref.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(ref);
    }
  }
  return output.slice(-MAX_SESSION_PULL_REQUESTS);
}

/** Description preview: HTML comments (PR templates) removed, bounded. */
export function pullRequestBodyPreview(body: string): string {
  const cleaned = body.replace(/<!--[\s\S]*?(?:-->|$)/gu, "").replace(/\r\n?/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (cleaned.length <= MAX_BODY) return cleaned;
  const cut = cleaned.slice(0, MAX_BODY);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return `${cut.slice(0, boundary > MAX_BODY * 0.6 ? boundary : MAX_BODY).trimEnd()}…`;
}

type CacheEntry = { details?: PullRequestDetails; freshUntil: number; refreshing: boolean };

export type PullRequestStatusOptions = {
  now?: () => number;
  /** Open and draft pull requests change often. */
  activeTtlMs?: number;
  /** Merged is final; closed can be reopened but rarely is. */
  settledTtlMs?: number;
  /** A failed lookup (signed out, no access, offline) is retried slowly. */
  failureTtlMs?: number;
  maxEntries?: number;
};

/** Stale-while-revalidate GitHub facts. `view` never waits for the network. */
export class PullRequestStatuses {
  readonly #fetch: PullRequestFetcher;
  readonly #now: () => number;
  readonly #activeTtl: number;
  readonly #settledTtl: number;
  readonly #failureTtl: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CacheEntry>();
  #running = 0;
  #idle: (() => void)[] = [];

  constructor(fetch: PullRequestFetcher, options: PullRequestStatusOptions = {}) {
    this.#fetch = fetch;
    this.#now = options.now ?? Date.now;
    this.#activeTtl = options.activeTtlMs ?? 60_000;
    this.#settledTtl = options.settledTtlMs ?? 15 * 60_000;
    this.#failureTtl = options.failureTtlMs ?? 5 * 60_000;
    this.#maxEntries = Math.max(1, options.maxEntries ?? 500);
  }

  view(ref: PullRequestRef): SessionPullRequest {
    const key = ref.url.toLowerCase();
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { freshUntil: 0, refreshing: false };
      this.#entries.set(key, entry);
      this.#evict();
    }
    if (!entry.refreshing && entry.freshUntil <= this.#now()) {
      entry.refreshing = true;
      this.#running += 1;
      void this.#refresh(ref.url).finally(() => {
        this.#running -= 1;
        if (this.#running === 0) for (const resolve of this.#idle.splice(0)) resolve();
      });
    }
    return entry.details ? { ...ref, ...entry.details } : { ...ref };
  }

  /** Resolves once no lookup is running. Test and shutdown helper. */
  whenIdle(): Promise<void> {
    if (this.#running === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  #evict(): void {
    for (const [key, entry] of this.#entries) {
      if (this.#entries.size <= this.#maxEntries) return;
      if (!entry.refreshing) this.#entries.delete(key);
    }
  }

  async #refresh(url: string): Promise<void> {
    const key = url.toLowerCase();
    try {
      const details = await this.#fetch(url);
      const entry = this.#entries.get(key);
      if (!entry) return;
      entry.details = details;
      entry.freshUntil = this.#now() + (details.state === "open" || details.state === "draft" ? this.#activeTtl : this.#settledTtl);
      entry.refreshing = false;
    } catch {
      // Keep the last confirmed facts; never invent a state for a failure.
      const entry = this.#entries.get(key);
      if (!entry) return;
      entry.freshUntil = this.#now() + this.#failureTtl;
      entry.refreshing = false;
    }
  }
}
