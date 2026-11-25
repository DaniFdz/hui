import assert from "node:assert/strict";
import { test } from "vitest";
import { inAppLinkHandled, inAppLinkTarget, installInAppLinkNavigation, linkClickTarget, type LinkClick } from "./in-app-links.ts";
import type { NavigationTarget } from "./navigation.ts";

/** An element as the rule reads one: no DOM, only the attributes, the `closest` walk and the containment a browser
 * provides. */
type FakeElement = {
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  closest: (selector: string) => FakeElement | null;
  contains: (node: unknown) => boolean;
};

/** The anchor the Markdown parser renders: its `href` attribute plus whatever else a test adds, holding `holds`. */
function anchorWith(attributes: Record<string, string>, holds: (node: unknown) => boolean = () => false): FakeElement {
  const anchor: FakeElement = {
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    closest: (selector) => selector === "a[href]" ? anchor : null,
    contains: holds,
  };
  return anchor;
}

/** A `<span>` inside `anchor`: the click lands on it, and `closest` walks up to the link. */
function spanInside(anchor: FakeElement): FakeElement {
  return {
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: (selector) => selector === "a[href]" ? anchor : null,
    contains: () => false,
  };
}

/** A selection as the guard reads one, installed only for the duration of `read` and taken away again afterwards. */
function withSelection<T>(selection: { anchorNode: unknown; focusNode: unknown; isCollapsed: boolean }, read: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "getSelection");
  Object.defineProperty(globalThis, "getSelection", { value: () => selection, configurable: true, writable: true });
  try {
    return read();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "getSelection", descriptor);
    else Reflect.deleteProperty(globalThis, "getSelection");
  }
}

/** A click as a browser dispatches one: the fields the rule reads, and the mutable state a test reads back after. */
type FakeClick = Omit<LinkClick, "defaultPrevented"> & {
  defaultPrevented: boolean;
  preventDefault: () => void;
};

function click(target: FakeElement | null, init: Partial<FakeClick> = {}): FakeClick {
  const event: FakeClick = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: target as unknown as EventTarget,
    preventDefault: () => { event.defaultPrevented = true; },
    ...init,
  };
  return event;
}

type Listener = (event: Event) => void;

/** The listener set an event root keeps: the installer adds one, dispatch presses it, and uninstalling takes it away. */
function fakeRoot() {
  const listeners: Listener[] = [];
  const root = {
    addEventListener: (type: string, listener: Listener) => { if (type === "click") listeners.push(listener); },
    removeEventListener: (type: string, listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (type === "click" && index >= 0) listeners.splice(index, 1);
    },
  } as unknown as EventTarget;
  const dispatch = (event: FakeClick) => { for (const listener of [...listeners]) listener(event as unknown as Event); };
  return { root, listeners, dispatch };
}

function fakeNavigate() {
  const navigated: NavigationTarget[] = [];
  return { navigated, navigate: (target: NavigationTarget) => { navigated.push(target); } };
}

test("a plain left click on an in-app link navigates in place", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  const event = click(anchorWith({ href: "/sessions/abc" }));
  dispatch(event);
  assert.deepEqual(navigated, [{ kind: "session", id: "abc" }]);
  assert.equal(event.defaultPrevented, true);
});

test("a modified click keeps the browser's own behaviour", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }] as const) {
    const event = click(anchorWith({ href: "/sessions/abc" }), init);
    dispatch(event);
    assert.deepEqual(navigated, [], Object.keys(init).join());
    assert.equal(event.defaultPrevented, false, Object.keys(init).join());
  }
});

test("a middle or right click keeps the browser's own behaviour", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  for (const button of [1, 2]) {
    const event = click(anchorWith({ href: "/sessions/abc" }), { button });
    dispatch(event);
    assert.deepEqual(navigated, [], `button ${button}`);
    assert.equal(event.defaultPrevented, false, `button ${button}`);
  }
});

test("a link that opens elsewhere or downloads a file keeps the browser's own behaviour", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  const links: Record<string, string>[] = [{ href: "/sessions/abc", target: "_blank" }, { href: "/sessions/abc", download: "" }];
  for (const attributes of links) {
    const event = click(anchorWith(attributes));
    dispatch(event);
    assert.deepEqual(navigated, [], JSON.stringify(attributes));
    assert.equal(event.defaultPrevented, false, JSON.stringify(attributes));
  }
});

test("a link that names this same tab is navigated in place", () => {
  assert.deepEqual(linkClickTarget(click(anchorWith({ href: "/kanban", target: "_self" })))?.target, { kind: "kanban" });
});

test("a link that names the current browsing context with an empty target is navigated in place", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  const event = click(anchorWith({ href: "/kanban", target: "" }));
  dispatch(event);
  assert.deepEqual(navigated, [{ kind: "kanban" }], "target=\"\" is this tab, like _self");
  assert.equal(event.defaultPrevented, true);
});

test("a text selection released over the link is a selection, not a click", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  // The reader dragged from the prose into the link: the selection begins outside it and ends inside it.
  const selected = { kind: "text node" };
  const anchor = anchorWith({ href: "/sessions/abc" }, (node) => node === selected);
  const event = click(spanInside(anchor));
  withSelection({ anchorNode: { kind: "text node" }, focusNode: selected, isCollapsed: false }, () => dispatch(event));
  assert.deepEqual(navigated, [], "the drag was selecting the link's text, so nothing navigates");
  assert.equal(event.defaultPrevented, false, "and the browser keeps the selection it made");
});

test("a text selection that begins inside the link is a selection, not a click", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  // The reader dragged out of the link into the prose: the selection begins inside it and ends outside it.
  const selected = { kind: "text node" };
  const anchor = anchorWith({ href: "/sessions/abc" }, (node) => node === selected);
  const event = click(anchor);
  withSelection({ anchorNode: selected, focusNode: { kind: "text node" }, isCollapsed: false }, () => dispatch(event));
  assert.deepEqual(navigated, [], "either end of the selection in the link makes the click a selection");
  assert.equal(event.defaultPrevented, false, "and the browser keeps the selection it made");
});

test("a collapsed selection in the link is a caret, so the click still navigates", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  // A mousedown collapses the selection to a caret inside the link; that caret is not a selection the reader made.
  const caret = { kind: "text node" };
  const anchor = anchorWith({ href: "/sessions/abc" }, (node) => node === caret);
  const event = click(spanInside(anchor));
  withSelection({ anchorNode: caret, focusNode: caret, isCollapsed: true }, () => dispatch(event));
  assert.deepEqual(navigated, [{ kind: "session", id: "abc" }]);
  assert.equal(event.defaultPrevented, true);
});

test("an app that opens a target in place says so, and an embedded pane opens only its own chat", () => {
  const session: NavigationTarget = { kind: "session", id: "abc" };
  const settings: NavigationTarget = { kind: "settings", page: "models" };
  assert.equal(inAppLinkHandled(session, { embedded: true, paneNavigates: true }), true, "a pane with a navigator opens the chat it names");
  assert.equal(inAppLinkHandled(settings, { embedded: true, paneNavigates: true }), false, "a pane has no Settings page to open");
  assert.equal(inAppLinkHandled({ kind: "home" }, { embedded: true, paneNavigates: true }), false, "nor the shell's home");
  assert.equal(inAppLinkHandled(session, { embedded: true, paneNavigates: false }), false, "without a navigator a pane opens nothing");
  assert.equal(inAppLinkHandled(session, { embedded: false, paneNavigates: false }), true, "the shell opens every route it has");
  assert.equal(inAppLinkHandled(settings, { embedded: false, paneNavigates: false }), true);
});

test("a link out of the app or into an unknown path keeps the browser's own behaviour", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  for (const href of ["https://example.com/x", "//example.com/x", "/tmp/notes.txt", "/nonsense"]) {
    const event = click(anchorWith({ href }));
    dispatch(event);
    assert.deepEqual(navigated, [], href);
    assert.equal(event.defaultPrevented, false, href);
  }
});

test("a click something else already handled is left alone", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  const event = click(anchorWith({ href: "/sessions/abc" }));
  // A handler closer to the link, such as a chip's own, takes the click before it reaches the app.
  event.preventDefault();
  dispatch(event);
  assert.deepEqual(navigated, []);
});

test("every in-app route navigates to its own target", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  const cases: [string, NavigationTarget][] = [
    ["/bots/b-grace", { kind: "bot", id: "b-grace" }],
    ["/kanban", { kind: "kanban" }],
    ["/", { kind: "home" }],
    ["/settings/models", { kind: "settings", page: "models" }],
    ["/worktrees", { kind: "settings", page: "worktrees" }],
  ];
  for (const [href, target] of cases) {
    const event = click(anchorWith({ href }));
    dispatch(event);
    assert.deepEqual(navigated.at(-1), target, href);
    assert.equal(event.defaultPrevented, true, href);
  }
});

test("an in-app link with a query or a fragment navigates to its route", () => {
  const event = click(anchorWith({ href: "/sessions/abc?from=chat#bottom" }));
  assert.deepEqual(linkClickTarget(event)?.target, { kind: "session", id: "abc" });
  assert.deepEqual(inAppLinkTarget("/worktrees?tab=open"), { kind: "settings", page: "worktrees" });
});

test("a click on something inside the link still navigates", () => {
  const { root, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  installInAppLinkNavigation(root, navigate);
  dispatch(click(spanInside(anchorWith({ href: "/sessions/abc" }))));
  assert.deepEqual(navigated, [{ kind: "session", id: "abc" }]);
});

test("a target the app does not handle is left to the browser", () => {
  const { root, dispatch } = fakeRoot();
  const asked: NavigationTarget[] = [];
  installInAppLinkNavigation(root, (target) => { asked.push(target); return false; });
  const event = click(anchorWith({ href: "/settings/models" }));
  dispatch(event);
  assert.deepEqual(asked, [{ kind: "settings", page: "models" }], "the app is asked first");
  assert.equal(event.defaultPrevented, false, "and the browser loads the page as before");
});

test("a click that lands outside any link is left alone", () => {
  const outside: FakeElement = { getAttribute: () => null, hasAttribute: () => false, closest: () => null, contains: () => false };
  assert.equal(linkClickTarget(click(outside)), undefined, "a click on the prose around a link");
  assert.equal(linkClickTarget(click(null)), undefined, "a click without an element at all");
});

test("uninstalling stops handling clicks", () => {
  const { root, listeners, dispatch } = fakeRoot();
  const { navigated, navigate } = fakeNavigate();
  const uninstall = installInAppLinkNavigation(root, navigate);
  dispatch(click(anchorWith({ href: "/sessions/abc" })));
  uninstall();
  dispatch(click(anchorWith({ href: "/sessions/abc" })));
  assert.equal(navigated.length, 1);
  assert.deepEqual(listeners, [], "the listener it added is the one it removed");
});

test("a path is in-app only when it is a HUI route", () => {
  assert.deepEqual(inAppLinkTarget("/sessions/abc"), { kind: "session", id: "abc" });
  assert.equal(inAppLinkTarget("/nonsense"), undefined);
  assert.deepEqual(inAppLinkTarget("/"), { kind: "home" });
});
