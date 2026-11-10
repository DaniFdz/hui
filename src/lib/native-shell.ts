/**
 * The web UI's only seam to the phone shell (`mobile/AGENTS.md`, WP3 of `docs/mobile-app-plan.md`).
 *
 * The app in `mobile/` is a Capacitor shell that loads the connected gateway's own web UI, so a plugin call from this
 * page reaches the phone directly. Capacitor injects the bridge as `window.Capacitor` at document start; `src/` never
 * imports `@capacitor/*` (rule R18 in `scripts/boundaries.test.mjs`), it reads that object instead and calls the
 * plugins by name. In a browser there is no bridge, `nativeShell()` answers `null`, and every caller keeps exactly
 * its web behaviour.
 *
 * The shell also owns two policies a caller should not repeat: a notification is posted only while the shell is in
 * the background (a visible page already shows what it would say), and a tap on one opens the path it announced. A
 * back press the page does not consume is the shell's own business (`onBack`): it goes back in the page's history and,
 * at the root, leaves the app.
 */

export type NativePlatform = "android" | "ios";

/** What a posted notification says and where tapping it lands. `id` is the shell's 32-bit slot: a session announcing
 * itself again replaces its own notification instead of stacking a second one, so the caller hands out one slot per
 * session. */
export type NativeNotification = {
  id: number;
  title: string;
  body: string;
  /** In-app path (`navigationPath`) the tap opens. */
  path: string;
};

export type NativeShare = { title?: string; text?: string; url?: string };

/** The session a shared thing belongs to, as the transcript and the Files view know it. */
export type ShareTarget = { id: string; title?: string };

/** How much text a sheet is handed. Android puts it in an `Intent` extra, and a transaction over 1 MiB fails outright,
 * so what a share carries is words up to this many characters (256 KiB at worst, in UTF-8) and the rest is an
 * ellipsis: a sheet is a note to another app, not a file transfer. */
const MAX_SHARE_TEXT = 64_000;

function shareText(text: string): string {
  return text.length > MAX_SHARE_TEXT ? `${text.slice(0, MAX_SHARE_TEXT)}\n…` : text;
}

/** HUI's own address for one session on the gateway this page was loaded from, or nothing when the base is not a URL:
 * sharing a link is only worth it when the link opens the conversation. */
function sessionAddress(base: string, id: string | undefined): string | undefined {
  if (!id) return undefined;
  try {
    return new URL(`/sessions/${encodeURIComponent(id)}`, base).href;
  } catch {
    return undefined;
  }
}

/** What the phone's Share sheet gets for one transcript message: its words, the conversation's name as the sheet's
 * title, and the conversation's own HUI address so whoever receives it can read it there. `base` is this page's own
 * address, so the link names the gateway the phone is connected to — never a `file:` one. */
export function messageShare(input: { text: string; session?: ShareTarget }, base: string): NativeShare {
  const title = input.session?.title?.trim();
  const url = sessionAddress(base, input.session?.id);
  return { ...(title ? { title } : {}), text: shareText(input.text), ...(url ? { url } : {}) };
}

/** What the phone's Share sheet gets for the file a Files view has open: its name, and the file's own text where HUI
 * can show it that way, else its path — the one thing a sheet can carry for a picture or a PDF. The gateway serves a
 * file only with HUI's own headers, so its address is no use to the app the operator picks. */
export function fileShare(input: { name: string; path: string; text?: string }): NativeShare {
  return { title: input.name, text: input.text ? shareText(input.text) : input.path };
}

export type NativeShell = {
  platform: NativePlatform;
  /** A link to another origin: the shell's browser, never this page's WebView. */
  openExternal(url: string): Promise<void>;
  /** Posts a local notification, unless the page is in the foreground. Resolves either way. */
  notify(notification: NativeNotification): Promise<void>;
  share(content: NativeShare): Promise<void>;
  /** `dark` is the mode the page resolved, not the mode the operator saved. */
  setStatusBar(options: { dark: boolean }): Promise<void>;
  /** Calls back when the shell comes back to the foreground; returns the unsubscribe. */
  onResume(callback: () => void): () => void;
  /** Hands the page the system back button: the shell dispatches a cancelable `hui:back` event on the document, and
   * every registered callback runs. Answer `true` to keep the press (a dialog, the drawer or the Work pane closed), and
   * the event's `preventDefault()` tells the shell so; a press nothing consumed is the shell's, which goes back in the
   * page's history and, at the root, leaves the app. Returns the unsubscribe. */
  onBack(callback: () => boolean): () => void;
  /** Drops the remembered gateway: the app returns to the shell's own Connect page. */
  forgetGateway(): Promise<void>;
};

/** The subset of Capacitor's injected bridge this module reads. It is typed here because `src/` holds no
 * `@capacitor/*` import (see R18). Both of the first two answers are required: `isNativePlatform()` is what tells a
 * browser with Capacitor's own web build apart from a shell, and `getPlatform()` names the phone. */
type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

/** A plugin event registration: Capacitor's `addListener` answers a handle (or a promise of one) to remove it. Payloads
 * are whatever that plugin sends, so a listener narrows its own. */
type ListenerHandle = { remove?: () => Promise<void> | void };
type Listener = (data: unknown) => void;

type Plugin = Record<string, unknown> & {
  addListener?: (event: string, listener: Listener) => Promise<ListenerHandle> | ListenerHandle;
};

type AppPlugin = Plugin & { getState?: () => Promise<{ isActive?: boolean }> };
type BrowserPlugin = Plugin & { open?: (options: { url: string }) => Promise<void> };
type NotificationsPlugin = Plugin & {
  schedule?: (options: { notifications: Array<Record<string, unknown>> }) => Promise<unknown>;
  checkPermissions?: () => Promise<{ display?: string }>;
  requestPermissions?: () => Promise<unknown>;
};
type SharePlugin = Plugin & { share?: (options: NativeShare) => Promise<unknown> };
type StatusBarPlugin = Plugin & { setStyle?: (options: { style: "DARK" | "LIGHT" }) => Promise<void> };
type GatewayPlugin = Plugin & { forget?: () => Promise<void> };

/** The injected bridge and the phone it answers for, or nothing: a browser has no bridge, and Capacitor's own browser
 * build injects one that answers `isNativePlatform() === false`. A bridge that cannot name an Android or iOS shell is
 * not one this module knows how to drive, so it answers no shell either. */
function phone(): { cap: CapacitorBridge; platform: NativePlatform } | null {
  if (typeof window === "undefined") return null;
  const injected = (window as { Capacitor?: unknown }).Capacitor;
  if (!injected || typeof injected !== "object") return null;
  const cap = injected as CapacitorBridge;
  if (cap.isNativePlatform?.() !== true) return null;
  const platform = cap.getPlatform?.();
  if (platform !== "android" && platform !== "ios") return null;
  return { cap, platform };
}

function plugin<T extends Plugin>(cap: CapacitorBridge, name: string): T | undefined {
  const found = cap.Plugins?.[name];
  return found && typeof found === "object" ? (found as T) : undefined;
}

/** Subscribes `listener` on a plugin event; a shell without that plugin (or a call before the bridge is ready) simply
 * never calls it. */
function listen(target: Plugin | undefined, event: string, listener: Listener): () => void {
  const handle = target?.addListener?.(event, listener);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    void Promise.resolve(handle).then((registered) => registered?.remove?.()).catch(() => undefined);
  };
}

/** Taps land in the app, not in a new page load: HUI's routes are its own history entries, and `hui-app.ts` reads the
 * route again on `popstate`. */
function openPath(path: string): void {
  if (typeof window === "undefined" || !path.startsWith("/")) return;
  if (`${window.location.pathname}${window.location.search}` === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("popstate"));
}

/** Whether the shell is in the background: Capacitor's activity signal, the state it answers for a page that starts or
 * reloads while the shell is already away, and the page's own visibility. */
function backgroundState(cap: CapacitorBridge): () => boolean {
  let background = false;
  const publish = (active: boolean | undefined) => {
    if (active !== undefined) background = !active;
  };
  const app = plugin<AppPlugin>(cap, "App");
  listen(app, "appStateChange", (data) => publish((data as { isActive?: boolean } | undefined)?.isActive));
  // A page that starts or reloads while the shell is already away heard no change event: ask once.
  void app?.getState?.().then((state) => publish(state.isActive)).catch(() => undefined);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { background = document.visibilityState !== "visible"; });
  }
  return () => background;
}

function shellFor(cap: CapacitorBridge, platform: NativePlatform): NativeShell {
  const app = plugin<AppPlugin>(cap, "App");
  const browser = plugin<BrowserPlugin>(cap, "Browser");
  const notifications = plugin<NotificationsPlugin>(cap, "LocalNotifications");
  const share = plugin<SharePlugin>(cap, "Share");
  const statusBar = plugin<StatusBarPlugin>(cap, "StatusBar");
  const gateway = plugin<GatewayPlugin>(cap, "HuiGateway");
  const background = backgroundState(cap);
  const resume: Array<() => void> = [];
  const back: Array<() => boolean> = [];

  listen(app, "appStateChange", (data) => {
    if ((data as { isActive?: boolean } | undefined)?.isActive === true) for (const callback of [...resume]) callback();
  });
  // The shell asks the page before it acts: it dispatches a cancelable `hui:back` from its own back callback, which
  // runs before Capacitor's App plugin would only walk the history. Every registered callback answers, and one that
  // answers `true` keeps the press by cancelling the event. An unconsumed press never reaches this module: the shell
  // goes back in the page's history itself, and at the root leaves the app on a second press.
  const onBackPress = (event: Event) => {
    let consumed = false;
    for (const callback of [...back]) if (callback() === true) consumed = true;
    if (consumed) event.preventDefault();
  };
  if (typeof document !== "undefined") document.addEventListener("hui:back", onBackPress);
  // A tapped notification opens the session it announced, whether the app was running or started for it.
  listen(notifications, "localNotificationActionPerformed", (data) => {
    const extra = (data as { notification?: { extra?: unknown } } | undefined)?.notification?.extra;
    const path = (extra as { path?: unknown } | undefined)?.path;
    if (typeof path === "string") openPath(path);
  });
  // Android 13+ and iOS refuse a notification until the app has asked once. The shell asks as it starts: a request made
  // from the background would never reach the operator, and the notification it was about would vanish.
  void notifications?.checkPermissions?.()
    .then((permissions) => (permissions.display === "granted" ? undefined : notifications?.requestPermissions?.()))
    .catch(() => undefined);

  return {
    platform,
    async openExternal(url) {
      try {
        await browser?.open?.({ url });
      } catch { /* A shell without the plugin cannot open another origin; nothing else here should break. */ }
    },
    async notify(notification) {
      // The visible page already shows this session; only a backgrounded shell has to say it out loud.
      if (!background()) return;
      try {
        await notifications?.schedule?.({
          notifications: [{
            id: notification.id,
            title: notification.title,
            body: notification.body,
            extra: { path: notification.path },
            // Posted now, never at a time we picked: asking for an exact alarm would open the "Allow exact alarms?"
            // prompt, and from the background that prompt is never answered, so the notification would never arrive.
            isExactNotification: false,
          }],
        });
      } catch { /* A refused permission or a missing plugin must not break the session that settled. */ }
    },
    async share(content) {
      try {
        await share?.share?.(content);
      } catch { /* The operator closed the sheet. */ }
    },
    async setStatusBar({ dark }) {
      try {
        await statusBar?.setStyle?.({ style: dark ? "DARK" : "LIGHT" });
      } catch { /* An older shell without the plugin keeps the system's own bar. */ }
    },
    onResume(callback) {
      resume.push(callback);
      return () => {
        const index = resume.indexOf(callback);
        if (index >= 0) resume.splice(index, 1);
      };
    },
    onBack(callback) {
      back.push(callback);
      return () => {
        const index = back.indexOf(callback);
        if (index >= 0) back.splice(index, 1);
      };
    },
    async forgetGateway() {
      try {
        await gateway?.forget?.();
      } catch { /* The Connect page is the shell's own; a failure still leaves the address in place. */ }
    },
  };
}

/** One shell per injected bridge, so its listeners and background state are registered once however many places ask. */
const shells = new WeakMap<CapacitorBridge, NativeShell>();

/** The shell in the app, `null` in a browser. */
export function nativeShell(): NativeShell | null {
  const found = phone();
  if (!found) return null;
  const existing = shells.get(found.cap);
  if (existing) return existing;
  const shell = shellFor(found.cap, found.platform);
  shells.set(found.cap, shell);
  return shell;
}
