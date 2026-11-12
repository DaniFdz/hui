/**
 * The phone seam against a fake bridge: a browser with no bridge answers `null`, and in the shell every plugin call,
 * listener and policy (foreground silence, the page's answer to a back press, a tapped notification opening its path)
 * is what `mobile/AGENTS.md` promises.
 */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { messageShare, nativeShell, type NativeShell } from "./native-shell.ts";

type Call = { plugin: string; method: string; options: unknown };

type Harness = {
  plugins: Record<string, Record<string, unknown>>;
  calls: Call[];
  /** Fires a plugin event the page subscribed to. */
  emit: (plugin: string, event: string, data: unknown) => void;
  pushed: string[];
  pops: () => number;
  shell: NativeShell;
};

const PLUGIN_ACTIONS = ["open", "schedule", "share", "setStyle", "connect", "forget"] as const;

/** A page as far as the adapter reads one: `window`, its `history`, its `location`, and the injected bridge. */
function fakeShell(options: { platform?: string; history?: string[]; plugins?: readonly string[]; startActive?: boolean } = {}): Harness {
  const calls: Call[] = [];
  const active = options.startActive ?? true;
  const listeners = new Map<string, Array<(data: unknown) => void>>();
  const entries = [...(options.history ?? ["/"])];
  let pops = 0;
  const pushed: string[] = [];
  const plugins: Record<string, Record<string, unknown>> = {};
  for (const name of options.plugins ?? ["App", "Browser", "LocalNotifications", "Share", "StatusBar", "HuiGateway"]) {
    const instance: Record<string, unknown> = {
      getState: () => Promise.resolve({ isActive: active }),
      addListener: (event: string, listener: (data: unknown) => void) => {
        const key = `${name}:${event}`;
        listeners.set(key, [...(listeners.get(key) ?? []), listener]);
        return { remove: async () => undefined };
      },
    };
    for (const action of PLUGIN_ACTIONS) {
      Object.defineProperty(instance, action, {
        value: (payload: unknown) => {
          calls.push({ plugin: name, method: action, options: payload });
          return Promise.resolve();
        },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    plugins[name] = instance;
  }
  const page = new EventTarget() as EventTarget & Record<string, unknown>;
  page.addEventListener("popstate", () => { pops += 1; });
  page["location"] = { pathname: entries.at(-1) ?? "/", search: "" };
  page["history"] = {
    get length() { return entries.length; },
    pushState: (_state: unknown, _title: string, url: string) => {
      pushed.push(url);
      entries.push(url);
      page["location"] = { pathname: url, search: "" };
    },
  };
  page["Capacitor"] = { isNativePlatform: () => true, getPlatform: () => options.platform ?? "android", Plugins: plugins };
  vi.stubGlobal("window", page);
  const shell = nativeShell();
  assert.ok(shell, "the injected bridge should answer a shell");
  return {
    plugins,
    calls,
    emit: (name, event, data) => {
      for (const listener of [...(listeners.get(`${name}:${event}`) ?? [])]) listener(data);
    },
    pushed,
    pops: () => pops,
    shell,
  };
}

/** A page whose own visibility the adapter also reads, and whose document carries the shell's `hui:back` press. */
function fakeDocument(visibility: "visible" | "hidden" = "visible"): EventTarget & { visibilityState: string } {
  const page = Object.assign(new EventTarget(), { visibilityState: visibility });
  vi.stubGlobal("document", page);
  return page;
}

/** The shell's own press: a cancelable `hui:back` on the document, answered through `preventDefault()`. */
function backPress(page: EventTarget): boolean {
  const press = new Event("hui:back", { cancelable: true });
  page.dispatchEvent(press);
  return press.defaultPrevented;
}

test("a browser has no shell: no window, no bridge, a web bridge, or a phone it cannot name", () => {
  vi.stubGlobal("window", undefined);
  assert.equal(nativeShell(), null, "no window at all");
  vi.stubGlobal("window", {});
  assert.equal(nativeShell(), null, "a window without the injected bridge");
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => false, getPlatform: () => "web", Plugins: {} } });
  assert.equal(nativeShell(), null, "Capacitor's own browser build");
  vi.stubGlobal("window", { Capacitor: { getPlatform: () => "android", Plugins: {} } });
  assert.equal(nativeShell(), null, "a bridge that cannot say it is native");
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, getPlatform: () => "web", Plugins: {} } });
  assert.equal(nativeShell(), null, "a bridge on a platform no shell knows");
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: {} } });
  assert.equal(nativeShell(), null, "a bridge that names no platform at all");
});

test("the shell names its platform and is the same shell for every caller", () => {
  const android = fakeShell({ platform: "android" });
  assert.equal(android.shell.platform, "android");
  assert.equal(nativeShell(), android.shell);
  const ios = fakeShell({ platform: "ios" });
  assert.equal(ios.shell.platform, "ios");
  assert.notEqual(ios.shell, android.shell, "each injected bridge has its own shell");
});

test("an external link opens in the shell's browser", async () => {
  const { shell, calls } = fakeShell();
  await shell.openExternal("https://example.com/a?b=1");
  assert.deepEqual(calls, [{ plugin: "Browser", method: "open", options: { url: "https://example.com/a?b=1" } }]);
});

test("a notification is posted only while the shell is in the background", async () => {
  fakeDocument();
  const harness = fakeShell();
  const notification = { id: 42, title: "Fix the drawer", body: "Waiting for your answer", path: "/sessions/abc" };

  await harness.shell.notify(notification);
  assert.deepEqual(harness.calls, [], "a visible page already shows the session, so nothing is posted");

  harness.emit("App", "appStateChange", { isActive: false });
  await harness.shell.notify(notification);
  assert.deepEqual(harness.calls, [{
    plugin: "LocalNotifications",
    method: "schedule",
    options: { notifications: [{ id: 42, title: "Fix the drawer", body: "Waiting for your answer", extra: { path: "/sessions/abc" }, isExactNotification: false }] },
  }]);

  harness.emit("App", "appStateChange", { isActive: true });
  await harness.shell.notify(notification);
  assert.equal(harness.calls.length, 1, "back in the foreground it stays quiet again");
});

test("a page that starts while the shell is already away posts its first notification", async () => {
  const harness = fakeShell({ startActive: false });
  // `App.getState()` answers `isActive: false` a microtask after the shell starts.
  await Promise.resolve();
  await Promise.resolve();
  await harness.shell.notify({ id: 7, title: "Started away", body: "Waiting for your answer", path: "/sessions/7" });
  assert.equal(harness.calls.length, 1, "App.getState() says the shell was already in the background");
});

test("the page's own visibility counts too, and a refused notification never throws", async () => {
  const page = fakeDocument();
  const harness = fakeShell();
  page.dispatchEvent(new Event("visibilitychange"));
  await harness.shell.notify({ id: 1, title: "t", body: "b", path: "/sessions/1" });
  assert.deepEqual(harness.calls, [], "a page that is still visible posts nothing");

  const hidden = fakeDocument("hidden");
  hidden.dispatchEvent(new Event("visibilitychange"));
  const refused = fakeShell();
  refused.plugins["LocalNotifications"]!["schedule"] = () => Promise.reject(new Error("denied"));
  await refused.shell.notify({ id: 1, title: "t", body: "b", path: "/sessions/1" });
});

test("tapping a notification opens the path it announced, without reloading the app", () => {
  fakeDocument();
  const harness = fakeShell({ history: ["/", "/sessions/other"] });
  harness.emit("LocalNotifications", "localNotificationActionPerformed", { actionId: "tap", notification: { extra: { path: "/sessions/abc" } } });
  assert.deepEqual(harness.pushed, ["/sessions/abc"]);
  assert.equal(harness.pops(), 1, "hui-app.ts rereads the route on popstate");
  harness.emit("LocalNotifications", "localNotificationActionPerformed", { actionId: "tap", notification: { extra: {} } });
  assert.deepEqual(harness.pushed, ["/sessions/abc"], "a notification without a path opens nothing");
});

test("the status bar follows the mode the page resolved", async () => {
  const { shell, calls } = fakeShell();
  await shell.setStatusBar({ dark: true });
  await shell.setStatusBar({ dark: false });
  assert.deepEqual(calls, [
    { plugin: "StatusBar", method: "setStyle", options: { style: "DARK" } },
    { plugin: "StatusBar", method: "setStyle", options: { style: "LIGHT" } },
  ]);
});

test("a back press runs every callback, and one answering true keeps it for the page", () => {
  const page = fakeDocument();
  const harness = fakeShell({ history: ["/", "/sessions/abc"] });
  const first = vi.fn(() => false);
  const second = vi.fn(() => true);
  const third = vi.fn(() => false);
  for (const callback of [first, second, third]) harness.shell.onBack(callback);
  assert.equal(backPress(page), true);
  assert.deepEqual([first, second, third].map((callback) => callback.mock.calls.length), [1, 1, 1], "every callback answers");
  assert.deepEqual(harness.calls, [], "a consumed press asks the phone for nothing");
});

test("a press nothing consumed is the shell's: the page neither walks the history nor leaves the app", () => {
  const page = fakeDocument();
  const harness = fakeShell({ history: ["/", "/sessions/abc"] });
  const back = vi.fn(() => false);
  harness.shell.onBack(back);
  assert.equal(backPress(page), false);
  assert.equal(back.mock.calls.length, 1);
  assert.deepEqual(harness.calls, [], "an unconsumed press is the shell's own back step, not the page's");
});

test("the App plugin's own back button is not what the page answers", () => {
  fakeDocument();
  const harness = fakeShell({ history: ["/", "/sessions/abc"] });
  const back = vi.fn(() => true);
  harness.shell.onBack(back);
  harness.emit("App", "backButton", { canGoBack: true });
  assert.equal(back.mock.calls.length, 0, "the shell dispatches hui:back from its own callback, before the App plugin");
});

test("a page without a back callback lets the press through", () => {
  const page = fakeDocument();
  fakeShell();
  assert.equal(backPress(page), false);
});

test("unsubscribing a back or resume callback drops just that callback", () => {
  const page = fakeDocument();
  const harness = fakeShell();
  const back = vi.fn(() => true);
  const resume = vi.fn();
  const stopBack = harness.shell.onBack(back);
  const stopResume = harness.shell.onResume(resume);
  harness.emit("App", "appStateChange", { isActive: true });
  assert.equal(resume.mock.calls.length, 1);
  harness.emit("App", "appStateChange", { isActive: false });
  assert.equal(resume.mock.calls.length, 1, "leaving the foreground is not a resume");
  stopBack();
  stopResume();
  assert.equal(backPress(page), false);
  harness.emit("App", "appStateChange", { isActive: true });
  assert.equal(back.mock.calls.length, 0);
  assert.equal(resume.mock.calls.length, 1);
});

test("the share sheet and forgetting the gateway reach their plugins", async () => {
  const { shell, calls } = fakeShell();
  await shell.share({ title: "HUI", text: "a message", url: "https://hui.test/sessions/abc" });
  await shell.forgetGateway();
  assert.deepEqual(calls, [
    { plugin: "Share", method: "share", options: { title: "HUI", text: "a message", url: "https://hui.test/sessions/abc" } },
    { plugin: "HuiGateway", method: "forget", options: undefined },
  ]);
});

test("choosing a gateway reaches the existing native bridge handoff and reports a refusal", async () => {
  const { shell, calls, plugins } = fakeShell();
  await shell.connectGateway("https://loft.test/");
  assert.deepEqual(calls, [{ plugin: "HuiGateway", method: "connect", options: { url: "https://loft.test" } }]);
  await assert.rejects(shell.connectGateway("javascript:alert(1)"), /http:\/\/ or https:\/\//u);
  assert.equal(calls.length, 1, "an invalid address never reaches a native plugin");
  plugins["HuiGateway"]!["connect"] = async () => { throw new Error("Gateway refused."); };
  await assert.rejects(shell.connectGateway("https://loft.test"), /Gateway refused/u);
  const old = fakeShell({ plugins: [] });
  await assert.rejects(old.shell.connectGateway("https://loft.test"), /Update the HUI app/u);
});

test("a shell missing optional plugins still answers its best-effort calls", async () => {
  const { shell } = fakeShell({ plugins: [] });
  await shell.openExternal("https://example.com");
  await shell.notify({ id: 1, title: "t", body: "b", path: "/sessions/1" });
  await shell.share({ text: "x" });
  await shell.setStatusBar({ dark: true });
  await shell.forgetGateway();
  shell.onBack(() => true);
  shell.onResume(() => undefined);
});

test("a shared message is its words, the conversation's name and the conversation's own address", () => {
  const session = { id: "s-1", title: "Fix the drawer" };
  assert.deepEqual(messageShare({ text: "the words on screen", session }, "https://gateway.test/sessions/s-1"), {
    title: "Fix the drawer",
    text: "the words on screen",
    url: "https://gateway.test/sessions/s-1",
  }, "the link names the gateway this page was loaded from");
  assert.deepEqual(messageShare({ text: "no conversation" }, "https://gateway.test/"), { text: "no conversation" });
  assert.deepEqual(messageShare({ text: "w", session: { id: "s-2" } }, "https://gateway.test/"), { text: "w", url: "https://gateway.test/sessions/s-2" }, "a conversation without a name titles nothing");
  assert.deepEqual(messageShare({ text: "w", session: { id: "s", title: "   " } }, "https://gateway.test/"), { text: "w", url: "https://gateway.test/sessions/s" }, "a blank name is no name");
  assert.deepEqual(messageShare({ text: "w", session: { id: "c-1", title: "Grace", bot: { id: "b-grace" } } }, "https://gateway.test/"), { title: "Grace", text: "w", url: "https://gateway.test/bots/b-grace" }, "a bot's chat shares the address the app opens it by");
  assert.deepEqual(messageShare({ text: "w", session }, "about:blank"), { title: "Fix the drawer", text: "w" }, "a page with no usable address shares its words alone");
  assert.deepEqual(messageShare({ text: "w", session }, "not a url"), { title: "Fix the drawer", text: "w" });
});

test("a share carries words a sheet can take, and nothing past the cap", () => {
  const shared = messageShare({ text: "x".repeat(70_000) }, "https://gateway.test/");
  assert.equal(shared.text, `${"x".repeat(64_000)}\n…`, "an Intent over its transaction limit would never open the sheet");
  assert.equal(shared.url, undefined);
  assert.equal(messageShare({ text: "short" }, "https://gateway.test/").text, "short", "a normal message is shared as written");
});
