import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import * as sessionsApi from "./api/sessions.ts";
import type { RuntimeCompaction, RuntimeQuestion, SessionGroup, SessionView } from "./api/sessions.ts";
import type { ComposerController } from "./controllers/composer-controller.ts";
import type { ConversationController } from "./controllers/conversation-controller.ts";
import type { SessionsController } from "./controllers/sessions-controller.ts";
import type { WorkLayoutController } from "./controllers/work-layout-controller.ts";
import type { PanePresentation } from "./components/session-multiplexer.ts";
import { NEW_SESSION_DRAFT_KEY, sessionDraftKey } from "./lib/composer/drafts.ts";
import { singleSessionLayout, type SessionPane } from "./lib/session/multiplexer.ts";
import type { HomeProps } from "./views/home.ts";
import { closeDrawerOnEscape } from "./views/shell.ts";
import { HuiApp } from "./hui-app.ts";

const api = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const textarea = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("./api/sessions.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api/sessions.ts")>(),
  renameSession: async (...args: unknown[]) => {
    api.calls.push(["renameSession", ...args]);
    return new Promise(() => {});
  },
  resumeSession: async (...args: unknown[]) => {
    api.calls.push(["resumeSession", ...args]);
    return new Promise(() => {});
  },
}));

vi.mock("./lib/composer/textarea.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/composer/textarea.ts")>(),
  observeTextareaOverflow: (element: { id: string }) => textarea.calls.push(`observe ${element.id}`),
  disconnectTextareaOverflowObserver: (element: { id: string }) => textarea.calls.push(`disconnect ${element.id}`),
  scheduleTextareaHeightAdjustment: (element: { id: string }) => textarea.calls.push(`measure ${element.id}`),
}));

type Shell = {
  embeddedPane: boolean;
  paneVisible: boolean;
  paneSession: SessionView | undefined;
  paneMobileNav: boolean;
  paneActive: boolean;
  onPaneDraftChange: ((sessionId: string, hasDraft: boolean) => void) | undefined;
  onPaneNavigate: ((id: string) => void) | undefined;
  renderRoot: { querySelector: (selector: string) => unknown };
  settingsOpen: boolean;
  pendingSessionId: string;
  renamingFor: string;
  autoFollow: boolean;
  groupAction: unknown;
  composer: ComposerController;
  conversation: ConversationController;
  sessions: SessionsController;
  work: WorkLayoutController;
  connectedCallback: () => void;
  scheduleUpdate: () => void;
  updated: (changed: Map<string, unknown>) => void;
  render: () => unknown;
  renderSessionPane: (pane: SessionPane, state: PanePresentation) => unknown;
  renderSessionMultiplex: () => unknown;
  renderGroupActionDialog: () => unknown;
  homeProps: () => HomeProps;
  navigate: (target: { kind: "session"; id: string }) => void;
  applyNavigation: (target: { kind: "session"; id: string }) => void;
  openPendingSession: () => void;
  activateSession: (session: SessionView) => void;
  activePaneApp: () => { handleGlobalEscape: (event: KeyboardEvent) => void } | undefined;
  onGlobalKeyDown: (event: KeyboardEvent) => void;
  handleGlobalEscape: (event: KeyboardEvent) => void;
  handleSystemBack: () => boolean;
  closeSettings: () => void;
  scrollToBottom: () => void;
  showEarlierRows: (start: number) => Promise<void>;
  transcriptWindowStart: number | undefined;
  continueRun: () => void;
  rename: (title: string) => void;
};

const shell = () => new HuiApp() as unknown as Shell;
const session = (id: string, extra: Partial<SessionView> = {}) => ({ id, title: "Build", status: "idle", ...extra }) as SessionView;
const pane = { id: "pane-1", sessionId: "s1" };
const presented = { active: true, visible: true, narrow: false, split: true };

function bindings(template: unknown): Map<string, unknown> {
  const { strings, values } = template as { strings: readonly string[]; values: unknown[] };
  return new Map(values.map((value, i) => [strings[i]!.match(/(\S+)=$/u)?.[1] ?? `\${${i}}`, value]));
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + text(template.values[i])).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function template(value: unknown, marker: string): unknown {
  if (Array.isArray(value)) return value.map((item) => template(item, marker)).find(Boolean);
  if (!value || typeof value !== "object" || !("strings" in value) || !("values" in value)) return undefined;
  const { strings, values } = value as { strings: readonly string[]; values: unknown[] };
  return strings.join("").includes(marker) ? value : values.map((item) => template(item, marker)).find(Boolean);
}

function escape() {
  const event = { key: "Escape", defaultPrevented: false, isComposing: false, composedPath: () => [], preventDefault: () => { event.defaultPrevented = true; } };
  return event as unknown as KeyboardEvent & { defaultPrevented: boolean };
}

beforeEach(() => {
  api.calls = [];
  textarea.calls = [];
  vi.stubGlobal("document", { querySelector: () => null, querySelectorAll: () => [] });
  vi.stubGlobal("HTMLDialogElement", class {});
});

test("the shell hands a split pane its registry entry, so the pane opens without its own fetch", () => {
  const app = shell();
  const listed = session("s1");
  app.sessions.groups = [{ name: "Frontend", sessions: [listed] } as unknown as SessionGroup];
  assert.equal(bindings(app.renderSessionPane(pane, presented)).get(".paneSession"), listed);
});

test("a pane opens its session from the entry the shell handed it", () => {
  const app = shell();
  const opened: SessionView[] = [];
  app.activateSession = (target) => opened.push(target);
  app.embeddedPane = true;
  app.paneSession = session("s1");
  app.pendingSessionId = "s1";
  app.openPendingSession();
  assert.deepEqual(opened, [app.paneSession]);
});

test("the shell marks a split pane's reported draft on its own sidebar", () => {
  const app = shell();
  (bindings(app.renderSessionPane(pane, presented)).get(".onPaneDraftChange") as (sessionId: string, hasDraft: boolean) => void)("s1", true);
  assert.deepEqual([...app.composer.draftSessionIds], ["s1"]);
});

test("only an embedded pane reports its drafts to the shell that owns the sidebar", async () => {
  for (const embeddedPane of [true, false]) {
    const app = shell();
    const reported: string[] = [];
    app.embeddedPane = embeddedPane;
    app.onPaneDraftChange = (sessionId, hasDraft) => reported.push(`${sessionId}:${hasDraft}`);
    await app.composer.persistDraft(sessionDraftKey("s1"), "draft", []);
    assert.deepEqual(reported, embeddedPane ? ["s1:true"] : []);
  }
});

test("returning to the still-selected session restores its composer draft key", () => {
  // New session keeps `selected` but switches the composer to the new-session
  // draft. Without this, typing after returning persisted under the wrong key
  // and the row never showed its pencil. The restored draft is composer-controller.test.ts's.
  const app = shell();
  app.conversation.select(session("s1"));
  app.composer.switchDraft(NEW_SESSION_DRAFT_KEY);
  app.applyNavigation({ kind: "session", id: "s1" });
  assert.equal(app.composer.draftKey, sessionDraftKey("s1"));
  assert.equal(app.pendingSessionId, "");
});

test("Escape on the shell's frame closes the mobile drawer", () => {
  const app = shell();
  app.renderRoot = { querySelector: () => null };
  assert.equal(bindings(template(app.render(), 'class="shell app-shell')).get("@keydown"), closeDrawerOnEscape);
});

test("document-level Escape closes Settings or stops the running turn", () => {
  const app = shell();
  app.renderRoot = { querySelector: () => null };
  let closed = 0;
  app.closeSettings = () => { closed += 1; };
  app.settingsOpen = true;
  const event = escape();
  app.onGlobalKeyDown(event);
  assert.equal(closed, 1);
  assert.equal(event.defaultPrevented, true);

  const embedded = shell();
  embedded.renderRoot = { querySelector: () => null };
  let aborted = 0;
  embedded.composer.abort = () => { aborted += 1; };
  embedded.embeddedPane = true;
  embedded.conversation.select(session("s1"));
  embedded.conversation.streaming = true;
  const stop = escape();
  embedded.handleGlobalEscape(stop);
  assert.equal(aborted, 1);
  assert.equal(stop.defaultPrevented, true);
  embedded.conversation.stopping = true;
  embedded.handleGlobalEscape(escape());
  assert.equal(aborted, 1);
});

test("Escape and a back press close the same overlays, and only Escape stops the turn", () => {
  // A turn is not an overlay: the app that shows it keeps it running on a back press and stops it on Escape.
  const app = shell();
  app.renderRoot = { querySelector: () => null };
  app.embeddedPane = true;
  app.conversation.select(session("s1"));
  let aborted = 0;
  app.composer.abort = () => { aborted += 1; };
  app.conversation.streaming = true;
  assert.equal(app.handleSystemBack(), false, "a bare conversation has nothing for a press to close");
  assert.equal(aborted, 0, "a back press never stops a running turn");
  assert.equal(app.handleSystemBack(), false, "and again: nothing changed, so the press is still the shell's");
  assert.equal(aborted, 0);

  const stop = escape();
  app.handleGlobalEscape(stop);
  assert.equal(aborted, 1, "Escape still stops it");
  assert.equal(stop.defaultPrevented, true);

  let closed = 0;
  app.closeSettings = () => { closed += 1; };
  app.settingsOpen = true;
  app.conversation.streaming = false;
  assert.equal(app.handleSystemBack(), true, "back closes Settings, the way Escape does");
  assert.equal(closed, 1);

  // The side chat used to sit between Settings and the turn; it is a Work view now, and the test after this one proves a
  // shown Work pane is what a back press closes under Settings.
});

test("a dialog is the topmost thing either press closes, and only the one on top", () => {
  const app = shell();
  app.settingsOpen = true;
  app.closeSettings = () => { throw new Error("a dialog closed first"); };
  const closed: string[] = [];
  const dialog = (id: string, takesItself: boolean) => ({
    dispatchEvent: () => takesItself,
    close: () => closed.push(id),
  });
  // The last open dialog is the one on top: the press goes to it and nothing underneath it moves.
  vi.stubGlobal("document", { querySelector: () => null, querySelectorAll: () => [dialog("under", true), dialog("top", true)] });
  assert.equal(app.handleSystemBack(), true);
  assert.deepEqual(closed, ["top"]);

  // A dialog that answers its own `cancel` keeps its closing in flight.
  vi.stubGlobal("document", { querySelector: () => null, querySelectorAll: () => [dialog("self-closing", false)] });
  assert.equal(app.handleSystemBack(), true, "the press is still consumed");
  assert.deepEqual(closed, ["top"], "nothing else closes it on the page's behalf");
});

test("a back press on a phone closes the narrow drawer before it closes the pane", () => {
  const app = shell();
  app.conversation.select(session("s1"));
  app.work.narrow = true;
  app.work.narrowShown = true;
  const left: string[] = [];
  app.work.leave = () => { left.push("pane"); };
  const drawer = { dataset: { open: "true" } as DOMStringMap, querySelector: () => null } as unknown as HTMLElement;
  vi.stubGlobal("matchMedia", () => ({ matches: true }) as MediaQueryList);
  app.renderRoot = { querySelector: (selector: string) => (selector === '.sidebar[data-open="true"]' ? drawer : null) } as unknown as Shell["renderRoot"];
  assert.equal(app.handleSystemBack(), true);
  assert.equal(drawer.dataset.open, "false", "the drawer is what a back press closes first");
  assert.deepEqual(left, [], "the pane waits for the next press");
  app.renderRoot = { querySelector: () => null } as unknown as Shell["renderRoot"];
  assert.equal(app.handleSystemBack(), true);
  assert.deepEqual(left, ["pane"]);
});

test("embedded panes omit global monitors and delegate routing and Escape", () => {
  const app = shell();
  const started: string[] = [];
  app.sessions.start = () => started.push("sessions");
  app.scheduleUpdate = () => {};
  app.embeddedPane = true;
  vi.stubGlobal("window", { addEventListener: () => {} });
  app.connectedCallback();
  assert.deepEqual(started, []);

  const routed: string[] = [];
  app.onPaneNavigate = (id) => routed.push(id);
  app.navigate({ kind: "session", id: "s2" });
  assert.deepEqual(routed, ["s2"]);

  const host = shell();
  host.renderRoot = { querySelector: () => null };
  const delegated: KeyboardEvent[] = [];
  host.activePaneApp = () => ({ handleGlobalEscape: (event) => delegated.push(event) });
  host.conversation.select(session("s1"));
  const event = escape();
  host.onGlobalKeyDown(event);
  assert.deepEqual(delegated, [event]);

  app.paneMobileNav = true;
  app.paneActive = false;
  assert.equal(app.homeProps().mobileNavLayout, false);
  app.paneActive = true;
  assert.equal(app.homeProps().mobileNavLayout, true);
});

test("the narrow panel selector is the shared HUI picker, not a native select of the shell's", () => {
  const app = shell();
  app.conversation.select(session("s1"));
  app.work.layout = singleSessionLayout("s1");
  const multiplex = text(app.renderSessionMultiplex());
  assert.match(multiplex, /hui-panel-selector/u);
  assert.doesNotMatch(multiplex, /<select/u);
});

test("a group's default directory uses the themed combobox instead of a native datalist", () => {
  const app = shell();
  app.groupAction = { action: "defaults", group: { name: "Frontend", label: "Frontend", sessions: [] } };
  const dialog = text(app.renderGroupActionDialog());
  assert.match(dialog, /id=group-default-cwd [^>]*role="combobox"/u);
  assert.doesNotMatch(dialog, /<datalist/u);
});

test("Configure default prefix opens Settings → Worktrees at the branch prefix", () => {
  const app = shell();
  const opened: unknown[] = [];
  (app as unknown as EventTarget).dispatchEvent = (event: Event) => {
    opened.push((event as CustomEvent).detail);
    return true;
  };
  app.homeProps().onOpenBranchPrefixSettings();
  assert.deepEqual(opened, [{ page: "worktrees", section: "branch-prefix" }]);
});

test("Continue without a prompt resumes the selected session; no rewind checkpoints are loaded", () => {
  const app = shell();
  app.conversation.select(session("s1"));
  app.continueRun();
  assert.deepEqual(api.calls, [["resumeSession", "s1"]]);
  assert.equal("loadSessionCheckpoints" in sessionsApi, false);
});

test("renaming the selected session sends only its new title", () => {
  const app = shell();
  app.conversation.select(session("s1", { title: "Old" }));
  app.renamingFor = "s1";
  app.rename("New");
  assert.deepEqual(api.calls, [["renameSession", "s1", { title: "New" }]]);
});

test("the composer textarea is observed, remeasured when code replaces its draft, and released", () => {
  const app = shell();
  let current: { id: string } | null = { id: "first" };
  app.embeddedPane = true;
  app.renderRoot = { querySelector: (selector) => selector === ".agent-chat__composer-combobox > textarea" ? current : null };
  app.updated(new Map());
  assert.deepEqual(textarea.calls, ["observe first", "measure first"]);
  app.updated(new Map());
  app.composer.setDraft("replaced");
  app.updated(new Map());
  assert.deepEqual(textarea.calls.slice(2), ["measure first"]);
  current = null;
  app.updated(new Map());
  assert.deepEqual(textarea.calls.slice(3), ["disconnect first"]);
});

test("showing earlier rows preserves the retained row's fractional position, including native scroll anchoring", async () => {
  for (const nativeAdjustment of [0, 239.375]) {
    let insertedHeight = 0;
    class Scroller {
      scrollTop = 14.25;
      get scrollHeight() { return Math.round(1000.125 + insertedHeight); }
      querySelector() { return row; }
    }
    const scroller = new Scroller();
    const row = { querySelector: () => null, getBoundingClientRect: () => ({ top: 152.375 + insertedHeight - scroller.scrollTop }) };
    vi.stubGlobal("HTMLElement", Scroller);
    const app = shell();
    app.renderRoot = { querySelector: () => scroller };
    let finishUpdate!: (value: boolean) => void;
    Object.defineProperty(app, "updateComplete", { value: new Promise<boolean>((resolve) => { finishUpdate = resolve; }) });
    const before = row.getBoundingClientRect().top;
    const expanding = app.showEarlierRows(0);
    assert.equal(app.autoFollow, false);
    assert.equal(app.transcriptWindowStart, 0);
    assert.equal(scroller.scrollTop, 14.25);
    insertedHeight = 239.375;
    scroller.scrollTop += nativeAdjustment;
    finishUpdate(true);
    await expanding;
    assert.equal(row.getBoundingClientRect().top, before);
    assert.equal(scroller.scrollTop, 253.625);
  }
});

test("showing earlier rows chooses the closest position within the retained pixel when an engine quantizes scroll offsets", async () => {
  const cases = [
    { quantize: Math.trunc, height: 169.6875, offset: 170 },
    // Offset 169 is closer but moves 121.3125 to 121.5, crossing the rendered pixel.
    { quantize: Math.round, height: 169.1875, offset: 170 },
    { quantize: (value: number) => Math.round(value * 4) / 4, height: 169.1875, offset: 169.25 },
    { quantize: (value: number) => Math.trunc(value * 2) / 2, height: 169.875, offset: 170 },
    // A scaled integer engine can return a non-integral floating-point readback.
    { quantize: (value: number) => Math.trunc(value) * (1 - Number.EPSILON), height: 169.6875, offset: 170 * (1 - Number.EPSILON) },
    { quantize: (value: number) => Math.trunc(value * 64) / 64, height: 169.7, offset: 169.703125 },
  ];
  for (const { quantize, height, offset } of cases) {
    let insertedHeight = 0;
    let geometryReads = 0;
    class Scroller {
      #scrollTop = 0;
      scrollHeight = 2000;
      clientHeight = 600;
      get scrollTop() { return this.#scrollTop; }
      set scrollTop(value: number) { this.#scrollTop = quantize(value); }
      querySelector() { return row; }
    }
    const scroller = new Scroller();
    const row = {
      querySelector: () => null,
      getBoundingClientRect: () => { geometryReads++; return { top: 121.3125 + insertedHeight - scroller.scrollTop }; },
    };
    vi.stubGlobal("HTMLElement", Scroller);
    const app = shell();
    app.renderRoot = { querySelector: () => scroller };
    Object.defineProperty(app, "updateComplete", { get: () => { insertedHeight = height; return Promise.resolve(true); } });
    await app.showEarlierRows(0);
    const after = row.getBoundingClientRect().top;
    assert.equal(Math.round(after), Math.round(121.3125));
    assert.equal(scroller.scrollTop, offset);
    assert.equal(after, 121.3125 + height - offset);
    assert.ok(geometryReads <= 8, `quantized correction read geometry ${geometryReads} times`);
  }
});

test("showing earlier rows preserves the rendered pixel when the nearest attainable offset crosses its boundary", async () => {
  for (const { quantize, top, height, offset, after } of [
    { quantize: Math.trunc, top: 138.484375, height: 170.078125, offset: 171, after: 137.5625 },
    { quantize: (value: number) => Math.trunc(value * 4) / 4, top: 138.484375, height: 170.078125, offset: 170.25, after: 138.3125 },
    { quantize: Math.round, top: 138.515625, height: 169.875, offset: 169, after: 139.390625 },
    { quantize: Math.round, top: 138.5, height: 169.5, offset: 169, after: 139 },
  ]) {
    let insertedHeight = 0;
    let geometryReads = 0;
    class Scroller {
      #scrollTop = 0;
      scrollHeight = 2000;
      get scrollTop() { return this.#scrollTop; }
      set scrollTop(value: number) { this.#scrollTop = quantize(value); }
      querySelector() { return row; }
    }
    const scroller = new Scroller();
    const content = {
      getClientRects: () => [{}],
      getBoundingClientRect: () => { geometryReads++; return { top: top + insertedHeight - scroller.scrollTop }; },
    };
    const row = { querySelector: () => content };
    vi.stubGlobal("HTMLElement", Scroller);
    const app = shell();
    app.renderRoot = { querySelector: () => scroller };
    Object.defineProperty(app, "updateComplete", { get: () => { insertedHeight = height; return Promise.resolve(true); } });
    await app.showEarlierRows(0);
    const actual = content.getBoundingClientRect().top;
    assert.equal(Math.round(actual), Math.round(top));
    assert.equal(actual, after);
    assert.equal(scroller.scrollTop, offset);
    assert.ok(geometryReads <= 8, `pixel-preserving correction read geometry ${geometryReads} times`);
  }
});

test("showing earlier rows falls back to the closest measured position when the original pixel is unattainable", async () => {
  let insertedHeight = 0;
  let geometryReads = 0;
  class Scroller {
    #scrollTop = 0;
    scrollHeight = 2000;
    get scrollTop() { return this.#scrollTop; }
    set scrollTop(value: number) { this.#scrollTop = Math.trunc(value / 2) * 2; }
    querySelector() { return row; }
  }
  const scroller = new Scroller();
  const content = {
    getClientRects: () => [{}],
    getBoundingClientRect: () => { geometryReads++; return { top: 138.484375 + insertedHeight - scroller.scrollTop }; },
  };
  const row = { querySelector: () => content };
  vi.stubGlobal("HTMLElement", Scroller);
  const app = shell();
  app.renderRoot = { querySelector: () => scroller };
  Object.defineProperty(app, "updateComplete", { get: () => { insertedHeight = 170.078125; return Promise.resolve(true); } });
  await app.showEarlierRows(0);
  assert.equal(scroller.scrollTop, 170);
  assert.equal(content.getBoundingClientRect().top, 138.5625);
  assert.equal(Math.round(content.getBoundingClientRect().top), 139);
  assert.ok(geometryReads <= 8, `fallback correction read geometry ${geometryReads} times`);
});

test("showing earlier rows preserves retained text when the group's internal offset changes", async () => {
  let inserted = false;
  class Scroller {
    scrollTop = 0;
    querySelector() { return row; }
  }
  const scroller = new Scroller();
  const content = { getClientRects: () => [{}], getBoundingClientRect: () => ({ top: 138.3125 + (inserted ? 170.25 : 0) - scroller.scrollTop }) };
  const row = {
    querySelector: () => content,
    getBoundingClientRect: () => ({ top: 121.3125 + (inserted ? 169.6875 : 0) - scroller.scrollTop }),
  };
  vi.stubGlobal("HTMLElement", Scroller);
  const app = shell();
  app.renderRoot = { querySelector: () => scroller };
  Object.defineProperty(app, "updateComplete", { get: () => { inserted = true; return Promise.resolve(true); } });
  await app.showEarlierRows(0);
  assert.equal(content.getBoundingClientRect().top, 138.3125);
  assert.equal(scroller.scrollTop, 170.25);
});

test("showing earlier rows reads the native-anchored offset after the layout that applies it", async () => {
  let inserted = false;
  let pendingAnchor = false;
  class Scroller {
    scrollTop = 0;
    querySelector() { return row; }
  }
  const scroller = new Scroller();
  const row = {
    querySelector: () => null,
    getBoundingClientRect: () => {
      if (pendingAnchor) { scroller.scrollTop += 239.375; pendingAnchor = false; }
      return { top: 138.3125 + (inserted ? 239.375 : 0) - scroller.scrollTop };
    },
  };
  vi.stubGlobal("HTMLElement", Scroller);
  const app = shell();
  app.renderRoot = { querySelector: () => scroller };
  Object.defineProperty(app, "updateComplete", { get: () => { inserted = pendingAnchor = true; return Promise.resolve(true); } });
  await app.showEarlierRows(0);
  assert.equal(row.getBoundingClientRect().top, 138.3125);
  assert.equal(scroller.scrollTop, 239.375);
});

test("showing earlier rows falls back to the visible row when its text is folded", async () => {
  let inserted = false;
  class Scroller {
    scrollTop = 0;
    querySelector() { return row; }
  }
  const scroller = new Scroller();
  const row = {
    querySelector: () => ({ getClientRects: () => [], getBoundingClientRect: () => ({ top: 0 }) }),
    getBoundingClientRect: () => ({ top: 138.3125 + (inserted ? 239.375 : 0) - scroller.scrollTop }),
  };
  vi.stubGlobal("HTMLElement", Scroller);
  const app = shell();
  app.renderRoot = { querySelector: () => scroller };
  Object.defineProperty(app, "updateComplete", { get: () => { inserted = true; return Promise.resolve(true); } });
  await app.showEarlierRows(0);
  assert.equal(row.getBoundingClientRect().top, 138.3125);
});

test("showing earlier rows measures the attainable fractional edge instead of rounding the maximum down", async () => {
  let inserted = false;
  class Scroller {
    #scrollTop = 0;
    scrollHeight = 2000;
    clientHeight = 600;
    get scrollTop() { return this.#scrollTop; }
    set scrollTop(value: number) { this.#scrollTop = Math.min(1400.375, Math.trunc(value * 4) / 4); }
    querySelector() { return row; }
  }
  const scroller = new Scroller();
  const row = {
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 138.3125 + (inserted ? 1400.2 : 0) - scroller.scrollTop }),
  };
  vi.stubGlobal("HTMLElement", Scroller);
  const app = shell();
  app.renderRoot = { querySelector: () => scroller };
  Object.defineProperty(app, "updateComplete", { get: () => { inserted = true; return Promise.resolve(true); } });
  await app.showEarlierRows(0);
  assert.equal(scroller.scrollTop, 1400.25);
});

test("the thread follows the live compaction divider like new transcript rows", () => {
  const app = shell();
  let follows = 0;
  app.scrollToBottom = () => { follows += 1; };
  app.renderRoot = { querySelector: () => null };
  app.updated(new Map());
  const settled = follows;
  app.updated(new Map());
  assert.equal(follows, settled);
  app.conversation.compaction = { status: "running" } as unknown as RuntimeCompaction;
  app.updated(new Map());
  assert.equal(follows, settled + 1);
  app.autoFollow = false;
  app.conversation.compaction = undefined;
  app.updated(new Map());
  assert.equal(follows, settled + 1);
});

test("the thread follows a question that arrives as its last row, unless the operator scrolled away", () => {
  const app = shell();
  let follows = 0;
  app.paneVisible = false;
  app.embeddedPane = true;
  app.scrollToBottom = () => { follows += 1; };
  app.renderRoot = { querySelector: () => null };
  app.updated(new Map());
  const settled = follows;
  app.conversation.question = { id: "q", method: "input", title: "Name?" } as unknown as RuntimeQuestion;
  app.updated(new Map());
  assert.equal(follows, settled + 1);
  // Reading earlier context keeps the reader where they are.
  app.autoFollow = false;
  app.conversation.question = { id: "q2", method: "input", title: "Email?" } as unknown as RuntimeQuestion;
  app.updated(new Map());
  assert.equal(follows, settled + 1);
});

test("an idle conversation redraws for its clocks every 30 seconds, and every 3 while a subagent runs", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { querySelector: () => null, hidden: false });
  const app = shell() as Shell & { firstUpdated: () => void; requestUpdate: () => void };
  app.embeddedPane = true;
  app.composer.switchDraft = () => {};
  app.composer.refreshDraftIndicators = () => {};
  app.conversation.transcript = [{ kind: "message", id: "m1", role: "user", text: "hello" }];
  let redraws = 0;
  app.requestUpdate = () => { redraws += 1; };
  try {
    app.firstUpdated();
    vi.advanceTimersByTime(60_000);
    assert.equal(redraws, 2);
    app.conversation.subagents = [{ taskId: "t1", status: "running" } as ConversationController["subagents"][number]];
    redraws = 0;
    vi.advanceTimersByTime(30_000);
    assert.equal(redraws, 10);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

test("the main app's bot roster redraws for its clock every 30 seconds", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { querySelector: () => null, hidden: false });
  const app = shell() as unknown as Record<string, unknown> & Shell & { firstUpdated: () => void; requestUpdate: () => void };
  const stub = (target: unknown, ...names: string[]) => { for (const name of names) (target as Record<string, unknown>)[name] = async () => {}; };
  stub(app, "refreshSessions", "loadLaunchPreferences");
  stub(app["control"], "refreshPower", "loadPreviews");
  stub(app["launcher"], "loadWorkers");
  stub(app.composer, "switchDraft", "refreshDraftIndicators");
  (app["bots"] as { tab: string }).tab = "bots";
  let redraws = 0;
  app.requestUpdate = () => { redraws += 1; };
  try {
    app.firstUpdated();
    vi.advanceTimersByTime(60_000);
    assert.equal(redraws, 2);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
