/**
 * HUI's managed browser: one Chromium-family process with its own profile,
 * launched lazily by the agent `browser` tool and driven over a CDP pipe.
 *
 * Headless by default, so it never opens a window, takes focus or touches the
 * operator's own browser, cookies or tabs. Tabs belong to the conversation
 * that opened them, like shared terminals: a conversation can neither list
 * nor drive another conversation's tabs. With a mirror (`state.ts`), it seeds a
 * launching profile from another machine's cookies and per-origin storage and
 * hands back what it captured, so a login made once works on both.
 *
 * A `handoff` gives one tab to the operator: the agent waits, the live view
 * forwards their pointer and keys to that tab over the same CDP session, and
 * the call returns a fresh snapshot once they continue.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";

import type { BrowserStatus, BrowserViewAction, BrowserViewControl, BrowserViewState } from "../api/browser.ts";
import type { BrowserSettings } from "../hui-settings.ts";
import { CdpConnection, CdpError, type CdpEvent } from "./cdp.ts";
import { defaultExecutableProbe, resolveBrowserExecutable, type BrowserExecutable, type ExecutableProbe } from "./executable.ts";
import { KeyParseError, parseKey, type KeyStroke } from "./keys.ts";
import { allowsUrl, blockedOriginMessage } from "./origins.ts";
import { clampSnapshotChars, renderSnapshot, SnapshotRefs, type AxNode, type SnapshotOptions, type SnapshotResult, type SnapshotTarget } from "./snapshot.ts";
import { EMPTY_BROWSER_STATE, isHttpOrigin, mergeBrowserState, STATE_CAPTURE, STATE_SEED, trimBrowserState, type BrowserState, type StoredCookie, type StoredDatabase, type StoredOrigin } from "./state.ts";

export class BrowserToolError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type BrowserToolResult = {
  /** Model-facing text: snapshots and page text stay readable, not JSON-escaped. */
  text: string;
  /** Small, browser-safe structured result persisted with the tool call. */
  details: Record<string, unknown>;
  image?: { data: string; mimeType: string };
};

/** One screencast frame of a tab, shared by everyone watching it. */
export type BrowserViewFrame = { tabId: string; width: number; height: number; seq: number; image: Buffer };

export type BrowserViewListener = {
  state(state: BrowserViewState): void;
  frame(frame: BrowserViewFrame): void;
  action(action: BrowserViewAction): void;
};

export type BrowserViewHandle = {
  /** Watch one of the conversation's tabs; null (or the agent's current tab) follows the agent. */
  select(tabId: string | null): void;
  close(): void;
};

export const BROWSER_ACTIONS = [
  "status", "tabs", "open", "navigate", "back", "forward", "reload", "focus", "close",
  "snapshot", "act", "text", "screenshot", "console", "resize", "handoff",
] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];
export const BROWSER_ACT_KINDS = ["click", "type", "press", "hover", "select", "scroll", "wait"] as const;
export type BrowserActKind = (typeof BROWSER_ACT_KINDS)[number];

export const MAX_TABS_PER_CONVERSATION = 8;
export const MAX_TABS_TOTAL = 32;
/** A capture reads the whole cookie jar and a tab's storage: at most this often per origin. */
const CAPTURE_INTERVAL_MS = 5_000;
/** A mirror captures what its tabs hold this often while it runs: a page signs in after a fetch, not on load. */
const MIRROR_CAPTURE_MS = 20_000;
const DEFAULT_WINDOW = { width: 1280, height: 800 } as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
/** A conversation's tabs close after this long without a browser call from it. */
const IDLE_TAB_MS = 10 * 60_000;
/** How long an agent waits for the operator: ten minutes, up to half an hour. */
const DEFAULT_HANDOFF_MS = 10 * 60_000;
const MAX_HANDOFF_MS = 30 * 60_000;
const MIN_HANDOFF_MS = 5_000;
/** A click that navigates starts doing so within a few frames. */
const NAVIGATION_START_MS = 300;
const CONSOLE_LIMIT = 200;
const TEXT_DEFAULT_CHARS = 12_000;
const TEXT_MAX_CHARS = 40_000;
const PAGE_SNAPSHOT_CHARS = 8_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FULL_PAGE = { width: 4_096, height: 8_192 } as const;
const OBJECT_GROUP = "hui-browser-tool";
/** Chromium sends the next screencast frame only after the previous one is
 * acknowledged; delaying the ack caps a busy page at about ten frames a second. */
const FRAME_INTERVAL_MS = 100;
const SCREENCAST = { format: "jpeg", quality: 70, maxWidth: 1600, maxHeight: 1600, everyNthFrame: 1 } as const;
/** A tab that is not its window's active page yet refuses a screencast with
 * "Not attached to an active page", and accepts the same request moments later. */
const SCREENCAST_START_MS = 5_000;
const SCREENCAST_RETRY_MS = 100;
const TRUNCATED_NOTE = "[Snapshot truncated. Use snapshot with query, interactive: true or a larger maxChars to see more.]";

type ConsoleEntry = { level: string; text: string };

type Tab = {
  id: string;
  targetId: string;
  session: string;
  frameId: string;
  owner: string;
  title: string;
  url: string;
  refs: SnapshotRefs;
  loaderId: string;
  /** Recent documents that reached their load event. */
  loaded: string[];
  console: ConsoleEntry[];
  dialogs: string[];
  dialogPolicy: "accept" | "dismiss" | undefined;
  crashed: boolean;
  openedAt: number;
  /** Latest screencast frame, so a new viewer sees the page immediately. */
  frame?: BrowserViewFrame;
  /** A page that tried to leave the allowed origins, reported once. */
  blocked?: string;
};

type Viewer = { owner: string; listener: BrowserViewListener; pinned: string | null; watching: string | null; closed: boolean };
type Screencast = { viewers: number; ackedAt: number; timers: Set<ReturnType<typeof setTimeout>> };

/** One tab waiting for its operator. `resolve` settles the agent's call. */
type Handoff = {
  tabId: string;
  message: string;
  since: string;
  resolve: (outcome: HandoffOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The mouse button the operator is holding down, for the moves between press and release. */
  button?: "left" | "right";
};
/** `continued`: the operator finished. `timeout`: nobody came. `closed`: the tab went away under them.
 * `stopped`: the browser did. */
export type HandoffOutcome = "continued" | "timeout" | "closed" | "stopped";

type Instance = {
  child: ChildProcess;
  connection: CdpConnection;
  headless: boolean;
  /** Raw configured path, compared with settings to detect a needed restart. */
  configuredPath: string;
  executable: BrowserExecutable;
  version: string;
  startedAt: string;
  /** The blank page Chromium opens at launch; closed once an agent tab exists. */
  startup: Set<string>;
  startupCleaned: boolean;
  /** This profile's state, as it was seeded and as it has been captured since. */
  state: BrowserState;
  /** Origins whose stored state has been written into this profile. */
  seeded: Set<string>;
  /** When each origin's storage, and the cookie jar, were last captured. */
  capturedAt: Map<string, number>;
};

type NavigationOutcome = { navigated: boolean; loaded: boolean; sameDocument: boolean };

/** Where a browser's state goes and comes from when Settings → Tools → Browser mirrors it; absent, that browser
 * keeps its own state to itself. */
export type BrowserStateMirror = {
  /** What this browser seeds a new profile with, read before its first page. */
  read: () => Promise<BrowserState>;
  /** What this browser holds now, merged by the store. */
  write: (state: BrowserState) => void;
};

export type ManagedBrowserOptions = {
  profileDir: string;
  readSettings: () => Promise<BrowserSettings>;
  mirror?: BrowserStateMirror;
  probe?: ExecutableProbe;
  env?: NodeJS.ProcessEnv;
  window?: { width: number; height: number };
  idleTabMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clip(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function browserLaunchArguments(options: {
  profileDir: string;
  headless: boolean;
  width: number;
  height: number;
  noSandbox?: boolean;
}): string[] {
  return [
    // CDP over fds 3/4: no TCP port, and the browser exits when HUI's end closes.
    "--remote-debugging-pipe",
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--disable-features=Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider,AutofillServerCommunication",
    // Never block on the macOS Keychain or a Linux keyring unlock prompt.
    "--password-store=basic",
    "--use-mock-keychain",
    `--window-size=${options.width},${options.height}`,
    ...(options.headless ? ["--headless=new", "--mute-audio"] : []),
    ...(options.noSandbox ? ["--no-sandbox"] : []),
    "about:blank",
  ];
}

const HOST_AND_PORT = /^(?:localhost|\[[0-9a-f:]+\]|\d{1,3}(?:\.\d{1,3}){3}|[\w.-]+):\d{1,5}(?:[/?#]|$)/iu;
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/iu;

/** Bare hosts get https, except loopback and host:port forms, which are
 * almost always local development servers. */
export function normalizeBrowserUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new BrowserToolError("url must be a non-empty string.");
  const text = raw.trim();
  if (text.length > 8_192) throw new BrowserToolError("url must be at most 8192 characters.");
  if (text === "about:blank") return text;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/iu.test(text) && !HOST_AND_PORT.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `${LOOPBACK.test(text) || HOST_AND_PORT.test(text) ? "http" : "https"}://${text}`);
  } catch {
    throw new BrowserToolError(`${clip(text, 200)} is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") {
    throw new BrowserToolError(`Only http, https, file and about:blank URLs can be opened, not ${url.protocol}`);
  }
  return url.href;
}

/** The configuration a failure belongs to; a later change makes it stale. */
type LaunchSettings = Pick<BrowserSettings, "enabled" | "headless" | "executablePath">;

function settingsKey(settings: LaunchSettings): string {
  return JSON.stringify([settings.enabled, settings.headless, settings.executablePath]);
}

function timeoutFrom(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1_000 || value > MAX_TIMEOUT_MS) {
    throw new BrowserToolError(`timeoutMs must be an integer from 1000 to ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function optionalText(params: Record<string, unknown>, key: string, maximum: number): string | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new BrowserToolError(`${key} must be a non-empty string of at most ${maximum} characters.`);
  }
  return value;
}

function requiredText(params: Record<string, unknown>, key: string, maximum: number): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new BrowserToolError(`${key} must be non-empty text of at most ${maximum} characters.`);
  }
  return value.trim();
}

/** `handoff` waits for a person, so it takes a longer, separately bounded timeout. */
function handoffTimeoutFrom(value: unknown): number {
  if (value === undefined) return DEFAULT_HANDOFF_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_HANDOFF_MS || value > MAX_HANDOFF_MS) {
    throw new BrowserToolError(`timeoutMs must be an integer from ${MIN_HANDOFF_MS} to ${MAX_HANDOFF_MS}.`);
  }
  return value;
}

function browserEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !key.startsWith("HUI_AGENT_")));
}

function startupFailure(name: string, code: number | null, signal: NodeJS.Signals | null, stderr: string): string {
  const reason = code !== null ? `code ${code}` : signal ?? "no exit status";
  const inUse = /ProcessSingleton|SingletonLock|profile.*in use/iu.test(stderr)
    ? " Its HUI profile is in use by another browser process."
    : "";
  const last = stderr.trim().split("\n").filter(Boolean).at(-1);
  return `${name} exited while starting (${reason}).${inUse}${last ? ` Last output: ${clip(last.trim(), 300)}` : ""}`;
}

function consoleText(args: unknown): string {
  if (!Array.isArray(args)) return "";
  return args.filter(isRecord).map((arg) => {
    const value = arg["value"];
    if (typeof value === "string") return value;
    if (value !== undefined) return JSON.stringify(value);
    return str(arg["description"]) || str(arg["unserializableValue"]) || str(arg["type"]);
  }).join(" ");
}

function exceptionText(details: unknown): string {
  if (!isRecord(details)) return "unknown error";
  const exception = isRecord(details["exception"]) ? details["exception"] : {};
  return clip((str(exception["description"]) || str(details["text"]) || "unknown error").split("\n")[0] ?? "unknown error", 300);
}

function polygonArea(quad: readonly number[]): number {
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    area += (quad[index * 2] ?? 0) * (quad[next * 2 + 1] ?? 0) - (quad[next * 2] ?? 0) * (quad[index * 2 + 1] ?? 0);
  }
  return Math.abs(area) / 2;
}

function describeTarget(ref: string, target: SnapshotTarget): string {
  return `${ref} (${target.role}${target.name ? ` ${JSON.stringify(clip(target.name, 80))}` : ""})`;
}

function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  return bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : undefined;
}

function screenshotPath(cwd: string, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4_096 || /[\p{Cc}]/u.test(raw)) {
    throw new BrowserToolError("path must be a file path ending in .png.");
  }
  const path = isAbsolute(raw) ? raw : resolve(cwd, raw);
  if (extname(path).toLowerCase() !== ".png") throw new BrowserToolError("path must end in .png.");
  return path;
}

/** The cookie jar as the mirror carries it, dropping what only describes this machine. */
function capturedCookies(cookies: Record<string, unknown>[], at: number): StoredCookie[] {
  const sameSite = (value: unknown): StoredCookie["sameSite"] => value === "Strict" || value === "Lax" || value === "None" ? value : undefined;
  return cookies.map((cookie) => ({
    name: str(cookie["name"]), value: str(cookie["value"]), domain: str(cookie["domain"]), path: str(cookie["path"]) || "/",
    ...(num(cookie["expires"]) >= 0 ? { expires: num(cookie["expires"]) } : {}),
    ...(cookie["httpOnly"] === true ? { httpOnly: true } : {}),
    ...(cookie["secure"] === true ? { secure: true } : {}),
    ...(sameSite(cookie["sameSite"]) ? { sameSite: sameSite(cookie["sameSite"]) } : {}),
    at,
  }));
}

/** One origin's localStorage and IndexedDB as STATE_CAPTURE returned them. */
function capturedOrigin(origin: string, at: number, value: Record<string, unknown>): StoredOrigin {
  const strings = (item: unknown) => Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];
  const indexedDB: StoredDatabase[] = (Array.isArray(value["indexedDB"]) ? value["indexedDB"] : []).filter(isRecord).flatMap((database) => {
    if (typeof database["name"] !== "string") return [];
    const stores = (Array.isArray(database["stores"]) ? database["stores"] : []).filter(isRecord).flatMap((store) => typeof store["name"] !== "string" ? [] : [{
      name: store["name"],
      records: (Array.isArray(store["records"]) ? store["records"] : []).filter(isRecord).flatMap((record) =>
        typeof record["key"] === "string" && typeof record["value"] === "string" ? [{ key: record["key"], value: record["value"], at }] : []),
    }]);
    return [{ name: database["name"], version: num(database["version"]), stores }];
  });
  return {
    origin, at, indexedDB, skipped: strings(value["skipped"]).slice(0, 20),
    localStorage: (Array.isArray(value["localStorage"]) ? value["localStorage"] : []).flatMap((entry) =>
      Array.isArray(entry) && typeof entry[0] === "string" ? [{ key: entry[0], value: typeof entry[1] === "string" ? entry[1] : null, at }] : []),
  };
}

const CONTAINS_HIT = String.raw`function (other, x, y) {
  // Some Chromium builds resolve the hit pseudo-element to such an object itself (its tagName is "::after", its parent
  // element beside it) instead of a { type, element } pair: same thing, named the way the branch below reads it.
  if (other && typeof other.type !== "string" && typeof other.tagName === "string" && other.tagName.startsWith("::") && other.parentElement instanceof Element) {
    other = { type: other.tagName, element: other.parentElement };
  }
  if (other && typeof other.type === "string" && other.element instanceof Element) {
    // Chromium's hit test reports the CSS pseudo-element it finds (for example a
    // decorative ::after overlay), and ignorePointerEventsNone does not filter
    // those. A pseudo-element never receives the pointer event itself: its
    // originating element does, unless the pseudo is transparent to the pointer,
    // and then the click reaches whatever is below it at the click point.
    let style;
    try { style = getComputedStyle(other.element, other.type); } catch { /* Unknown pseudo type; treat it as painted opaquely. */ }
    if (style && style.pointerEvents === "none") {
      const view = other.element.ownerDocument.defaultView;
      other = window === window.top && view && view === view.top ? other.element.ownerDocument.elementFromPoint(x, y) : null;
      if (!other) return { contains: true };
    } else {
      other = other.element;
    }
  }
  for (let node = other; node; node = node instanceof ShadowRoot ? node.host : node.parentNode) {
    if (node === this) return { contains: true };
  }
  if (other instanceof HTMLLabelElement && other.control === this) return { contains: true };
  const element = other instanceof Element ? other : other && other.parentElement;
  if (!element) return { contains: false, cover: "another element" };
  const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  return { contains: false, cover: element.tagName.toLowerCase() + (element.id ? "#" + element.id : "") + classes.map((name) => "." + name).join("") };
}`;

const PREPARE_TYPING = String.raw`function (append) {
  let element = this;
  if (element instanceof HTMLLabelElement && element.control) element = element.control;
  const textTypes = ["text", "search", "email", "url", "tel", "password", "number"];
  const field = element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && textTypes.includes(element.type));
  if (!field && !element.isContentEditable) return "not-editable";
  if (element.disabled || element.readOnly) return "read-only";
  element.focus();
  if (field) {
    try {
      if (append) element.setSelectionRange(element.value.length, element.value.length);
      else element.select();
    } catch {
      if (!append) {
        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  } else {
    const range = document.createRange();
    range.selectNodeContents(element);
    if (append) range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return "ready";
}`;

const SELECT_OPTIONS = String.raw`function (values) {
  if (!(this instanceof HTMLSelectElement)) return { error: "not-select" };
  const wanted = new Set(values);
  let matched = 0;
  for (const option of this.options) {
    const hit = wanted.has(option.value) || wanted.has(option.label) || wanted.has(option.textContent.trim());
    option.selected = hit && (this.multiple || matched === 0);
    if (hit) matched += 1;
  }
  if (matched === 0) return { error: "no-match", options: Array.from(this.options).slice(0, 20).map((option) => option.label || option.value) };
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { selected: Array.from(this.selectedOptions).map((option) => option.label || option.value) };
}`;

export class ManagedBrowser {
  readonly #profileDir: string;
  readonly #readSettings: () => Promise<BrowserSettings>;
  readonly #probe: ExecutableProbe;
  readonly #env: NodeJS.ProcessEnv;
  readonly #window: { width: number; height: number };
  readonly #idleTabMs: number;
  readonly #mirror: BrowserStateMirror | undefined;
  #mirrorTimer: ReturnType<typeof setInterval> | undefined;
  #instance: Instance | undefined;
  #starting: Promise<Instance> | undefined;
  #stopping: Promise<void> | undefined;
  /** Bumped by stop/dispose so a launch that finishes afterwards is discarded. */
  #generation = 0;
  #lastError = "";
  #lastErrorKey = "";
  readonly #tabs = new Map<string, Tab>();
  readonly #byTarget = new Map<string, Tab>();
  readonly #bySession = new Map<string, Tab>();
  readonly #current = new Map<string, string>();
  #nextTab = 0;
  /** Tool calls still running; the browser never stops under one. */
  #calls = 0;
  /** Bumped when a conversation's tabs are closed, so a call already in
   * flight (an interrupted open) cannot leave a new tab behind. Never
   * deleted: restarting at 0 would let such a call through. */
  readonly #epochs = new Map<string, number>();
  readonly #idle = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #viewers = new Set<Viewer>();
  /** Each conversation's tab waiting for its operator; the agent's call waits with it. */
  readonly #handoffs = new Map<string, Handoff>();
  /** Settings → Tools → Browser's origin allowlist, refreshed by every call; empty is anywhere. */
  #origins: readonly string[] = [];
  /** Each conversation's latest agent action, for viewers that join later. */
  readonly #lastActions = new Map<string, BrowserViewAction>();
  readonly #casts = new Map<string, Screencast>();
  #frameSeq = 0;
  readonly #changedOwners = new Set<string>();
  #changedAll = false;
  #changeQueued = false;

  constructor(options: ManagedBrowserOptions) {
    this.#profileDir = options.profileDir;
    this.#readSettings = options.readSettings;
    this.#probe = options.probe ?? defaultExecutableProbe();
    this.#env = options.env ?? process.env;
    this.#window = options.window ?? { ...DEFAULT_WINDOW };
    this.#idleTabMs = options.idleTabMs ?? IDLE_TAB_MS;
    this.#mirror = options.mirror;
  }

  get running(): boolean {
    return this.#instance !== undefined;
  }

  get activeTabs(): number {
    return this.#tabs.size;
  }

  /** Tabs currently streaming frames to at least one viewer. */
  get activeScreencasts(): number {
    return this.#casts.size;
  }

  /** Live view of one conversation's tabs: state now and on every change, the
   * watched tab's frames while it repaints, and each agent action. Viewing never
   * launches the browser or changes what the agent is doing. */
  watch(owner: string, listener: BrowserViewListener): BrowserViewHandle {
    const viewer: Viewer = { owner, listener, pinned: null, watching: null, closed: false };
    this.#viewers.add(viewer);
    // A late viewer (a reload, a preview scrolled back into view) still learns
    // what the agent did last, before the page: a snapshot viewer leaves on
    // its first frame. Without its point: the click is not happening now.
    this.#syncViewer(viewer, this.#lastActions.get(owner));
    return {
      select: (tabId) => {
        if (viewer.closed) return;
        viewer.pinned = typeof tabId === "string" && this.#tabs.get(tabId)?.owner === owner ? tabId : null;
        this.#syncViewer(viewer);
      },
      close: () => {
        if (viewer.closed) return;
        viewer.closed = true;
        this.#viewers.delete(viewer);
        this.#setWatching(viewer, null);
      },
    };
  }

  /** Operator input for a tab the agent handed over. Anything outside that tab's pending handoff is
   * ignored: viewing never gives a conversation control over the browser. */
  operator(owner: string, control: BrowserViewControl): void {
    if (control.action === "select") return;
    const handoff = this.#handoffs.get(owner);
    const instance = this.#instance;
    if (!handoff || !instance || instance.connection.closed) return;
    if (control.tabId !== handoff.tabId) return;
    const tab = this.#tabs.get(handoff.tabId);
    if (!tab || tab.owner !== owner) return;
    if (control.action === "continue") { this.#settleHandoff(owner, "continued"); return; }
    if (control.action === "key") { void this.#operatorKey(instance, tab, control.key); return; }
    if (control.action === "wheel") {
      void instance.connection.send("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: control.x, y: control.y, deltaX: control.deltaX, deltaY: control.deltaY,
      }, tab.session, 5_000).catch(() => undefined);
      return;
    }
    const held = control.kind === "down" ? control.button : control.kind === "up" ? undefined : handoff.button;
    if (control.kind === "down") handoff.button = control.button;
    else if (control.kind === "up") handoff.button = undefined;
    void instance.connection.send("Input.dispatchMouseEvent", {
      type: control.kind === "down" ? "mousePressed" : control.kind === "up" ? "mouseReleased" : "mouseMoved",
      x: control.x, y: control.y, button: held ?? "none", buttons: held === "left" ? 1 : held === "right" ? 2 : 0, clickCount: 1,
    }, tab.session, 5_000).catch(() => undefined);
  }

  async status(ownerTitle: (sessionId: string) => string = () => ""): Promise<BrowserStatus> {
    const settings = await this.#readSettings();
    const resolution = await resolveBrowserExecutable(settings.executablePath, this.#probe);
    const instance = this.#instance;
    if (instance) await this.#refreshAll(instance);
    return {
      enabled: settings.enabled,
      headless: settings.headless,
      executablePath: settings.executablePath,
      executable: resolution.executable
        ? { path: resolution.executable.path, name: resolution.executable.name, source: resolution.executable.source }
        : null,
      executableError: resolution.error ?? "",
      state: this.#stopping ? "stopping" : this.#starting ? "starting" : instance ? "running" : "stopped",
      ...(instance ? { mode: instance.headless ? "headless" as const : "windowed" as const, version: instance.version, startedAt: instance.startedAt } : {}),
      profileDir: this.#profileDir,
      lastError: this.#lastError,
      tabs: [...this.#tabs.values()].sort((a, b) => a.openedAt - b.openedAt).map((tab) => ({
        id: tab.id,
        ownerSessionId: tab.owner,
        ownerTitle: ownerTitle(tab.owner),
        title: clip(tab.title, 300),
        url: clip(tab.url, 2_048),
      })),
    };
  }

  /** Operator-initiated launch from Settings, using the saved configuration. */
  async start(): Promise<void> {
    const settings = await this.#readSettings();
    if (!settings.enabled) throw new BrowserToolError("Turn on the browser tool before starting the managed browser.", 409);
    await this.#ensure(settings);
  }

  async stop(): Promise<void> {
    this.#generation += 1;
    if (this.#starting) await this.#starting.catch(() => undefined);
    const instance = this.#instance;
    if (!instance) return;
    if (!this.#stopping) {
      this.#stopping = this.#shutdown(instance).finally(() => {
        this.#stopping = undefined;
      });
    }
    await this.#stopping;
  }

  /** A saved mode or executable applies to the next launch; a running browser
   * with the old configuration is closed now instead of lingering. */
  async applySettings(next: BrowserSettings): Promise<void> {
    if (this.#lastError && settingsKey(next) !== this.#lastErrorKey) this.#lastError = "";
    const instance = this.#instance;
    if (!instance) return;
    if (!next.enabled || instance.headless !== next.headless || instance.configuredPath !== next.executablePath) await this.stop();
  }

  /** Tabs belong to a conversation; removing it, stopping its turn or leaving
   * the browser unused closes them. */
  closeOwner(owner: string): void {
    this.#epochs.set(owner, this.#epoch(owner) + 1);
    this.#settleHandoff(owner, "closed");
    clearTimeout(this.#idle.get(owner));
    this.#idle.delete(owner);
    const instance = this.#instance;
    for (const tab of this.#ownerTabs(owner)) {
      this.#drop(tab.targetId);
      if (instance) void instance.connection.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => undefined);
    }
    this.#current.delete(owner);
    this.#lastActions.delete(owner);
  }

  /** Gateway shutdown: the pipe closing already makes Chromium exit; the
   * signal makes it prompt even if the event loop is about to end. */
  dispose(): void {
    this.#generation += 1;
    this.#stopMirrorClock();
    const instance = this.#instance;
    this.#instance = undefined;
    this.#forgetTabs();
    this.#changed();
    if (!instance) return;
    instance.connection.close("The HUI gateway stopped.");
    instance.child.kill("SIGTERM");
  }

  /** Operator preview for Settings. Never changes tab focus. */
  async preview(tabId: string): Promise<{ mimeType: string; data: string }> {
    const tab = this.#tabs.get(tabId);
    const instance = this.#instance;
    if (!tab || !instance) throw new BrowserToolError("That tab is no longer open.", 404);
    try {
      const result = await instance.connection.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }, tab.session, 10_000);
      const data = str(result["data"]);
      if (!data) throw new Error("empty capture");
      return { mimeType: "image/jpeg", data };
    } catch {
      throw new BrowserToolError(instance.headless
        ? "The tab could not be captured."
        : "A background tab in a visible browser window cannot be captured without switching to it.", 409);
    }
  }

  async tool(owner: string, params: Record<string, unknown>, context: { cwd: string }): Promise<BrowserToolResult> {
    const action = params["action"];
    if (typeof action !== "string" || !(BROWSER_ACTIONS as readonly string[]).includes(action)) {
      throw new BrowserToolError(`action must be one of: ${BROWSER_ACTIONS.join(", ")}.`);
    }
    const epoch = this.#epoch(owner);
    clearTimeout(this.#idle.get(owner));
    this.#idle.delete(owner);
    this.#calls += 1;
    try {
      const settings = await this.#readSettings();
      if (!settings.enabled) throw new BrowserToolError("The browser tool is turned off in HUI Settings → Tools → Browser.", 409);
      this.#origins = settings.allowedOrigins;
      const name = action as BrowserAction;
      let result: BrowserToolResult;
      try {
        result = await this.#run(owner, name, params, settings, context, epoch);
      } catch (error) {
        // A browser killed under a live-looking instance closes the pipe
        // mid-call; name the exit the agent can recover from, not the pipe.
        if (error instanceof CdpError && (!this.#instance || this.#instance.connection.closed)) {
          throw new BrowserToolError("The managed browser exited. Call open to start it again.", 409);
        }
        throw error;
      }
      this.#narrate(owner, name, params, result);
      return result;
    } finally {
      this.#calls -= 1;
      if (this.#ownerTabs(owner).length) {
        const timer = setTimeout(() => this.closeOwner(owner), this.#idleTabMs);
        timer.unref();
        this.#idle.set(owner, timer);
      }
      this.#stopIfUnused();
    }
  }

  #epoch(owner: string): number {
    return this.#epochs.get(owner) ?? 0;
  }

  /** Chromium runs for agent tabs: once none is open and no call is running,
   * it stops and the next open launches it again. */
  #stopIfUnused(): void {
    if (this.#instance && !this.#tabs.size && !this.#calls) void this.stop();
  }

  async #run(
    owner: string,
    action: BrowserAction,
    params: Record<string, unknown>,
    settings: BrowserSettings,
    context: { cwd: string },
    epoch: number,
  ): Promise<BrowserToolResult> {
    const name = action;
    // A tab the operator is working in is theirs until they continue.
    if (name !== "status" && name !== "tabs" && name !== "handoff" && this.#handoffs.has(owner)) {
      const waiting = this.#handoffs.get(owner)!;
      throw new BrowserToolError(`The operator has taken over ${waiting.tabId}. Call handoff to wait for them, or stop and tell the user.`, 409);
    }
    switch (name) {
      case "status": return this.#statusResult(owner, settings);
      case "tabs": return this.#tabsResult(owner);
      case "open": return this.#open(owner, params, settings, epoch);
      case "navigate": {
        const tab = this.#tabFor(owner, params["tabId"]);
        const instance = this.#live();
        const url = normalizeBrowserUrl(params["url"]);
        this.#assertAllowed(url);
        const outcome = await this.#navigate(instance, tab, url, timeoutFrom(params["timeoutMs"]));
        return this.#pageResult(instance, tab, "navigate", `Navigated tab ${tab.id}.`, outcome, params);
      }
      case "back":
      case "forward":
      case "reload": return this.#history(owner, name, params);
      case "focus": {
        const tab = this.#tabFor(owner, params["tabId"] ?? "");
        const instance = this.#live();
        // Headless tabs sharing a window (a popup and its opener) hide each other.
        await this.#ensureVisible(instance, tab);
        await this.#refreshInfo(instance, tab);
        return { text: `Tab ${tab.id} is now current.\n${this.#header(tab)}`, details: { action, tab: this.#tabDetails(tab) } };
      }
      case "close": return this.#close(owner, params);
      case "snapshot": {
        const tab = this.#tabFor(owner, params["tabId"]);
        const instance = this.#live();
        const query = optionalText(params, "query", 200);
        const snapshot = await this.#snapshot(instance, tab, {
          interactive: params["interactive"] === true,
          maxChars: clampSnapshotChars(params["maxChars"]),
          ...(query ? { query } : {}),
        });
        const lines = [this.#header(tab)];
        if (snapshot.matched !== undefined) lines.push(`${snapshot.matched} matching line${snapshot.matched === 1 ? "" : "s"} for "${query}".`);
        lines.push("", snapshot.text || "(No accessible content matched.)");
        if (snapshot.truncated) lines.push(TRUNCATED_NOTE);
        return { text: lines.join("\n"), details: { action, tab: this.#tabDetails(tab), lines: snapshot.lines, truncated: snapshot.truncated } };
      }
      case "act": return this.#act(owner, params);
      case "text": return this.#text(owner, params);
      case "screenshot": return this.#screenshot(owner, params, context.cwd);
      case "console": return this.#console(owner, params);
      case "resize": return this.#resize(owner, params);
      case "handoff": return this.#handoff(owner, params);
    }
  }

  // ── Operator handoff ──────────────────────────────────────────────────────

  /** Give one tab to the operator and wait for them. The live view forwards their input to that tab only;
   * the call returns what the page looks like once they continue, or why they did not. */
  async #handoff(owner: string, params: Record<string, unknown>): Promise<BrowserToolResult> {
    const tab = this.#tabFor(owner, params["tabId"]);
    this.#live();
    const message = requiredText(params, "message", 500);
    const timeoutMs = handoffTimeoutFrom(params["timeoutMs"]);
    if (this.#handoffs.has(owner)) throw new BrowserToolError("A handoff is already waiting in this conversation.", 409);
    const since = new Date().toISOString();
    // Whoever was watching follows the agent, which is now this tab; an explicit pin is theirs to keep.
    for (const viewer of this.#viewers) if (viewer.owner === owner) viewer.pinned = null;
    const outcome = await new Promise<HandoffOutcome>((resolve) => {
      const handoff: Handoff = {
        tabId: tab.id, message, since, resolve,
        timer: setTimeout(() => this.#settleHandoff(owner, "timeout"), timeoutMs),
      };
      handoff.timer.unref();
      this.#handoffs.set(owner, handoff);
      this.#emitAction(tab, `Waiting for you in tab ${tab.id}: ${message}`);
      this.#changed(owner);
    });
    const waited = timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} minute${Math.round(timeoutMs / 60_000) === 1 ? "" : "s"}` : `${Math.round(timeoutMs / 1_000)} seconds`;
    let lines: string[];
    const live = this.#instance;
    const current = this.#tabs.get(tab.id);
    if (outcome === "continued" && live && !live.connection.closed && current?.owner === owner) {
      await this.#refreshInfo(live, current);
      const snapshot = await this.#snapshot(live, current, { maxChars: PAGE_SNAPSHOT_CHARS });
      const blocked = this.#blockedLine(current);
      lines = [
        `The operator finished in tab ${current.id}.`,
        this.#header(current),
        ...(blocked ? [blocked] : []),
        "",
        snapshot.text || "(No accessible content matched.)",
        ...(snapshot.truncated ? [TRUNCATED_NOTE] : []),
        "",
        "The snapshot above is current: act on its refs.",
      ];
    } else if (outcome === "timeout") {
      lines = [`The operator did not take over tab ${tab.id} within ${waited}; they may be away. The tab is back in your control. Ask them in chat with ask_user_question, or stop and report what needs a person.`];
    } else if (outcome === "continued") {
      lines = [`The operator continued, but tab ${tab.id} or the browser is gone now. Call open to start again.`];
    } else if (outcome === "closed") {
      lines = [`Tab ${tab.id} closed while the operator had it. Open a new tab to continue.`];
    } else {
      lines = [`The managed browser stopped while the operator had tab ${tab.id}. Call open to start it again.`];
    }
    return { text: lines.join("\n"), details: { action: "handoff", tab: this.#tabDetails(tab), outcome } };
  }

  /** Ends the wait exactly once: the call, the timer and a closing tab all take this path. */
  #settleHandoff(owner: string, outcome: HandoffOutcome): void {
    const handoff = this.#handoffs.get(owner);
    if (!handoff) return;
    clearTimeout(handoff.timer);
    this.#handoffs.delete(owner);
    handoff.resolve(outcome);
    // The view's activity line stops claiming the tab is waiting, and a late
    // viewer replays how the wait ended rather than the wait itself.
    const tab = this.#tabs.get(handoff.tabId);
    if (tab && tab.owner === owner && (outcome === "continued" || outcome === "timeout")) {
      this.#emitAction(tab, outcome === "continued" ? "You finished; the agent is back in control" : "No answer; the agent has the tab back");
    }
    this.#changed(owner);
  }

  /** Their keys, through the same CDP input path the agent's actions use. Named keys and single letters
   * and digits arrive as key events; every other character is inserted as text. */
  async #operatorKey(instance: Instance, tab: Tab, key: string): Promise<void> {
    const characters = [...key];
    if (characters.length === 1 && !/^[a-z0-9]$/iu.test(key)) {
      await instance.connection.send("Input.insertText", { text: key }, tab.session, 5_000).catch(() => undefined);
      return;
    }
    let stroke: KeyStroke;
    try {
      stroke = parseKey(key === " " ? "space" : key);
    } catch (error) {
      if (error instanceof KeyParseError) return;
      throw error;
    }
    const base = {
      key: stroke.key, code: stroke.code, modifiers: stroke.modifiers,
      ...(stroke.keyCode ? { windowsVirtualKeyCode: stroke.keyCode, nativeVirtualKeyCode: stroke.keyCode } : {}),
    };
    await instance.connection.send("Input.dispatchKeyEvent", {
      type: stroke.text ? "keyDown" : "rawKeyDown", ...base, ...(stroke.text ? { text: stroke.text, unmodifiedText: stroke.text } : {}),
    }, tab.session, 5_000).catch(() => undefined);
    await instance.connection.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, tab.session, 5_000).catch(() => undefined);
  }

  /** Tells live viewers what the agent just did; act reports its own, with the pointer position. */
  #narrate(owner: string, action: BrowserAction, params: Record<string, unknown>, result: BrowserToolResult): void {
    const reference = isRecord(result.details["tab"]) ? str(result.details["tab"]["id"]) : "";
    const tab = reference ? this.#tabs.get(reference) : undefined;
    if (!tab || tab.owner !== owner) return;
    const blank = tab.url === "about:blank";
    const caption: Partial<Record<BrowserAction, string>> = {
      open: blank ? "Opened a blank tab" : `Opened ${tab.url}`,
      navigate: `Navigated to ${tab.url}`,
      back: "Went back",
      forward: "Went forward",
      reload: "Reloaded the page",
      focus: `Switched to ${tab.id}`,
      snapshot: "Read the page",
      text: typeof params["selector"] === "string" ? `Read the text of ${params["selector"]}` : "Read the page text",
      screenshot: "Took a screenshot",
      console: "Read the console",
      resize: typeof params["width"] === "number" && typeof params["height"] === "number"
        ? `Resized the viewport to ${params["width"]}×${params["height"]}`
        : "Restored the default viewport",
    };
    const text = caption[action];
    if (text) this.#emitAction(tab, text);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async #ensure(settings: BrowserSettings): Promise<Instance> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.#stopping) await this.#stopping;
      const instance = this.#instance;
      if (instance) {
        if (!instance.connection.closed && instance.headless === settings.headless && instance.configuredPath === settings.executablePath) return instance;
        await this.stop();
        continue;
      }
      if (!this.#starting) {
        const generation = this.#generation;
        this.#starting = this.#launch(settings, generation).finally(() => {
          this.#starting = undefined;
        });
      }
      return await this.#starting;
    }
    throw new BrowserToolError("The managed browser could not be restarted with the current settings.", 409);
  }

  async #launch(settings: BrowserSettings, generation: number): Promise<Instance> {
    const resolution = await resolveBrowserExecutable(settings.executablePath, this.#probe);
    if (!resolution.executable) {
      this.#fail(resolution.error, settings);
      throw new BrowserToolError(`${resolution.error} Configure it in HUI Settings → Tools → Browser.`, 409);
    }
    const executable = resolution.executable;
    if (!settings.headless && this.#probe.platform === "linux" && !this.#env["DISPLAY"] && !this.#env["WAYLAND_DISPLAY"]) {
      this.#fail("A visible browser window needs a display, and the HUI gateway has none. Turn headless back on in Settings → Tools → Browser.", settings);
      throw new BrowserToolError(this.#lastError, 409);
    }
    await mkdir(this.#profileDir, { recursive: true });
    const child = spawn(executable.path, browserLaunchArguments({
      profileDir: this.#profileDir,
      headless: settings.headless,
      ...this.#window,
      noSandbox: process.getuid?.() === 0,
    }), { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: browserEnvironment(this.#env) });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_192);
    });
    let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
    let onError: ((error: Error) => void) | undefined;
    const failed = new Promise<never>((_resolve, reject) => {
      onExit = (code, signal) => reject(new BrowserToolError(startupFailure(executable.name, code, signal, stderr), 502));
      onError = (error) => reject(new BrowserToolError(`${executable.name} could not be started: ${error.message}`, 502));
      child.once("exit", onExit);
      child.once("error", onError);
    });
    failed.catch(() => undefined);
    const writer = child.stdio[3];
    const reader = child.stdio[4];
    if (!writer || !reader) {
      child.kill("SIGKILL");
      throw new BrowserToolError(`${executable.name} did not expose a DevTools pipe.`, 502);
    }
    const connection = new CdpConnection(writer as Writable, reader as Readable);
    const instance: Instance = {
      child,
      connection,
      headless: settings.headless,
      configuredPath: settings.executablePath,
      executable,
      version: executable.name,
      startedAt: new Date().toISOString(),
      startup: new Set(),
      startupCleaned: false,
      state: EMPTY_BROWSER_STATE,
      seeded: new Set(),
      capturedAt: new Map(),
    };
    // Subscribe before discovery: Chromium reports existing targets immediately.
    connection.on((event) => this.#onEvent(instance, event));
    try {
      const version = await Promise.race([connection.send("Browser.getVersion", {}, undefined, 30_000), failed]);
      instance.version = str(version["product"]) || executable.name;
      await Promise.race([connection.send("Target.setDiscoverTargets", { discover: true }), failed]);
      await connection.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => undefined);
      const targets = await Promise.race([connection.send("Target.getTargets"), failed]);
      for (const info of Array.isArray(targets["targetInfos"]) ? targets["targetInfos"].filter(isRecord) : []) {
        if (info["type"] === "page" && str(info["url"]) === "about:blank") instance.startup.add(str(info["targetId"]));
      }
      await this.#seed(instance);
      if (generation !== this.#generation) throw new BrowserToolError("The managed browser was stopped while it was starting.", 409);
    } catch (error) {
      const connectionDied = connection.closed;
      connection.close();
      // Chromium's pipe closes before Node reaps the process, so give the exit a
      // moment: its status and stderr explain the failure (another Chrome owns
      // the profile, the process crashed) instead of the bare connection error.
      if (connectionDied && child.exitCode === null && child.signalCode === null) {
        await Promise.race([failed.catch(() => undefined), delay(1_000)]);
      }
      child.kill("SIGKILL");
      const died = child.exitCode !== null || child.signalCode !== null;
      const message = died
        ? startupFailure(executable.name, child.exitCode, child.signalCode, stderr)
        : error instanceof Error ? error.message : "The managed browser could not be started.";
      this.#fail(message, settings);
      if (died || !(error instanceof BrowserToolError)) throw new BrowserToolError(message, 502);
      throw error;
    } finally {
      if (onExit) child.off("exit", onExit);
      if (onError) child.off("error", onError);
    }
    child.once("exit", (code, signal) => this.#onExit(instance, code, signal));
    this.#instance = instance;
    this.#lastError = "";
    this.#changed();
    return instance;
  }

  // ── Mirrored state ─────────────────────────────────────────────────────────

  /** A launching profile starts from what the mirror holds: every cookie now, each origin's storage when that origin is
   * first visited. Best effort throughout: a mirror that cannot answer never keeps a page from loading. */
  async #seed(instance: Instance): Promise<void> {
    if (!this.#mirror) return;
    const state = await this.#mirror.read().catch(() => EMPTY_BROWSER_STATE);
    instance.state = state;
    this.#mirrorTimer ??= setInterval(() => {
      const running = this.#instance;
      if (running) for (const tab of this.#tabs.values()) void this.#capture(running, tab);
    }, MIRROR_CAPTURE_MS);
    this.#mirrorTimer.unref();
    if (!state.cookies.length) return;
    await instance.connection.send("Storage.setCookies", {
      cookies: state.cookies.map(({ at: _captured, ...cookie }) => cookie),
    }, undefined, 10_000).catch(() => undefined);
  }

  /** Writes one origin's stored state into a hidden tab of that origin, before the agent's tab goes there. */
  async #seedOrigin(instance: Instance, origin: string | undefined): Promise<void> {
    if (!origin || !this.#mirror || instance.seeded.has(origin)) return;
    instance.seeded.add(origin);
    const stored = instance.state.origins.find((entry) => entry.origin === origin);
    if (!stored || (!stored.localStorage.length && !stored.indexedDB.length)) return;
    let targetId = "";
    try {
      const created = await instance.connection.send("Target.createTarget", { url: "about:blank", newWindow: true });
      targetId = str(created["targetId"]);
      const attached = await instance.connection.send("Target.attachToTarget", { targetId, flatten: true });
      const session = str(attached["sessionId"]);
      await instance.connection.send("Page.navigate", { url: origin }, session, 20_000);
      // Storage belongs to the document's origin: writing before this tab holds that origin writes nowhere.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const href = await instance.connection.send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, session, 5_000)
          .then((result) => str((isRecord(result["result"]) ? result["result"]["value"] : undefined)))
          .catch(() => "");
        if (isHttpOrigin(href) === origin) break;
        await delay(100);
      }
      const payload = { localStorage: stored.localStorage.map(({ key, value }) => [key, value ?? ""]), indexedDB: stored.indexedDB };
      await instance.connection.send("Runtime.evaluate", {
        expression: `(${STATE_SEED})(${JSON.stringify(payload)})`,
        awaitPromise: true, returnByValue: true,
      }, session, 20_000);
    } catch {
      // A page that refuses storage still browses; this origin is simply not seeded.
    } finally {
      if (targetId) await instance.connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
    }
  }

  /** Reads what this browser holds — the cookie jar, and one tab's localStorage and IndexedDB — into its state, and
   * hands that to the mirror. */
  async #capture(instance: Instance, tab: Tab, force = false): Promise<void> {
    if (!this.#mirror || this.#instance !== instance) return;
    const at = Date.now();
    const origin = isHttpOrigin(tab.url);
    if (!force && at - (instance.capturedAt.get(origin ?? "") ?? 0) < CAPTURE_INTERVAL_MS) return;
    instance.capturedAt.set(origin ?? "", at);
    const origins: StoredOrigin[] = [];
    if (origin) {
      try {
        const result = await instance.connection.send("Runtime.evaluate", {
          expression: `(${STATE_CAPTURE})()`, awaitPromise: true, returnByValue: true,
        }, tab.session, 20_000);
        const value = isRecord(result["result"]) ? result["result"]["value"] : undefined;
        if (isRecord(value)) origins.push(capturedOrigin(origin, at, value));
      } catch {
        // A page mid-navigation has no storage to read yet.
      }
    }
    let cookies = instance.state.cookies;
    try {
      const result = await instance.connection.send("Storage.getCookies", {}, undefined, 5_000);
      cookies = capturedCookies((Array.isArray(result["cookies"]) ? result["cookies"] : []).filter(isRecord), at);
    } catch {
      // The browser may have gone between the call and the capture; what it had stays.
    }
    instance.state = trimBrowserState(mergeBrowserState(instance.state, { cookies, origins }));
    this.#mirror.write(instance.state);
  }

  async #shutdown(instance: Instance): Promise<void> {
    this.#stopMirrorClock();
    // What this profile holds is the last thing the mirror can learn from it.
    await Promise.all([...this.#tabs.values()].map((tab) => this.#capture(instance, tab, true)));
    if (this.#instance === instance) this.#instance = undefined;
    this.#forgetTabs();
    this.#changed();
    const child = instance.child;
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    // Browser.close lets Chromium flush cookies and the profile cleanly.
    void instance.connection.send("Browser.close", {}, undefined, 5_000).catch(() => undefined);
    const kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(kill);
    instance.connection.close();
  }

  #onExit(instance: Instance, code: number | null, signal: NodeJS.Signals | null): void {
    instance.connection.close("The managed browser exited.");
    if (this.#instance !== instance) return;
    this.#instance = undefined;
    this.#forgetTabs();
    this.#changed();
    this.#fail(`The managed browser exited unexpectedly (${code !== null ? `code ${code}` : signal ?? "no exit status"}). It starts again on the next browser action.`, {
      enabled: true, headless: instance.headless, executablePath: instance.configuredPath,
    });
  }

  #stopMirrorClock(): void {
    if (!this.#mirrorTimer) return;
    clearInterval(this.#mirrorTimer);
    this.#mirrorTimer = undefined;
  }

  #fail(message: string, settings: LaunchSettings): void {
    this.#lastError = message;
    this.#lastErrorKey = settingsKey(settings);
  }

  #forgetTabs(): void {
    for (const owner of [...this.#handoffs.keys()]) this.#settleHandoff(owner, "stopped");
    this.#tabs.clear();
    this.#byTarget.clear();
    this.#bySession.clear();
    this.#current.clear();
    for (const cast of this.#casts.values()) for (const timer of cast.timers) clearTimeout(timer);
    this.#casts.clear();
    this.#lastActions.clear();
    for (const timer of this.#idle.values()) clearTimeout(timer);
    this.#idle.clear();
  }

  // ── Live view ─────────────────────────────────────────────────────────────

  /** Coalesces bursts of tab changes into one state message per viewer. */
  #changed(owner?: string): void {
    if (owner === undefined) this.#changedAll = true;
    else this.#changedOwners.add(owner);
    if (this.#changeQueued) return;
    this.#changeQueued = true;
    queueMicrotask(() => {
      this.#changeQueued = false;
      const all = this.#changedAll;
      const owners = new Set(this.#changedOwners);
      this.#changedAll = false;
      this.#changedOwners.clear();
      for (const viewer of [...this.#viewers]) if (all || owners.has(viewer.owner)) this.#syncViewer(viewer);
    });
  }

  #notify(viewer: Viewer, deliver: (listener: BrowserViewListener) => void): void {
    try {
      deliver(viewer.listener);
    } catch {
      // A broken viewer must not disturb the browser or other viewers.
    }
  }

  #syncViewer(viewer: Viewer, replay?: BrowserViewAction): void {
    if (viewer.closed) return;
    const current = this.#current.get(viewer.owner) ?? null;
    const pinned = viewer.pinned ? this.#tabs.get(viewer.pinned) : undefined;
    if (!pinned || pinned.owner !== viewer.owner || pinned.id === current) viewer.pinned = null;
    const next = viewer.pinned ?? current;
    const changed = this.#setWatching(viewer, next);
    const instance = this.#instance;
    const handoff = this.#handoffs.get(viewer.owner);
    const state: BrowserViewState = {
      running: instance !== undefined,
      ...(instance ? { mode: instance.headless ? "headless" as const : "windowed" as const } : {}),
      tabs: this.#ownerTabs(viewer.owner).map((tab) => ({ id: tab.id, title: clip(tab.title, 300), url: clip(tab.url, 2_048) })),
      current,
      watching: viewer.watching,
      following: viewer.pinned === null,
      handoff: handoff ? { tabId: handoff.tabId, message: handoff.message, since: handoff.since } : null,
    };
    this.#notify(viewer, (listener) => listener.state(state));
    if (replay) this.#notify(viewer, (listener) => listener.action(replay));
    const frame = changed && next ? this.#tabs.get(next)?.frame : undefined;
    if (frame) this.#notify(viewer, (listener) => listener.frame(frame));
  }

  #setWatching(viewer: Viewer, tabId: string | null): boolean {
    if (viewer.watching === tabId) return false;
    if (viewer.watching) this.#releaseCast(viewer.watching);
    viewer.watching = tabId;
    if (tabId) this.#acquireCast(tabId);
    return true;
  }

  #acquireCast(tabId: string): void {
    const tab = this.#tabs.get(tabId);
    const instance = this.#instance;
    if (!tab || !instance) return;
    let cast = this.#casts.get(tabId);
    if (!cast) {
      cast = { viewers: 0, ackedAt: 0, timers: new Set() };
      this.#casts.set(tabId, cast);
    }
    cast.viewers += 1;
    if (cast.viewers === 1) void this.#startCast(instance, tab);
  }

  #releaseCast(tabId: string): void {
    const cast = this.#casts.get(tabId);
    if (!cast || --cast.viewers > 0) return;
    this.#casts.delete(tabId);
    for (const timer of cast.timers) clearTimeout(timer);
    const tab = this.#tabs.get(tabId);
    const instance = this.#instance;
    if (tab && instance && !instance.connection.closed) {
      void instance.connection.send("Page.stopScreencast", {}, tab.session).catch(() => undefined);
    }
  }

  async #startCast(instance: Instance, tab: Tab): Promise<void> {
    const cast = this.#casts.get(tab.id);
    if (!cast) return;
    // A hidden tab paints nothing. Keep the agent's own tab in front, but only
    // headless: in a visible window this would switch the operator's tab.
    if (instance.headless && this.#current.get(tab.owner) === tab.id) await this.#ensureVisible(instance, tab);
    const deadline = Date.now() + SCREENCAST_START_MS;
    while (this.#casts.get(tab.id) === cast) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const started = await instance.connection.send("Page.startScreencast", SCREENCAST, tab.session, remaining).then(() => true, () => false);
      if (started) return;
      await delay(SCREENCAST_RETRY_MS);
    }
  }

  #onScreencastFrame(instance: Instance, tab: Tab, params: Record<string, unknown>): void {
    const cast = this.#casts.get(tab.id);
    if (!cast) {
      void instance.connection.send("Page.stopScreencast", {}, tab.session).catch(() => undefined);
      return;
    }
    const data = str(params["data"]);
    const metadata = isRecord(params["metadata"]) ? params["metadata"] : {};
    if (data) {
      const frame: BrowserViewFrame = {
        tabId: tab.id,
        width: Math.round(num(metadata["deviceWidth"])) || this.#window.width,
        height: Math.round(num(metadata["deviceHeight"])) || this.#window.height,
        seq: ++this.#frameSeq,
        image: Buffer.from(data, "base64"),
      };
      tab.frame = frame;
      for (const viewer of this.#viewers) if (viewer.watching === tab.id) this.#notify(viewer, (listener) => listener.frame(frame));
    }
    const ack = params["sessionId"];
    const timer = setTimeout(() => {
      cast.timers.delete(timer);
      cast.ackedAt = Date.now();
      void instance.connection.send("Page.screencastFrameAck", { sessionId: ack }, tab.session).catch(() => undefined);
    }, Math.max(0, cast.ackedAt + FRAME_INTERVAL_MS - Date.now()));
    cast.timers.add(timer);
  }

  #emitAction(tab: Tab, text: string, point?: { x: number; y: number }): void {
    const action: BrowserViewAction = {
      tabId: tab.id,
      text: clip(text, 300),
      ...(point ? { point: { x: Math.round(point.x), y: Math.round(point.y) } } : {}),
      at: new Date().toISOString(),
    };
    this.#lastActions.set(tab.owner, { tabId: action.tabId, text: action.text, at: action.at });
    for (const viewer of this.#viewers) if (viewer.owner === tab.owner) this.#notify(viewer, (listener) => listener.action(action));
  }

  #setInfo(tab: Tab, title: string, url: string): void {
    const nextUrl = url || tab.url;
    if (tab.title === title && tab.url === nextUrl) return;
    tab.title = title;
    tab.url = nextUrl;
    this.#changed(tab.owner);
  }

  #live(): Instance {
    const instance = this.#instance;
    if (!instance || instance.connection.closed) throw new BrowserToolError("The managed browser is not running. Call open to start it.", 409);
    return instance;
  }

  // ── Events and tabs ───────────────────────────────────────────────────────

  /** A link, redirect or script inside an allowed page may still land elsewhere: stop it and leave the tab blank. */
  #blockNavigation(instance: Instance, tab: Tab, url: string): void {
    tab.blocked = url;
    tab.refs.reset();
    void instance.connection.send("Page.stopLoading", {}, tab.session).catch(() => undefined);
    void instance.connection.send("Page.navigate", { url: "about:blank" }, tab.session).catch(() => undefined);
    this.#setInfo(tab, "Blocked by allowed origins", "about:blank");
    this.#emitAction(tab, `Blocked ${clip(url, 200)}: not in this browser's allowed origins`);
  }

  /** Refuse an agent-requested navigation outright, before a tab goes anywhere. */
  #assertAllowed(url: string): void {
    if (!allowsUrl(this.#origins, url)) throw new BrowserToolError(blockedOriginMessage(this.#origins, url), 403);
  }

  /** One line for the call that follows a blocked page, then it is reported once. */
  #blockedLine(tab: Tab): string | undefined {
    const blocked = tab.blocked;
    if (!blocked) return undefined;
    tab.blocked = undefined;
    return `This tab tried to reach ${clip(blocked, 300)}, which is not in the browser's allowed origins; the navigation was stopped and the tab was left on about:blank.`;
  }

  #onEvent(instance: Instance, event: CdpEvent): void {
    const params = event.params;
    if (!event.sessionId) {
      const info = isRecord(params["targetInfo"]) ? params["targetInfo"] : undefined;
      switch (event.method) {
        case "Target.targetCreated": {
          if (!info || info["type"] !== "page") break;
          const opener = this.#byTarget.get(str(info["openerId"]));
          if (opener) void this.#adopt(instance, str(info["targetId"]), opener);
          else if (!instance.startupCleaned && str(info["url"]) === "about:blank") instance.startup.add(str(info["targetId"]));
          break;
        }
        case "Target.targetInfoChanged": {
          const tab = info ? this.#byTarget.get(str(info["targetId"])) : undefined;
          if (tab && info) this.#setInfo(tab, str(info["title"]), str(info["url"]));
          break;
        }
        case "Target.targetDestroyed":
          instance.startup.delete(str(params["targetId"]));
          this.#drop(str(params["targetId"]));
          break;
        case "Target.targetCrashed": {
          const tab = this.#byTarget.get(str(params["targetId"]));
          if (tab) tab.crashed = true;
          break;
        }
        case "Target.detachedFromTarget": {
          const tab = this.#bySession.get(str(params["sessionId"]));
          if (tab) this.#drop(tab.targetId);
          break;
        }
      }
      return;
    }
    const tab = this.#bySession.get(event.sessionId);
    if (!tab) return;
    switch (event.method) {
      case "Page.frameNavigated": {
        const frame = isRecord(params["frame"]) ? params["frame"] : undefined;
        if (!frame || frame["parentId"]) break;
        const landed = str(frame["url"]);
        if (landed && !allowsUrl(this.#origins, landed)) {
          this.#blockNavigation(instance, tab, landed);
          break;
        }
        this.#setInfo(tab, tab.title, landed);
        const loaderId = str(frame["loaderId"]);
        if (loaderId && loaderId !== tab.loaderId) {
          tab.loaderId = loaderId;
          tab.refs.reset();
        }
        break;
      }
      case "Page.navigatedWithinDocument":
        if (str(params["frameId"]) === tab.frameId) this.#setInfo(tab, tab.title, str(params["url"]));
        break;
      case "Page.screencastFrame":
        this.#onScreencastFrame(instance, tab, params);
        break;
      case "Page.lifecycleEvent":
        if (params["name"] === "load") {
          tab.loaded.push(str(params["loaderId"]));
          if (tab.loaded.length > 16) tab.loaded.shift();
        }
        break;
      case "Page.javascriptDialogOpening": {
        // An unanswered dialog blocks the page and every further input event.
        const type = str(params["type"]) || "dialog";
        const accept = tab.dialogPolicy ? tab.dialogPolicy === "accept" : type === "alert" || type === "beforeunload";
        const summary = `${type} ${JSON.stringify(clip(str(params["message"]), 200))} ${accept ? "accepted" : "dismissed"}`;
        tab.dialogs.push(summary);
        this.#log(tab, "dialog", summary);
        void instance.connection.send("Page.handleJavaScriptDialog", { accept }, tab.session).catch(() => undefined);
        break;
      }
      case "Runtime.consoleAPICalled":
        this.#log(tab, str(params["type"]) || "log", consoleText(params["args"]));
        break;
      case "Runtime.exceptionThrown":
        this.#log(tab, "error", exceptionText(params["exceptionDetails"]));
        break;
      case "Log.entryAdded": {
        const entry = isRecord(params["entry"]) ? params["entry"] : {};
        const url = str(entry["url"]);
        this.#log(tab, str(entry["level"]) || "info", `${str(entry["text"])}${url ? ` (${url})` : ""}`);
        break;
      }
      case "Inspector.targetCrashed":
        tab.crashed = true;
        break;
    }
  }

  #log(tab: Tab, level: string, text: string): void {
    tab.console.push({ level, text: clip(text, 1_000) });
    if (tab.console.length > CONSOLE_LIMIT) tab.console.splice(0, tab.console.length - CONSOLE_LIMIT);
  }

  /** Popups inherit the opener's conversation. */
  async #adopt(instance: Instance, targetId: string, opener: Tab): Promise<void> {
    if (!targetId || this.#byTarget.has(targetId)) return;
    if (this.#ownerTabs(opener.owner).length >= MAX_TABS_PER_CONVERSATION || this.#tabs.size >= MAX_TABS_TOTAL) {
      this.#log(opener, "warning", "A popup was closed because the tab limit was reached.");
      await instance.connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
      return;
    }
    const popup = await this.#attach(instance, targetId, opener.owner, this.#epoch(opener.owner)).catch(() => undefined);
    // A headless popup opens in its opener's window and hides it. Keep the
    // agent's current tab painting until it focuses the popup.
    if (popup && instance.headless && this.#current.get(opener.owner) === opener.id) await this.#ensureVisible(instance, opener);
  }

  async #attach(instance: Instance, targetId: string, owner: string, epoch: number): Promise<Tab> {
    const connection = instance.connection;
    const attached = await connection.send("Target.attachToTarget", { targetId, flatten: true });
    const session = str(attached["sessionId"]);
    if (!session) throw new BrowserToolError("The browser did not attach to the new tab.", 502);
    const tab: Tab = {
      id: `t${++this.#nextTab}`, targetId, session, frameId: targetId, owner, title: "", url: "about:blank",
      refs: new SnapshotRefs(), loaderId: "", loaded: [], console: [], dialogs: [], dialogPolicy: undefined,
      crashed: false, openedAt: Date.now(),
    };
    this.#tabs.set(tab.id, tab);
    this.#byTarget.set(targetId, tab);
    this.#bySession.set(session, tab);
    try {
      const [tree] = await Promise.all([
        connection.send("Page.getFrameTree", {}, session),
        connection.send("Page.enable", {}, session),
        connection.send("Page.setLifecycleEventsEnabled", { enabled: true }, session),
        connection.send("Runtime.enable", {}, session),
        connection.send("Log.enable", {}, session),
        // Headless windows include invisible browser chrome; pin the page to
        // the configured size so layouts and screenshots are predictable.
        ...(instance.headless ? [connection.send("Emulation.setDeviceMetricsOverride", { ...this.#window, deviceScaleFactor: 1, mobile: false }, session)] : []),
      ]);
      const frameTree = isRecord(tree["frameTree"]) ? tree["frameTree"] : {};
      const frame = isRecord(frameTree["frame"]) ? frameTree["frame"] : undefined;
      if (frame) {
        tab.frameId = str(frame["id"]) || targetId;
        tab.url = str(frame["url"]) || tab.url;
        tab.loaderId = str(frame["loaderId"]);
      }
      // A popup can commit its document before this attach, so its navigation
      // event is already gone: check where it landed instead of only watching.
      if (tab.url !== "about:blank" && !allowsUrl(this.#origins, tab.url)) this.#blockNavigation(instance, tab, tab.url);
      if (epoch !== this.#epoch(owner)) throw new BrowserToolError("This conversation's browser tabs were closed.", 409);
    } catch (error) {
      this.#drop(targetId);
      void connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
      throw error;
    }
    this.#changed(owner);
    return tab;
  }

  #drop(targetId: string): void {
    const tab = this.#byTarget.get(targetId);
    if (!tab) return;
    if (this.#handoffs.get(tab.owner)?.tabId === tab.id) this.#settleHandoff(tab.owner, "closed");
    this.#tabs.delete(tab.id);
    this.#byTarget.delete(targetId);
    this.#bySession.delete(tab.session);
    const cast = this.#casts.get(tab.id);
    if (cast) {
      for (const timer of cast.timers) clearTimeout(timer);
      this.#casts.delete(tab.id);
    }
    if (this.#current.get(tab.owner) === tab.id) {
      const next = this.#ownerTabs(tab.owner).at(-1);
      if (next) this.#current.set(tab.owner, next.id);
      else this.#current.delete(tab.owner);
    }
    this.#changed(tab.owner);
    this.#stopIfUnused();
  }

  #ownerTabs(owner: string): Tab[] {
    return [...this.#tabs.values()].filter((tab) => tab.owner === owner).sort((a, b) => a.openedAt - b.openedAt);
  }

  #tabFor(owner: string, raw: unknown): Tab {
    if (raw !== undefined && (typeof raw !== "string" || !/^t\d{1,6}$/u.test(raw))) {
      throw new BrowserToolError("tabId must be a tab handle such as t1, as returned by open or tabs.");
    }
    const id = typeof raw === "string" ? raw : this.#current.get(owner);
    const tab = id ? this.#tabs.get(id) : undefined;
    if (!tab || tab.owner !== owner) {
      throw new BrowserToolError(typeof raw === "string"
        ? `Tab ${raw} is not open in this conversation. Call tabs to list your tabs, or open a new one.`
        : "No tab is open in this conversation. Call open with a URL first.", 404);
    }
    if (tab.crashed) throw new BrowserToolError(`Tab ${tab.id} crashed. Close it and open a new tab.`, 409);
    if (this.#current.get(owner) !== tab.id) {
      this.#current.set(owner, tab.id);
      this.#changed(owner);
    }
    return tab;
  }

  #closeStartupPages(instance: Instance): void {
    if (instance.startupCleaned) return;
    instance.startupCleaned = true;
    for (const targetId of instance.startup) {
      if (!this.#byTarget.has(targetId)) void instance.connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
    }
    instance.startup.clear();
  }

  async #refreshInfo(instance: Instance, tab: Tab): Promise<void> {
    try {
      const result = await instance.connection.send("Target.getTargetInfo", { targetId: tab.targetId }, undefined, 5_000);
      const info = isRecord(result["targetInfo"]) ? result["targetInfo"] : undefined;
      if (info) this.#setInfo(tab, str(info["title"]), str(info["url"]));
    } catch {
      // Keep the event-derived title and URL.
    }
  }

  /** Title changes are not reliably reported by events (for example in a
   * background popup); listings read the browser's current target list. */
  async #refreshAll(instance: Instance): Promise<void> {
    try {
      const result = await instance.connection.send("Target.getTargets", {}, undefined, 5_000);
      for (const info of Array.isArray(result["targetInfos"]) ? result["targetInfos"].filter(isRecord) : []) {
        const tab = this.#byTarget.get(str(info["targetId"]));
        if (tab) this.#setInfo(tab, str(info["title"]), str(info["url"]));
      }
    } catch {
      // Keep the event-derived titles and URLs.
    }
  }

  #header(tab: Tab): string {
    return `Tab ${tab.id} · ${clip(tab.title || "Untitled", 200)}\nURL: ${clip(tab.url, 2_048)}`;
  }

  #tabDetails(tab: Tab): { id: string; title: string; url: string } {
    return { id: tab.id, title: clip(tab.title, 200), url: clip(tab.url, 2_048) };
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Observes one tab's main frame from before an action until it settles. */
  #watch(instance: Instance, tab: Tab) {
    const state = { started: false, loader: "", loaded: false, stopped: false, sameDocument: false };
    const waiters = new Set<() => void>();
    const notify = () => {
      for (const waiter of [...waiters]) waiter();
    };
    const off = instance.connection.on((event) => {
      if (event.sessionId !== tab.session) return;
      const params = event.params;
      switch (event.method) {
        case "Page.frameRequestedNavigation":
          if (str(params["frameId"]) === tab.frameId && params["disposition"] === "currentTab") {
            state.started = true;
            notify();
          }
          break;
        case "Page.frameStartedLoading":
          if (str(params["frameId"]) === tab.frameId) {
            state.started = true;
            notify();
          }
          break;
        case "Page.frameNavigated": {
          const frame = isRecord(params["frame"]) ? params["frame"] : undefined;
          if (!frame || frame["parentId"]) break;
          state.started = true;
          state.loader = str(frame["loaderId"]);
          if (params["type"] === "BackForwardCacheRestore" || tab.loaded.includes(state.loader)) state.loaded = true;
          notify();
          break;
        }
        case "Page.navigatedWithinDocument":
          if (str(params["frameId"]) === tab.frameId) {
            state.started = true;
            state.sameDocument = true;
            if (!state.loader) state.loaded = true;
            notify();
          }
          break;
        case "Page.lifecycleEvent":
          if (params["name"] === "load" && state.loader && str(params["loaderId"]) === state.loader) {
            state.loaded = true;
            notify();
          }
          break;
        case "Page.frameStoppedLoading":
          if (str(params["frameId"]) === tab.frameId) {
            state.stopped = true;
            notify();
          }
          break;
      }
    });
    const until = (condition: () => boolean, ms: number) => new Promise<boolean>((resolveWait) => {
      if (condition()) {
        resolveWait(true);
        return;
      }
      let offClose = () => {};
      const finish = (value: boolean) => {
        waiters.delete(check);
        clearTimeout(timer);
        offClose();
        resolveWait(value);
      };
      const check = () => {
        if (condition()) finish(true);
      };
      const timer = setTimeout(() => finish(condition()), ms);
      waiters.add(check);
      offClose = instance.connection.onClose(() => finish(false));
    });
    return {
      state,
      expect(loaderId: string): void {
        state.started = true;
        state.loader = loaderId;
        if (tab.loaded.includes(loaderId)) state.loaded = true;
      },
      started: (ms: number) => until(() => state.started, ms),
      // A cancelled navigation (204, download) stops without committing a document.
      settled: (ms: number) => until(() => state.loaded || (state.stopped && !state.loader), ms),
      dispose: (): void => {
        off();
        waiters.clear();
      },
    };
  }

  async #navigate(instance: Instance, tab: Tab, url: string, timeoutMs: number): Promise<NavigationOutcome> {
    await this.#seedOrigin(instance, isHttpOrigin(url));
    const watch = this.#watch(instance, tab);
    try {
      const result = await instance.connection.send("Page.navigate", { url }, tab.session, timeoutMs + 5_000);
      if (result["isDownload"] === true) {
        throw new BrowserToolError(`${clip(url, 200)} is a download. Downloads are disabled in the managed browser; fetch the file with a command instead.`);
      }
      const errorText = str(result["errorText"]);
      if (errorText) throw new BrowserToolError(`${clip(url, 200)} could not be loaded: ${errorText}.`, 502);
      const loaderId = str(result["loaderId"]);
      if (!loaderId) return { navigated: true, loaded: true, sameDocument: true };
      watch.expect(loaderId);
      const outcome = { navigated: true, loaded: await watch.settled(timeoutMs), sameDocument: false };
      void this.#capture(instance, tab);
      return outcome;
    } finally {
      watch.dispose();
    }
  }

  async #history(owner: string, action: "back" | "forward" | "reload", params: Record<string, unknown>): Promise<BrowserToolResult> {
    const tab = this.#tabFor(owner, params["tabId"]);
    const instance = this.#live();
    const timeoutMs = timeoutFrom(params["timeoutMs"]);
    const connection = instance.connection;
    let trigger: () => Promise<unknown>;
    if (action === "reload") {
      trigger = () => connection.send("Page.reload", {}, tab.session);
    } else {
      const history = await connection.send("Page.getNavigationHistory", {}, tab.session);
      const entries = Array.isArray(history["entries"]) ? history["entries"].filter(isRecord) : [];
      const entry = entries[num(history["currentIndex"]) + (action === "back" ? -1 : 1)];
      if (!entry) throw new BrowserToolError(action === "back" ? "There is no earlier page in this tab's history." : "There is no later page in this tab's history.", 409);
      this.#assertAllowed(str(entry["url"]));
      trigger = () => connection.send("Page.navigateToHistoryEntry", { entryId: entry["id"] }, tab.session);
    }
    const watch = this.#watch(instance, tab);
    let outcome: NavigationOutcome;
    try {
      await trigger();
      const started = await watch.started(2_000);
      outcome = started
        ? { navigated: true, loaded: await watch.settled(timeoutMs), sameDocument: watch.state.sameDocument && !watch.state.loader }
        : { navigated: false, loaded: true, sameDocument: false };
    } finally {
      watch.dispose();
    }
    const verb = action === "reload" ? "Reloaded" : action === "back" ? "Went back in" : "Went forward in";
    return this.#pageResult(instance, tab, action, `${verb} tab ${tab.id}.`, outcome, params);
  }

  async #open(owner: string, params: Record<string, unknown>, settings: BrowserSettings, epoch: number): Promise<BrowserToolResult> {
    const url = normalizeBrowserUrl(params["url"] ?? "about:blank");
    this.#assertAllowed(url);
    const timeoutMs = timeoutFrom(params["timeoutMs"]);
    if (this.#ownerTabs(owner).length >= MAX_TABS_PER_CONVERSATION) {
      throw new BrowserToolError(`This conversation already has ${MAX_TABS_PER_CONVERSATION} tabs open. Close one first.`, 409);
    }
    if (this.#tabs.size >= MAX_TABS_TOTAL) throw new BrowserToolError(`The managed browser already has ${MAX_TABS_TOTAL} tabs open.`, 409);
    // A browser killed between two calls can accept one more write before its
    // pipe reports EOF; drop that dead process and relaunch instead of
    // surfacing the connection error for an open that can still succeed.
    for (let attempt = 0; ; attempt += 1) {
      const instance = await this.#ensure(settings);
      try {
        // Headless windows are free: one per tab keeps every conversation's tab
        // visible, so none stops painting (or stalls input) when another opens.
        const created = await instance.connection.send("Target.createTarget", { url: "about:blank", ...(instance.headless ? { newWindow: true } : {}) });
        const tab = await this.#attach(instance, str(created["targetId"]), owner, epoch);
        this.#current.set(owner, tab.id);
        this.#changed(owner);
        this.#closeStartupPages(instance);
        const outcome = url === "about:blank"
          ? { navigated: false, loaded: true, sameDocument: false }
          : await this.#navigate(instance, tab, url, timeoutMs);
        return await this.#pageResult(instance, tab, "open", `Opened tab ${tab.id}.`, outcome, params);
      } catch (error) {
        if (attempt > 0 || !(error instanceof CdpError) || !instance.connection.closed) throw error;
        // Another call may already have replaced the dead instance; stopping
        // that replacement would kill a browser someone else is using.
        if (this.#instance === instance) await this.stop();
      }
    }
  }

  async #pageResult(
    instance: Instance,
    tab: Tab,
    action: string,
    lead: string,
    outcome: NavigationOutcome,
    params: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const snapshot = await this.#snapshot(instance, tab, {
      interactive: params["interactive"] === true,
      maxChars: params["maxChars"] === undefined ? PAGE_SNAPSHOT_CHARS : clampSnapshotChars(params["maxChars"]),
    });
    const lines = [lead, this.#header(tab)];
    const blocked = this.#blockedLine(tab);
    if (blocked) lines.push(blocked);
    if (!outcome.loaded) lines.push("The page was still loading when the timeout elapsed; this is its current state.");
    lines.push("", snapshot.text || "(The page has no accessible content yet.)");
    if (snapshot.truncated) lines.push(TRUNCATED_NOTE);
    return {
      text: lines.join("\n"),
      details: { action, tab: this.#tabDetails(tab), loaded: outcome.loaded, truncated: snapshot.truncated },
    };
  }

  async #snapshot(instance: Instance, tab: Tab, options: SnapshotOptions): Promise<SnapshotResult> {
    let result: SnapshotResult | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const loaderId = tab.loaderId;
      const tree = await instance.connection.send("Accessibility.getFullAXTree", {}, tab.session);
      await this.#refreshInfo(instance, tab);
      const nodes = Array.isArray(tree["nodes"]) ? tree["nodes"].filter(isRecord) as unknown as AxNode[] : [];
      result = renderSnapshot(nodes, tab.refs, { ...options, pageUrl: tab.url });
      // A document committed while the tree was read: its refs would be stale.
      if (loaderId === tab.loaderId) break;
      tab.refs.reset();
    }
    return result ?? { text: "", lines: 0, truncated: false };
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  #target(tab: Tab, raw: unknown): { ref: string; target: SnapshotTarget; label: string } {
    if (typeof raw !== "string" || !/^e\d{1,7}$/u.test(raw)) throw new BrowserToolError("ref must be an element ref such as e12 from the latest snapshot.");
    const target = tab.refs.target(raw);
    if (!target) {
      throw new BrowserToolError(`Ref ${raw} is not in tab ${tab.id}'s latest snapshot. Take a new snapshot; refs do not carry across pages or tabs.`, 404);
    }
    return { ref: raw, target, label: describeTarget(raw, target) };
  }

  async #resolve(instance: Instance, tab: Tab, backendNodeId: number, label: string): Promise<string> {
    try {
      const resolved = await instance.connection.send("DOM.resolveNode", { backendNodeId, objectGroup: OBJECT_GROUP }, tab.session);
      const objectId = isRecord(resolved["object"]) ? str(resolved["object"]["objectId"]) : "";
      if (objectId) return objectId;
    } catch {
      // Reported below.
    }
    throw new BrowserToolError(`${label} is no longer in the page. Take a new snapshot.`, 404);
  }

  async #call(instance: Instance, tab: Tab, objectId: string, declaration: string, args: unknown[] = []): Promise<unknown> {
    const result = await instance.connection.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: declaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    }, tab.session);
    if (isRecord(result["exceptionDetails"])) throw new BrowserToolError(`The page rejected the action: ${exceptionText(result["exceptionDetails"])}`);
    return isRecord(result["result"]) ? result["result"]["value"] : undefined;
  }

  async #box(instance: Instance, tab: Tab, backendNodeId: number, label: string): Promise<number[]> {
    try {
      await instance.connection.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, tab.session);
    } catch {
      throw new BrowserToolError(`${label} is no longer in the page. Take a new snapshot.`, 404);
    }
    let quads: unknown[] = [];
    try {
      const result = await instance.connection.send("DOM.getContentQuads", { backendNodeId }, tab.session);
      quads = Array.isArray(result["quads"]) ? result["quads"] : [];
    } catch {
      // No layout box; reported below.
    }
    const quad = quads.find((candidate): candidate is number[] =>
      Array.isArray(candidate) && candidate.length === 8 && candidate.every((value) => typeof value === "number") && polygonArea(candidate) > 1);
    if (!quad) throw new BrowserToolError(`${label} has no visible box. It may be hidden, collapsed or outside the page.`, 409);
    return quad;
  }

  async #point(instance: Instance, tab: Tab, target: SnapshotTarget, label: string, requireHit: boolean): Promise<{ x: number; y: number }> {
    const quad = await this.#box(instance, tab, target.backendNodeId, label);
    const x = ((quad[0] ?? 0) + (quad[2] ?? 0) + (quad[4] ?? 0) + (quad[6] ?? 0)) / 4;
    const y = ((quad[1] ?? 0) + (quad[3] ?? 0) + (quad[5] ?? 0) + (quad[7] ?? 0)) / 4;
    if (requireHit) await this.#assertHit(instance, tab, target, label, x, y);
    return { x, y };
  }

  /** A real mouse click lands on whatever is on top; refuse to click an
   * overlay (cookie banner, modal) instead of the element the agent chose. */
  async #assertHit(instance: Instance, tab: Tab, target: SnapshotTarget, label: string, x: number, y: number): Promise<void> {
    let hitNode: number | undefined;
    try {
      const hit = await instance.connection.send("DOM.getNodeForLocation", {
        x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false, ignorePointerEventsNone: true,
      }, tab.session);
      hitNode = typeof hit["backendNodeId"] === "number" ? hit["backendNodeId"] : undefined;
    } catch {
      return;
    }
    if (hitNode === undefined || hitNode === target.backendNodeId) return;
    const element = await this.#resolve(instance, tab, target.backendNodeId, label);
    let other = "";
    try {
      const resolved = await instance.connection.send("DOM.resolveNode", { backendNodeId: hitNode, objectGroup: OBJECT_GROUP }, tab.session);
      other = isRecord(resolved["object"]) ? str(resolved["object"]["objectId"]) : "";
    } catch {
      return;
    }
    if (!other) return;
    const result = await instance.connection.send("Runtime.callFunctionOn", {
      objectId: element, functionDeclaration: CONTAINS_HIT,
      arguments: [{ objectId: other }, { value: Math.round(x) }, { value: Math.round(y) }], returnByValue: true,
    }, tab.session);
    const value = isRecord(result["result"]) ? result["result"]["value"] : undefined;
    if (isRecord(value) && value["contains"] === false) {
      throw new BrowserToolError(`${label} is covered by ${str(value["cover"]) || "another element"}. Close or scroll past the overlay, then take a new snapshot.`, 409);
    }
  }

  async #mouse(instance: Instance, tab: Tab, point: { x: number; y: number }, clicks: number): Promise<void> {
    const send = (params: Record<string, unknown>) => instance.connection.send("Input.dispatchMouseEvent", { ...point, ...params }, tab.session);
    await send({ type: "mouseMoved", button: "none", buttons: 0 });
    for (let count = 1; count <= clicks; count += 1) {
      await send({ type: "mousePressed", button: "left", buttons: 1, clickCount: count });
      await send({ type: "mouseReleased", button: "left", buttons: 0, clickCount: count });
    }
  }

  async #key(instance: Instance, tab: Tab, stroke: KeyStroke): Promise<void> {
    const base = {
      modifiers: stroke.modifiers, key: stroke.key, code: stroke.code,
      windowsVirtualKeyCode: stroke.keyCode, nativeVirtualKeyCode: stroke.keyCode,
    };
    await instance.connection.send("Input.dispatchKeyEvent", {
      type: stroke.text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(stroke.text ? { text: stroke.text, unmodifiedText: stroke.text } : {}),
    }, tab.session);
    await instance.connection.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, tab.session);
  }

  /** Chromium stops producing frames for a hidden tab (for example the opener
   * of a popup), and input sent to it then waits for a frame that never comes.
   * Only a hidden tab is brought to the front; a visible one is left alone. */
  async #ensureVisible(instance: Instance, tab: Tab): Promise<void> {
    const result = await instance.connection.send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, tab.session, 5_000)
      .catch(() => undefined);
    const state = result && isRecord(result["result"]) ? result["result"]["value"] : undefined;
    if (state !== "visible") await instance.connection.send("Page.bringToFront", {}, tab.session).catch(() => undefined);
  }

  async #perform(instance: Instance, tab: Tab, kind: BrowserActKind, params: Record<string, unknown>): Promise<{ text: string; point?: { x: number; y: number } }> {
    if (kind !== "wait") await this.#ensureVisible(instance, tab);
    switch (kind) {
      case "click": {
        const { target, label } = this.#target(tab, params["ref"]);
        const point = await this.#point(instance, tab, target, label, true);
        await this.#mouse(instance, tab, point, params["double"] === true ? 2 : 1);
        return { text: `${params["double"] === true ? "Double-clicked" : "Clicked"} ${label}.`, point };
      }
      case "hover": {
        const { target, label } = this.#target(tab, params["ref"]);
        const point = await this.#point(instance, tab, target, label, false);
        await instance.connection.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none", buttons: 0 }, tab.session);
        return { text: `Hovered ${label}.`, point };
      }
      case "type": {
        const text = params["text"];
        if (typeof text !== "string" || text.length > 20_000) throw new BrowserToolError("text must be a string of at most 20000 characters.");
        const { target, label } = this.#target(tab, params["ref"]);
        const objectId = await this.#resolve(instance, tab, target.backendNodeId, label);
        const state = await this.#call(instance, tab, objectId, PREPARE_TYPING, [params["append"] === true]);
        if (state === "not-editable") throw new BrowserToolError(`${label} is not a text field. Click it instead, or type into a textbox ref.`, 409);
        if (state === "read-only") throw new BrowserToolError(`${label} is disabled or read-only.`, 409);
        if (text) await instance.connection.send("Input.insertText", { text }, tab.session);
        if (params["submit"] === true) await this.#key(instance, tab, parseKey("Enter"));
        return { text: `Typed ${[...text].length} character${[...text].length === 1 ? "" : "s"} into ${label}${params["submit"] === true ? " and pressed Enter" : ""}.` };
      }
      case "press": {
        const raw = params["key"];
        if (typeof raw !== "string") throw new BrowserToolError("key must be a key name such as Enter, Tab, ArrowDown or Control+A.");
        let stroke: KeyStroke;
        try {
          stroke = parseKey(raw);
        } catch (error) {
          throw new BrowserToolError(error instanceof KeyParseError ? error.message : "Unknown key.");
        }
        if (params["ref"] !== undefined) {
          const { target, label } = this.#target(tab, params["ref"]);
          try {
            await instance.connection.send("DOM.focus", { backendNodeId: target.backendNodeId }, tab.session);
          } catch {
            throw new BrowserToolError(`${label} cannot receive keyboard focus.`, 409);
          }
        }
        await this.#key(instance, tab, stroke);
        return { text: `Pressed ${raw.trim()}.` };
      }
      case "select": {
        const values = params["values"];
        if (!Array.isArray(values) || values.length === 0 || values.length > 20 || !values.every((value) => typeof value === "string" && value.length <= 500)) {
          throw new BrowserToolError("values must list 1 to 20 option values or labels.");
        }
        const { target, label } = this.#target(tab, params["ref"]);
        const objectId = await this.#resolve(instance, tab, target.backendNodeId, label);
        const result = await this.#call(instance, tab, objectId, SELECT_OPTIONS, [values]);
        if (isRecord(result) && result["error"] === "not-select") throw new BrowserToolError(`${label} is not a native select. Click it and then click the option instead.`, 409);
        if (isRecord(result) && result["error"] === "no-match") {
          const options = Array.isArray(result["options"]) ? result["options"].map(String).join(", ") : "";
          throw new BrowserToolError(`No option of ${label} matches ${values.join(", ")}. Options: ${options}.`, 409);
        }
        const selected = isRecord(result) && Array.isArray(result["selected"]) ? result["selected"].map(String) : [];
        return { text: `Selected ${selected.join(", ") || values.join(", ")} in ${label}.` };
      }
      case "scroll": {
        if (params["ref"] !== undefined) {
          const { target, label } = this.#target(tab, params["ref"]);
          await this.#box(instance, tab, target.backendNodeId, label);
          return { text: `Scrolled ${label} into view.` };
        }
        const deltaY = params["deltaY"] ?? 600;
        if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || Math.abs(deltaY) > 20_000) throw new BrowserToolError("deltaY must be a number of pixels between -20000 and 20000.");
        const metrics = await instance.connection.send("Page.getLayoutMetrics", {}, tab.session);
        const viewport = isRecord(metrics["cssVisualViewport"]) ? metrics["cssVisualViewport"] : {};
        await instance.connection.send("Input.dispatchMouseEvent", {
          type: "mouseWheel", x: num(viewport["clientWidth"]) / 2, y: num(viewport["clientHeight"]) / 2, deltaX: 0, deltaY,
        }, tab.session);
        const position = await instance.connection.send("Runtime.evaluate", {
          expression: "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done([Math.round(scrollY), Math.round(document.documentElement.scrollHeight), innerHeight]))))",
          awaitPromise: true, returnByValue: true,
        }, tab.session, 5_000).catch(() => undefined);
        const value = position && isRecord(position["result"]) ? position["result"]["value"] : undefined;
        const [top, height, visible] = Array.isArray(value) ? value.map(num) : [];
        return { text: `Scrolled by ${deltaY} px at the center of the viewport${top !== undefined ? `; the page is at y=${top} of ${height} (${visible} px visible)` : ""}.` };
      }
      case "wait": return { text: await this.#wait(instance, tab, params) };
    }
  }

  async #wait(instance: Instance, tab: Tab, params: Record<string, unknown>): Promise<string> {
    const conditions = {
      text: optionalText(params, "text", 1_000) ?? null,
      textGone: optionalText(params, "textGone", 1_000) ?? null,
      selector: optionalText(params, "selector", 1_000) ?? null,
      url: optionalText(params, "url", 2_048) ?? null,
    };
    if (Object.values(conditions).every((value) => value === null)) {
      throw new BrowserToolError("wait needs at least one of text, textGone, selector or url.");
    }
    const timeoutMs = timeoutFrom(params["timeoutMs"]);
    const expression = `(() => { const c = ${JSON.stringify(conditions)}; const body = document.body ? document.body.innerText : ""; return (c.text === null || body.includes(c.text)) && (c.textGone === null || !body.includes(c.textGone)) && (c.selector === null || document.querySelector(c.selector) !== null) && (c.url === null || location.href.includes(c.url)); })()`;
    const started = Date.now();
    for (;;) {
      let met = false;
      try {
        const result = await instance.connection.send("Runtime.evaluate", { expression, returnByValue: true }, tab.session, 5_000);
        if (isRecord(result["exceptionDetails"])) {
          const message = exceptionText(result["exceptionDetails"]);
          if (/selector/iu.test(message)) throw new BrowserToolError(`selector is not valid CSS: ${message}`);
        } else {
          met = isRecord(result["result"]) && result["result"]["value"] === true;
        }
      } catch (error) {
        if (error instanceof BrowserToolError) throw error;
        // The document is being replaced; poll the next one.
      }
      if (met) return `Waited ${Date.now() - started} ms until the condition was met.`;
      if (Date.now() - started >= timeoutMs || instance.connection.closed) {
        const wanted = Object.entries(conditions).filter(([, value]) => value !== null).map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(", ");
        throw new BrowserToolError(`Timed out after ${timeoutMs} ms waiting for ${wanted}.`, 408);
      }
      await delay(150);
    }
  }

  async #act(owner: string, params: Record<string, unknown>): Promise<BrowserToolResult> {
    const kind = params["kind"];
    if (typeof kind !== "string" || !(BROWSER_ACT_KINDS as readonly string[]).includes(kind)) {
      throw new BrowserToolError(`act needs kind: ${BROWSER_ACT_KINDS.join(", ")}.`);
    }
    const dialog = params["dialog"];
    if (dialog !== undefined && dialog !== "accept" && dialog !== "dismiss") throw new BrowserToolError("dialog must be accept or dismiss.");
    const tab = this.#tabFor(owner, params["tabId"]);
    const instance = this.#live();
    const timeoutMs = timeoutFrom(params["timeoutMs"]);
    tab.dialogs = [];
    tab.dialogPolicy = dialog;
    const popups: string[] = [];
    const offPopups = instance.connection.on((event) => {
      if (event.sessionId || event.method !== "Target.targetCreated" || !isRecord(event.params["targetInfo"])) return;
      if (str(event.params["targetInfo"]["openerId"]) === tab.targetId) popups.push(str(event.params["targetInfo"]["targetId"]));
    });
    const watch = this.#watch(instance, tab);
    let summary: string;
    let outcome: NavigationOutcome = { navigated: false, loaded: true, sameDocument: false };
    try {
      const performed = await this.#perform(instance, tab, kind as BrowserActKind, params);
      summary = performed.text;
      this.#emitAction(tab, summary.replace(/\.$/u, ""), performed.point);
      if (kind !== "wait" && (await watch.started(NAVIGATION_START_MS))) {
        const loaded = await watch.settled(timeoutMs);
        outcome = { navigated: true, loaded, sameDocument: watch.state.sameDocument && !watch.state.loader };
      }
    } finally {
      watch.dispose();
      offPopups();
      tab.dialogPolicy = undefined;
      void instance.connection.send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP }, tab.session).catch(() => undefined);
    }
    await this.#refreshInfo(instance, tab);
    const lines = [summary, this.#header(tab)];
    const blocked = this.#blockedLine(tab);
    if (blocked) lines.push(blocked);
    if (outcome.navigated && outcome.sameDocument) lines.push("The URL changed within the page; existing refs still apply.");
    else if (outcome.navigated && outcome.loaded) lines.push("The page navigated; refs from the previous page no longer apply. Take a new snapshot.");
    else if (outcome.navigated) lines.push("A navigation started but the page was still loading when the timeout elapsed.");
    if (tab.dialogs.length) lines.push(`Dialogs: ${tab.dialogs.join("; ")}.`);
    for (const targetId of popups) {
      const opened = this.#byTarget.get(targetId);
      lines.push(opened ? `New tab ${opened.id} opened. Use focus with tabId ${opened.id} to work in it.` : "A new tab opened; call tabs to see it.");
    }
    return {
      text: lines.join("\n"),
      details: { action: "act", kind, tab: this.#tabDetails(tab), navigated: outcome.navigated, ...(tab.dialogs.length ? { dialogs: tab.dialogs } : {}) },
    };
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async #text(owner: string, params: Record<string, unknown>): Promise<BrowserToolResult> {
    const tab = this.#tabFor(owner, params["tabId"]);
    const instance = this.#live();
    const selector = optionalText(params, "selector", 1_000);
    const maxChars = typeof params["maxChars"] === "number" && Number.isFinite(params["maxChars"])
      ? Math.min(TEXT_MAX_CHARS, Math.max(100, Math.floor(params["maxChars"])))
      : TEXT_DEFAULT_CHARS;
    const expression = `(() => { const selector = ${JSON.stringify(selector ?? null)}; const root = selector ? document.querySelector(selector) : (document.querySelector("article") || document.querySelector("main, [role=main]") || document.body); return root ? { found: true, text: root.innerText || "" } : { found: false, text: "" }; })()`;
    const result = await instance.connection.send("Runtime.evaluate", { expression, returnByValue: true }, tab.session);
    if (isRecord(result["exceptionDetails"])) throw new BrowserToolError(`selector is not valid CSS: ${exceptionText(result["exceptionDetails"])}`);
    const value = isRecord(result["result"]) && isRecord(result["result"]["value"]) ? result["result"]["value"] : {};
    if (value["found"] !== true) throw new BrowserToolError(`No element matches ${selector}.`, 404);
    const full = str(value["text"]).replace(/\n{3,}/gu, "\n\n").trim();
    const truncated = full.length > maxChars;
    await this.#refreshInfo(instance, tab);
    const lines = [this.#header(tab), "", truncated ? full.slice(0, maxChars) : full || "(No visible text.)"];
    if (truncated) lines.push(`[Text truncated at ${maxChars} of ${full.length} characters. Use selector or a larger maxChars.]`);
    return { text: lines.join("\n"), details: { action: "text", tab: this.#tabDetails(tab), characters: full.length, truncated } };
  }

  async #screenshot(owner: string, params: Record<string, unknown>, cwd: string): Promise<BrowserToolResult> {
    const tab = this.#tabFor(owner, params["tabId"]);
    const instance = this.#live();
    const connection = instance.connection;
    const savePath = params["path"] === undefined ? undefined : screenshotPath(cwd, params["path"]);
    // Only a visible tab paints.
    await this.#ensureVisible(instance, tab);
    let region: Record<string, number> | undefined;
    let subject = "viewport";
    if (params["ref"] !== undefined) {
      const { target, label } = this.#target(tab, params["ref"]);
      const quad = await this.#box(instance, tab, target.backendNodeId, label);
      const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
      const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
      const metrics = await connection.send("Page.getLayoutMetrics", {}, tab.session);
      const layout = isRecord(metrics["cssLayoutViewport"]) ? metrics["cssLayoutViewport"] : {};
      region = {
        x: Math.min(...xs) + num(layout["pageX"]), y: Math.min(...ys) + num(layout["pageY"]),
        width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)), scale: 1,
      };
      subject = label;
    } else if (params["fullPage"] === true) {
      const metrics = await connection.send("Page.getLayoutMetrics", {}, tab.session);
      const content = isRecord(metrics["cssContentSize"]) ? metrics["cssContentSize"] : {};
      region = {
        x: 0, y: 0, scale: 1,
        width: Math.max(1, Math.min(Math.ceil(num(content["width"])), MAX_FULL_PAGE.width)),
        height: Math.max(1, Math.min(Math.ceil(num(content["height"])), MAX_FULL_PAGE.height)),
      };
      subject = "full page";
    }
    const capture = async (format: "png" | "jpeg") => str((await connection.send("Page.captureScreenshot", {
      format, ...(format === "jpeg" ? { quality: 75 } : {}), ...(region ? { clip: region, captureBeyondViewport: true } : {}),
    }, tab.session, 60_000))["data"]);
    const png = await capture("png");
    const bytes = Buffer.from(png, "base64");
    if (savePath) {
      await mkdir(dirname(savePath), { recursive: true });
      await writeFile(savePath, bytes);
    }
    let image = { data: png, mimeType: "image/png" };
    if (bytes.length > MAX_IMAGE_BYTES) image = { data: await capture("jpeg"), mimeType: "image/jpeg" };
    if (Buffer.byteLength(image.data, "base64") > MAX_IMAGE_BYTES) {
      throw new BrowserToolError("The screenshot is too large to return. Capture the viewport or one element ref instead.", 413);
    }
    await this.#refreshInfo(instance, tab);
    const size = pngSize(bytes);
    const lines = [
      `Screenshot of the ${subject}${size ? ` (${size.width}×${size.height})` : ""}.`,
      this.#header(tab),
      ...(savePath ? [`Saved to ${savePath}; use present_media to show it in HUI.`] : []),
    ];
    return {
      text: lines.join("\n"),
      image,
      details: { action: "screenshot", tab: this.#tabDetails(tab), ...(size ?? {}), bytes: bytes.length, ...(savePath ? { path: savePath } : {}) },
    };
  }

  #console(owner: string, params: Record<string, unknown>): BrowserToolResult {
    const tab = this.#tabFor(owner, params["tabId"]);
    const errorsOnly = params["errorsOnly"] === true;
    const entries = tab.console.filter((entry) => !errorsOnly || entry.level === "error" || entry.level === "warning" || entry.level === "assert");
    const recent = entries.slice(-50);
    const lines = [this.#header(tab)];
    if (entries.length > recent.length) lines.push(`Showing the latest 50 of ${entries.length} entries.`);
    lines.push("", recent.length
      ? recent.map((entry) => `[${entry.level}] ${entry.text}`).join("\n")
      : errorsOnly ? "No errors or warnings recorded." : "No console messages recorded.");
    if (params["clear"] === true) tab.console = [];
    return { text: lines.join("\n"), details: { action: "console", tab: this.#tabDetails(tab), entries: entries.length } };
  }

  /** Resolves after the page has laid out and painted twice, so the next
   * snapshot or screenshot reflects a change that applies on the next frame. */
  async #nextFrames(instance: Instance, tab: Tab): Promise<void> {
    await instance.connection.send("Runtime.evaluate", {
      expression: "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))",
      awaitPromise: true, returnByValue: true,
    }, tab.session, 5_000).catch(() => undefined);
  }

  async #resize(owner: string, params: Record<string, unknown>): Promise<BrowserToolResult> {
    const tab = this.#tabFor(owner, params["tabId"]);
    const instance = this.#live();
    const { width, height } = params;
    if (width === undefined && height === undefined) {
      if (instance.headless) {
        await instance.connection.send("Emulation.setDeviceMetricsOverride", { ...this.#window, deviceScaleFactor: 1, mobile: false }, tab.session);
      } else {
        await instance.connection.send("Emulation.clearDeviceMetricsOverride", {}, tab.session);
      }
      await this.#nextFrames(instance, tab);
      return { text: `Restored the default viewport of tab ${tab.id}.`, details: { action: "resize", tab: this.#tabDetails(tab) } };
    }
    const valid = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 200 && value <= 4_096;
    if (!valid(width) || !valid(height)) throw new BrowserToolError("width and height must both be integers from 200 to 4096.");
    await this.#ensureVisible(instance, tab);
    await instance.connection.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, tab.session);
    await this.#nextFrames(instance, tab);
    return {
      text: `The viewport of tab ${tab.id} is now ${width}×${height}. Take a new snapshot or screenshot to see the layout.`,
      details: { action: "resize", tab: this.#tabDetails(tab), width, height },
    };
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  #statusResult(owner: string, settings: BrowserSettings): BrowserToolResult {
    const instance = this.#instance;
    const tabs = this.#ownerTabs(owner);
    const current = this.#current.get(owner);
    const lines = [instance
      ? `The managed browser is running ${instance.headless ? "headless" : "in a visible window"} (${instance.executable.name}, ${instance.version}).`
      : `The managed browser is stopped; open starts it ${settings.headless ? "headless" : "in a visible window"}.`];
    lines.push(tabs.length
      ? `Tabs in this conversation: ${tabs.map((tab) => `${tab.id}${tab.id === current ? " (current)" : ""}`).join(", ")}.`
      : "No tabs are open in this conversation.");
    return {
      text: lines.join("\n"),
      details: { action: "status", running: instance !== undefined, ...(instance ? { mode: instance.headless ? "headless" : "windowed" } : {}), tabs: tabs.length },
    };
  }

  async #tabsResult(owner: string): Promise<BrowserToolResult> {
    if (this.#instance) await this.#refreshAll(this.#instance);
    const tabs = this.#ownerTabs(owner);
    const current = this.#current.get(owner);
    return {
      text: tabs.length
        ? tabs.map((tab) => `${tab.id}${tab.id === current ? " (current)" : ""} · ${clip(tab.title || "Untitled", 120)} — ${clip(tab.url, 300)}${tab.blocked ? " (blocked: not in the allowed origins)" : ""}`).join("\n")
        : "No tabs are open in this conversation. Call open with a URL.",
      details: { action: "tabs", tabs: tabs.map((tab) => this.#tabDetails(tab)) },
    };
  }

  async #close(owner: string, params: Record<string, unknown>): Promise<BrowserToolResult> {
    const tab = this.#tabFor(owner, params["tabId"]);
    const instance = this.#instance;
    if (instance) await this.#capture(instance, tab, true);
    this.#drop(tab.targetId);
    if (instance) await instance.connection.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => undefined);
    const current = this.#current.get(owner);
    return {
      text: `Closed tab ${tab.id}.${current ? ` The current tab is now ${current}.` : " No tabs remain open in this conversation."}`,
      details: { action: "close", closed: tab.id },
    };
  }
}
