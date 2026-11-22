import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import * as sessionsApi from "./api/sessions.ts";
import type { RuntimeCompaction, RuntimeQuestion, SessionGroup, SessionView } from "./api/sessions.ts";
import type { PowerStatus } from "./api/schema/power.ts";
import type { ComposerController } from "./controllers/composer-controller.ts";
import type { ConversationController } from "./controllers/conversation-controller.ts";
import type { LaunchController } from "./controllers/launch-controller.ts";
import type { SessionsController } from "./controllers/sessions-controller.ts";
import type { SettingsController } from "./controllers/settings-controller.ts";
import type { WorkLayoutController } from "./controllers/work-layout-controller.ts";
import type { PanePresentation } from "./components/session-multiplexer.ts";
import { NEW_SESSION_DRAFT_KEY, sessionDraftKey } from "./lib/composer/drafts.ts";
import { HUI_PAGES } from "./lib/pages.ts";
import type { NavigationTarget } from "./lib/navigation.ts";
import { sessionPanes, singleSessionLayout, splitSessionPane, type SessionPane } from "./lib/session/multiplexer.ts";
import type { HomeProps, LaunchIntent } from "./views/home.ts";
import type { PowerNoticeProps } from "./views/power-notice.ts";
import { closeDrawerOnEscape } from "./views/shell.ts";
import { HuiApp } from "./hui-app.ts";

const api = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const textarea = vi.hoisted(() => ({ calls: [] as string[] }));
const powerApi = vi.hoisted(() => ({ lidAwake: [] as boolean[] }));
const launchApi = vi.hoisted(() => ({ created: [] as Record<string, unknown>[], checkouts: [] as ((checkout: unknown) => void)[] }));

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
  createSession: async (input: Record<string, unknown>) => {
    launchApi.created.push(input);
    // A worktree session is unlisted until the gateway makes its checkout, which keeps the follow-up in memory.
    return { id: "s-new", status: "idle", creating: { label: "Creating the checkout" } } as unknown as SessionView;
  },
  loadGitCheckout: () => new Promise((resolve) => launchApi.checkouts.push(resolve)),
}));

vi.mock("./lib/composer/textarea.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/composer/textarea.ts")>(),
  observeTextareaOverflow: (element: { id: string }) => textarea.calls.push(`observe ${element.id}`),
  disconnectTextareaOverflowObserver: (element: { id: string }) => textarea.calls.push(`disconnect ${element.id}`),
  scheduleTextareaHeightAdjustment: (element: { id: string }) => textarea.calls.push(`measure ${element.id}`),
}));

vi.mock("./api/control-surfaces.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api/control-surfaces.ts")>(),
  setLidAwake: async (lidAwake: boolean) => {
    powerApi.lidAwake.push(lidAwake);
    return null;
  },
}));

type Shell = {
  embeddedPane: boolean;
  paneVisible: boolean;
  paneGroups: readonly SessionGroup[] | undefined;
  paneSession: SessionView | undefined;
  paneSessionId: string;
  panePowerNotice: PowerNoticeProps | undefined;
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
  control: SettingsController;
  sessions: SessionsController;
  work: WorkLayoutController;
  launcher: LaunchController;
  launching: boolean;
  requestLaunch: (intent: LaunchIntent, form: HTMLFormElement) => void;
  connectedCallback: () => void;
  scheduleUpdate: () => void;
  updated: (changed: Map<string, unknown>) => void;
  willUpdate: (changed: Map<string, unknown>) => void;
  render: () => unknown;
  renderSessionPane: (pane: SessionPane, state: PanePresentation) => unknown;
  renderSessionMultiplex: () => unknown;
  renderGroupActionDialog: () => unknown;
  homeProps: () => HomeProps;
  navigate: (target: NavigationTarget, replace?: boolean) => void;
  syncFromLocation: () => void;
  applyNavigation: (target: NavigationTarget) => void;
  openPendingSession: () => void;
  activateSession: (session: SessionView) => void;
  activePaneApp: () => { handleGlobalEscape: (event: KeyboardEvent) => void } | undefined;
  focusActiveComposer: () => void;
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
/** Lets every promise chain already queued run, without waiting on a wall-clock delay. */
const settle = () => new Promise((resolve) => setImmediate(resolve));
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
  powerApi.lidAwake = [];
  launchApi.created = [];
  launchApi.checkouts = [];
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

const power: PowerStatus = { keepAwake: { state: "active", detail: "" }, lidAwake: { state: "active", detail: "" }, lidOn: true };

test("only the active pane's current chat is handed the sleep notice", () => {
  // `session-multiplexer.ts` renders a pane once per session it retains, all with the same pane, so the notice follows
  // the pane's presentation: a session the active pane keeps cached would draw a second copy beside the shown one.
  const app = shell();
  app.work.layout = singleSessionLayout("s1");
  app.control.power = power;
  app.control.powerNoticeDismissed = true;
  const [active] = sessionPanes(app.work.layout);
  const handed = bindings(app.renderSessionPane(active!, presented)).get(".panePowerNotice") as PowerNoticeProps;
  assert.deepEqual({ power: handed.power, dismissed: handed.dismissed }, { power, dismissed: true }, "the current state, not a default one");
  assert.equal(bindings(app.renderSessionPane(active!, { ...presented, active: false })).get(".panePowerNotice"), undefined);
  assert.equal(bindings(app.renderSessionPane({ id: "p2", sessionId: "s2" }, { ...presented, active: false })).get(".panePowerNotice"), undefined);
});

test("a failed pane lookup never focuses another pane's composer", async () => {
  // The panes' chats are children of this element's light DOM, so a fallback query reaches every pane's copy of the
  // composer and focuses the first one, not the active pane's.
  const queried: string[] = [];
  const app = shell();
  app.activePaneApp = () => undefined;
  app.renderRoot = { querySelector: (selector: string) => { queried.push(selector); return null; } } as unknown as Shell["renderRoot"];
  Object.defineProperty(app, "updateComplete", { get: () => Promise.resolve(true) });
  app.work.layout = singleSessionLayout("s1");
  app.focusActiveComposer();
  await Promise.resolve();
  assert.deepEqual(queried, [], "the split layout's composers belong to its pane apps");
  app.work.layout = undefined;
  app.focusActiveComposer();
  await Promise.resolve();
  assert.deepEqual(queried, [".agent-chat__composer-combobox > textarea"], "a chat this element renders itself is still focused");
});

test("a chat with no selected conversation is handed no sleep notice", () => {
  const app = shell();
  app.control.power = power;
  assert.equal("powerNotice" in app.homeProps(), false, "the launcher has no chat to draw it in");
  app.conversation.select(session("s1"));
  assert.equal(app.homeProps().powerNotice?.power, power);
});

test("Run status reuses the child index across streamed frames and panes until the session-list identity changes", () => {
  const app = shell();
  app.conversation.select(session("parent"));
  let parentReads = 0;
  const child = { ...session("child", { status: "running" }), get parentId() { parentReads += 1; return "parent"; } };
  const groups = [{ label: "", sessions: [child, session("other")] }];
  app.sessions.groups = groups;
  const first = app.homeProps().childSessions;
  const indexedReads = parentReads;
  assert.deepEqual(first.map(({ id }) => id), ["child"]);
  for (let frame = 0; frame < 100; frame += 1) assert.strictEqual(app.homeProps().childSessions, first);
  assert.equal(parentReads, indexedReads, "a streamed frame does not scan parent links");
  const pane = shell();
  pane.conversation.select(session("parent"));
  pane.embeddedPane = true;
  pane.paneGroups = groups;
  pane.sessions.groups = groups.map((group) => ({ ...group, sessions: [...group.sessions] }));
  assert.strictEqual(pane.homeProps().childSessions, first, "panes share the canonical registry's index despite local overlays");
  app.willUpdate(new Map());
  app.homeProps().onRunStatusPanelOpenChange(true);
  assert.equal(app.homeProps().runStatusPanelOpen, true);
  app.sessions.groups = [{ label: "", sessions: [{ ...child, status: "idle", archived: true }] }];
  app.willUpdate(new Map());
  assert.deepEqual(app.homeProps().childSessions, []);
  app.sessions.groups = groups;
  assert.equal(app.homeProps().runStatusPanelOpen, false, "restoring the last removed section starts closed");
  app.sessions.groups = [{ label: "", sessions: [] }];
  assert.deepEqual(app.homeProps().childSessions, [], "deleted children leave the next index");
  const closed = app.homeProps();
  assert.equal(closed.runStatusPanelOpen, false);
  closed.onRunStatusPanelOpenChange(true);
  assert.equal(app.homeProps().runStatusPanelOpen, true);
  closed.onRunStatusPanelOpenChange(false);
  assert.equal(app.homeProps().runStatusPanelOpen, false);
  app.willUpdate(new Map());
  closed.onRunStatusPanelOpenChange(true);
  app.conversation.opening = true;
  app.willUpdate(new Map());
  app.conversation.opening = false;
  assert.equal(app.homeProps().runStatusPanelOpen, false, "loading removes the surface without needing after-hide");
  closed.onRunStatusPanelOpenChange(true);
  app.conversation.select(session("other"));
  app.willUpdate(new Map());
  app.homeProps().onRunStatusPanelOpenChange(true);
  closed.onRunStatusPanelOpenChange(false);
  assert.equal(app.homeProps().runStatusPanelOpen, true, "an old surface's dismissal cannot change the new conversation");
  app.conversation.select(session("parent"));
  app.willUpdate(new Map());
  assert.equal(app.homeProps().runStatusPanelOpen, false, "returning draws a closed pill without child rows");
});

test("clearing a pane's last plan from another screen drops lazy rows before later children arrive", () => {
  const app = shell();
  app.embeddedPane = true;
  app.paneVisible = true;
  app.paneSessionId = "parent";
  const planned = session("parent", { progress: { markdown: "Plan", steps: [] } });
  app.conversation.select(planned);
  app.paneGroups = [{ label: "", sessions: [planned] }];
  app.willUpdate(new Map([["paneGroups", undefined]]));
  app.homeProps().onRunStatusPanelOpenChange(true);
  assert.equal(app.homeProps().runStatusPanelOpen, true);
  const previous = app.paneGroups;
  app.paneGroups = [{ label: "", sessions: [session("parent")] }];
  app.willUpdate(new Map([["paneGroups", previous]]));
  assert.equal(app.conversation.selected?.progress, undefined);
  app.paneGroups = [{ label: "", sessions: [session("parent"), session("child", { parentId: "parent" })] }];
  app.willUpdate(new Map([["paneGroups", previous]]));
  assert.equal(app.homeProps().childSessions.length, 1);
  assert.equal(app.homeProps().runStatusPanelOpen, false, "new children do not reuse the removed popover's open flag");
});

test("a pane's sleep notice dismisses and turns the lid switch off through the app that owns them", async () => {
  const host = shell();
  host.work.layout = singleSessionLayout("s1");
  host.control.power = power;
  const [active] = sessionPanes(host.work.layout);
  const handed = bindings(host.renderSessionPane(active!, presented)).get(".panePowerNotice") as PowerNoticeProps;
  const pane = shell();
  pane.embeddedPane = true;
  pane.panePowerNotice = handed;
  pane.conversation.select(session("s1"));
  const drawn = pane.homeProps().powerNotice!;
  drawn.onDismiss();
  assert.equal(host.control.powerNoticeDismissed, true, "the pane never keeps the dismissal itself");
  drawn.onTurnOff();
  assert.deepEqual(powerApi.lidAwake, [false], "the shell's control asks the gateway to stop holding the Mac awake");
  await vi.waitFor(() => assert.equal(host.control.power, null));
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

test("a shared link seeds New Session once and leaves the address canonical", () => {
  // A phone's Share sheet opens `<gateway>/new-session?share=…`; the address is canonicalised in the same sync, so the
  // seed has to be read before that rewrite and applied once, never on a later popstate or visit.
  const replaced: { state: Record<string, unknown>; url: string }[] = [];
  const history = {
    state: { navigationIndex: 7 },
    pushState: () => {},
    replaceState: (state: Record<string, unknown>, _title: string, url: string) => replaced.push({ state, url }),
  };
  const shared = "Look this post in X https://x.com/danifdz/status/1987654321098765432";
  vi.stubGlobal("window", { location: { pathname: "/new-session", search: `?share=${encodeURIComponent(shared)}`, hash: "" }, history });
  const app = shell();
  app.renderRoot = { querySelector: () => null };
  const internals = app as unknown as Record<string, unknown>;
  internals["loadLaunchPreferences"] = () => {};
  const launcher = internals["launcher"] as { requestCheckout: () => void; loadWorkers: () => void };
  launcher.requestCheckout = () => {};
  launcher.loadWorkers = () => {};
  const calls: { key: string; seed: string | undefined }[] = [];
  app.composer.switchDraft = (key, seed) => calls.push({ key, seed });
  const newSession = HUI_PAGES.find((page) => page.id === "new-session")!;

  app.syncFromLocation();
  assert.deepEqual(calls, [{ key: NEW_SESSION_DRAFT_KEY, seed: shared }]);
  assert.deepEqual(replaced.map(({ url }) => url), ["/new-session"], "the address that carried the share is canonical again");
  assert.equal(replaced[0]!.state["navigationIndex"], 7, "the rewrite keeps history.state");

  // A popstate, a notification or the first update syncing again never pastes the share a second time; neither does
  // coming back to New Session, which restores the stored (already merged) draft instead.
  app.syncFromLocation();
  app.applyNavigation({ kind: "home" });
  app.applyNavigation({ kind: "page", page: newSession });
  const reseeded = calls.filter(({ seed }) => seed !== undefined);
  assert.deepEqual(reseeded, [{ key: NEW_SESSION_DRAFT_KEY, seed: shared }], "the share reaches the composer once");
  assert.deepEqual(calls.map(({ key }) => key), [NEW_SESSION_DRAFT_KEY, NEW_SESSION_DRAFT_KEY, NEW_SESSION_DRAFT_KEY, NEW_SESSION_DRAFT_KEY]);
});

test("a launch submitted while the folder is inspected starts once the inspection answers", async () => {
  // Start session stays enabled while the folder's checkout is still being inspected, and the submit used to be
  // dropped in that window: the session never started. It waits for the inspection and starts with its answer.
  const app = shell();
  const internals = app as unknown as Record<string, unknown>;
  app.renderRoot = { querySelector: () => null };
  internals["refreshSessions"] = async () => {};
  internals["navigate"] = () => {};
  internals["withSessionPane"] = async () => {};
  app.launcher.open({ label: "repo", cwd: "/repo", workspaceMode: "worktree", baseRef: "release", sessions: [] } as unknown as SessionGroup);
  app.launcher.requestCheckout("/repo");
  assert.equal(app.launcher.checkoutLoading, true, "the folder's checkout is being inspected");
  const form = { isConnected: true } as unknown as HTMLFormElement;
  app.requestLaunch({ cwd: "/repo", prompt: "go" }, form);
  app.updated(new Map());
  assert.deepEqual(launchApi.created, [], "the inspection is still running, so nothing starts yet");

  launchApi.checkouts[0]!({ available: true, headBranch: "main", defaultBranch: "main", branches: ["main", "release"] });
  await settle();
  assert.equal(app.launcher.checkoutLoading, false);
  app.updated(new Map());
  assert.deepEqual(
    launchApi.created,
    [{ cwd: "/repo", thinking: "medium", worktree: true, baseRef: "release", initialPrompt: "go" }],
    "the submit starts with the checkout the inspection answered",
  );
  await settle();
  assert.equal(app.launching, false, "the started launch settled before the next submit");

  // The folder changed under a pending submit: it named /repo, and the inspection that answered was /elsewhere's.
  app.launcher.requestCheckout("/elsewhere");
  app.requestLaunch({ cwd: "/repo", prompt: "go" }, form);
  app.updated(new Map());
  assert.equal(launchApi.created.length, 1, "the second inspection is still running");
  launchApi.checkouts[1]!({ available: true, headBranch: "main", defaultBranch: "main", branches: ["main"] });
  await settle();
  app.updated(new Map());
  assert.equal(launchApi.created.length, 1, "a submit for a folder that is no longer inspected is dropped");
});

test("a session's address focuses the pane that already shows it instead of giving the focused pane a second view", () => {
  // Two panes showing different sessions; the address names the first while the second has focus, as a deep link,
  // Back or a reload can.
  const layout = splitSessionPane(singleSessionLayout("first"), "p1", "second", "right");
  const history = { state: { huiSessionLayout: layout }, pushState: () => {}, replaceState: () => {} };
  vi.stubGlobal("window", { location: { pathname: "/sessions/first", search: "", hash: "" }, history });
  const app = shell();
  app.syncFromLocation();
  assert.deepEqual(sessionPanes(app.work.layout!).map(({ sessionId }) => sessionId), ["first", "second"]);
  assert.equal(app.work.layout!.activePaneId, "p1");

  // The same route through navigation: the other pane's session takes focus there, keeping both views.
  app.navigate({ kind: "session", id: "second" });
  assert.deepEqual(sessionPanes(app.work.layout!).map(({ sessionId }) => sessionId), ["first", "second"]);
  assert.equal(app.work.layout!.activePaneId, "p2");
  // A session no pane shows still takes the focused pane's place.
  app.navigate({ kind: "session", id: "third" });
  assert.deepEqual(sessionPanes(app.work.layout!).map(({ sessionId }) => sessionId), ["first", "third"]);
  assert.equal(app.work.layout!.activePaneId, "p2");
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

test("the new group's chief checkbox is named by its label, not by the sentence that describes it", () => {
  const app = shell();
  app.groupAction = { action: "new" };
  const dialog = text(app.renderGroupActionDialog());
  assert.match(dialog, /<input type="checkbox" aria-describedby="group-action-chief-description"/u);
  const start = dialog.indexOf('<label class="group-action-dialog__chief-choice">');
  assert.notEqual(start, -1, dialog);
  const label = dialog.slice(start, dialog.indexOf("</label>", start) + "</label>".length);
  assert.match(label, /Create a Chief of Staff/u);
  assert.doesNotMatch(label, /A chief plans/u, "the description stays out of the control's accessible name");
  assert.match(dialog, /<span class="exec-approval-sub" id="group-action-chief-description">A chief plans and starts/u);
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
