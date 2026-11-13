/**
 * The shell's links and its resume: an external link hands off to the shell's browser and a page-internal one stays,
 * nothing is installed in a browser, and a resume runs the same reconnect event the web already listens for.
 */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { externalLink, installNativeShell } from "./native-shell-boot.ts";

type Call = { plugin: string; method: string; options: unknown };

class FakeElement {
  constructor() {
    // Stands in for the DOM node type the module checks with `instanceof`.
  }
}

class FakeAnchor extends FakeElement {
  href = "";
  attributes: string[] = [];
  getAttribute(name: string): string | null {
    return name === "href" ? this.href : null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.includes(name);
  }
}

function page(options: { shell?: boolean } = {}): {
  window: EventTarget & Record<string, unknown>;
  document: EventTarget;
  calls: Call[];
  emit: (plugin: string, event: string, data: unknown) => void;
  click: (anchor: FakeAnchor, extra?: Record<string, unknown>) => { prevented: boolean };
} {
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLAnchorElement", FakeAnchor);
  const calls: Call[] = [];
  const listeners = new Map<string, Array<(data: unknown) => void>>();
  const plugin = (name: string) => ({
    addListener: (event: string, listener: (data: unknown) => void) => {
      listeners.set(`${name}:${event}`, [...(listeners.get(`${name}:${event}`) ?? []), listener]);
      return Promise.resolve({ remove: async () => undefined });
    },
    open: (payload: unknown) => { calls.push({ plugin: name, method: "open", options: payload }); return Promise.resolve(); },
  });
  const pageWindow = new EventTarget() as EventTarget & Record<string, unknown>;
  pageWindow["location"] = { href: "https://gw.test/sessions/abc", search: "" };
  pageWindow["open"] = vi.fn(() => null);
  if (options.shell) {
    pageWindow["Capacitor"] = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: Object.fromEntries(["App", "Browser", "LocalNotifications", "Share", "StatusBar", "HuiGateway"].map((name) => [name, plugin(name)])),
    };
  }
  const pageDocument = new EventTarget() as EventTarget & Record<string, unknown>;
  const clicks: Array<(event: unknown) => void> = [];
  const realAdd = pageDocument.addEventListener.bind(pageDocument);
  pageDocument.addEventListener = ((type: string, listener: (event: unknown) => void, capture?: boolean) => {
    if (type === "click") clicks.push(listener);
    realAdd(type, listener as EventListener, capture);
  }) as typeof pageDocument.addEventListener;
  vi.stubGlobal("window", pageWindow);
  vi.stubGlobal("document", pageDocument);
  return {
    window: pageWindow,
    document: pageDocument,
    calls,
    emit: (name, event, data) => {
      for (const listener of [...(listeners.get(`${name}:${event}`) ?? [])]) listener(data);
    },
    click: (anchor, extra = {}) => {
      const target = Object.assign(new FakeElement(), { closest: () => anchor });
      const event = { target, button: 0, defaultPrevented: false, preventDefault: () => { event.defaultPrevented = true; }, ...extra };
      for (const handler of clicks) handler(event);
      return { prevented: event.defaultPrevented };
    },
  };
}

test("a link to another origin is the shell's; HUI's own pages and non-web schemes are the page's", () => {
  const base = "https://gw.test/sessions/abc";
  assert.equal(externalLink("https://example.com/x?y=1", base), "https://example.com/x?y=1");
  assert.equal(externalLink("/settings/appearance", base), undefined);
  assert.equal(externalLink("https://gw.test/kanban", base), undefined, "the gateway by its full address stays in the page");
  // The shell's own link policy opens the mail and dialer apps; a web page cannot, so it must keep the press.
  assert.equal(externalLink("mailto:someone@example.com", base), undefined);
  assert.equal(externalLink("tel:+1234", base), undefined);
  assert.equal(externalLink("javascript:alert(1)", base), undefined);
  assert.equal(externalLink("ftp://files.test/a", base), undefined);
  assert.equal(externalLink("", base), undefined);
  assert.equal(externalLink("#anchor", base), undefined);
});

test("a browser installs nothing: links keep the browser's own behaviour", () => {
  const harness = page();
  const uninstall = installNativeShell();
  assert.deepEqual(harness.click(Object.assign(new FakeAnchor(), { href: "https://example.com" })), { prevented: false });
  uninstall();
});

test("in the shell an external link opens in the shell's browser and an internal one does not", () => {
  const harness = page({ shell: true });
  const uninstall = installNativeShell();
  assert.deepEqual(harness.click(Object.assign(new FakeAnchor(), { href: "https://example.com/doc" })), { prevented: true });
  assert.deepEqual(harness.calls, [{ plugin: "Browser", method: "open", options: { url: "https://example.com/doc" } }]);
  assert.deepEqual(harness.click(Object.assign(new FakeAnchor(), { href: "/settings/appearance" })), { prevented: false });
  assert.deepEqual(harness.click(Object.assign(new FakeAnchor(), { href: "https://example.com/doc" }), { metaKey: true }), { prevented: false });
  const download = Object.assign(new FakeAnchor(), { href: "https://example.com/report.csv", attributes: ["download"] });
  assert.deepEqual(harness.click(download), { prevented: false }, "a download stays with the shell's own file handling");
  const mail = Object.assign(new FakeAnchor(), { href: "mailto:someone@example.com" });
  assert.deepEqual(harness.click(mail), { prevented: false }, "mail and phone links are the shell's own link policy");
  assert.equal(harness.calls.length, 1, "a modified press, a download and a mail link are not the shell's browser");
  uninstall();
});

test("an open-in-a-new-tab target reaches the shell instead of a tab it cannot open", () => {
  const harness = page({ shell: true });
  const uninstall = installNativeShell();
  assert.equal((harness.window["open"] as (url: string, target: string) => unknown)("https://example.com/pr", "_blank"), null);
  assert.deepEqual(harness.calls, [{ plugin: "Browser", method: "open", options: { url: "https://example.com/pr" } }]);
  uninstall();
  assert.equal(typeof harness.window["open"], "function", "the original window.open comes back");
});

test("a resumed shell runs the reconnect event the web already listens for", () => {
  const harness = page({ shell: true });
  let online = 0;
  harness.window.addEventListener("online", () => { online += 1; });
  const uninstall = installNativeShell();
  harness.emit("App", "appStateChange", { isActive: false });
  assert.equal(online, 0, "leaving the app is not a reconnect");
  harness.emit("App", "appStateChange", { isActive: true });
  assert.equal(online, 1);
  uninstall();
  harness.emit("App", "appStateChange", { isActive: true });
  assert.equal(online, 1, "the uninstall stops listening");
});
