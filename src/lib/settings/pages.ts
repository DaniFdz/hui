/** The Settings pages in their list order, with the group each sits under, the search that keeps the pages whose name or group matches, and the words Settings shows (page introductions, the empty search, Color mode, Text size, Message width and Send shortcut names, the notification link names and everything Settings → Notifications → This device says), read by the web's Settings shell. */
import type { TextScaleStop } from "../theme/appearance.ts";
import type { ThemeMode } from "../theme/theme.ts";
import type { MessageWidth, SendShortcut } from "../appearance/store.ts";
import type { NtfySettings } from "../../api/schema/settings.ts";
import type { PushDeviceState } from "../notifications/web-push.ts";

export const SETTINGS_PAGES = [
  { id: "appearance", label: "Appearance", group: "", icon: "palette" },
  { id: "notifications", label: "Notifications", group: "", icon: "bell" },
  { id: "connection", label: "Gateway", group: "Connections", icon: "radio" },
  { id: "integrations", label: "Integrations", group: "Connections", icon: "grid" },
  { id: "workers", label: "Workers", group: "Connections", icon: "globe" },
  { id: "models", label: "Models", group: "Agents & Tools", icon: "box" },
  { id: "plugins", label: "Plugins", group: "Agents & Tools", icon: "plug" },
  { id: "extensions", label: "Extensions", group: "Agents & Tools", icon: "package" },
  { id: "skills", label: "Skills", group: "Agents & Tools", icon: "zap" },
  { id: "tools", label: "Tools", group: "Agents & Tools", icon: "wrench" },
  { id: "memory", label: "Memory", group: "Agents & Tools", icon: "book" },
  { id: "automation", label: "Automation", group: "Agents & Tools", icon: "terminal" },
  { id: "security", label: "Privacy & Security", group: "Privacy & Security", icon: "shieldCheck" },
  { id: "worktrees", label: "Worktrees", group: "System", icon: "gitBranch" },
  { id: "diagnostics", label: "Diagnostics", group: "System", icon: "bug" },
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number]["id"];

export const SETTINGS_GROUPS = ["", "Connections", "Agents & Tools", "Privacy & Security", "System"] as const;

export function filterSettingsPages(query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? SETTINGS_PAGES.filter((page) => `${page.label} ${page.group}`.toLocaleLowerCase().includes(normalized))
    : [...SETTINGS_PAGES];
}

export const SETTINGS_COPY = {
  noMatch: "No settings match.",
  modes: { system: "System", light: "Light", dark: "Dark" },
  scales: { 90: "Small", 100: "Default", 110: "Large", 125: "XL", 140: "XXL" },
  messageWidths: { compact: "Compact", comfortable: "Comfortable", wide: "Wide" },
  sendShortcuts: { enter: "Enter", modifierEnter: "⌘/Ctrl + Enter" },
  notificationLinks: { web: "Browser", phone: "HUI on my phone", desktop: "HUI on my desktop" },
  /** Settings → Notifications → This device. One line per state a page can be in, so a button that cannot work is
   * never offered without the reason beside it. */
  push: {
    labels: {
      toggle: "Send notifications to this device",
      enable: "Enable on this device",
      disable: "Disable on this device",
      test: "Send test",
    },
    states: {
      ready: "This browser can receive Web Push. Switched on and enabled here, HUI pushes to it even when HUI is closed.",
      subscribed: "This device is subscribed. HUI pushes to it even when HUI is closed.",
      "ios-not-installed": "iPhone and iPad can only receive Web Push from an app on the Home Screen: Share → Add to Home Screen, then open HUI from the Home Screen and enable notifications here.",
      insecure: "Web Push needs a secure address. Open HUI over HTTPS, then enable notifications on this device.",
      blocked: "Notifications are blocked for HUI in this browser's site settings. Allow notifications for HUI there, then reload HUI and enable this device.",
      unsupported: "This browser cannot receive Web Push.",
    },
    fallback: "Phone (ntfy) stays the fallback: it needs the ntfy app, and it still reaches a phone whose browser cannot subscribe.",
    enabled: "This device now receives HUI's push notifications.",
    disabled: "This device no longer receives HUI's push notifications.",
    nothingToRemove: "This device had no push subscription to remove.",
    browserKept: "This gateway forgot this device, but the browser would not unsubscribe it. Nothing is pushed to it now: enable this device again to subscribe it cleanly.",
    noDevices: "No device accepted the test push yet. Enable this device first.",
    noAccept: "The test push reached no device: the push services refused it.",
  },
  intros: {
    appearance: "Theme, chat, and sidebar preferences for this device. Each browser, app and phone keeps its own.",
    notifications: "Agents can send you a desktop notification that opens their chat, through the HUI app on macOS.",
    connection: "Gateway access and live PI runtime state.",
    integrations: "Connect HUI to external services. Credentials stay on this machine and are never sent to the browser.",
    plugins: "PI packages and extension sources. Disable one to exclude it from new HUI SDK runtimes without uninstalling it or changing PI settings.",
    extensions: "Local gateway modules: their routes, their state and the switch that loads one for this gateway.",
    memory: "Workspace-local context and memory inventory. Nothing is copied into PI or OpenClaw.",
    automation: "Scheduled tasks, manual runs and run history owned by HUI.",
    security: "Local exposure, credential boundaries and diagnostic privacy.",
    worktrees: "Linked worktrees of the Git repositories your HUI sessions use, plus those New Session created in ~/.config/hui/worktrees. Main checkouts are not listed.",
    diagnostics: "Runtime logs, activity, health and a redacted diagnostic export.",
  },
} as const satisfies {
  noMatch: string;
  modes: Record<ThemeMode, string>;
  scales: Record<TextScaleStop, string>;
  messageWidths: Record<MessageWidth, string>;
  sendShortcuts: Record<SendShortcut, string>;
  notificationLinks: Record<NtfySettings["link"], string>;
  push: {
    labels: Record<"toggle" | "enable" | "disable" | "test", string>;
    states: Record<PushDeviceState | "subscribed", string>;
    fallback: string;
    enabled: string;
    disabled: string;
    nothingToRemove: string;
    browserKept: string;
    noDevices: string;
    noAccept: string;
  };
  intros: Partial<Record<SettingsPage, string>>;
};

/** How many devices this gateway pushes to, in the words Settings → Notifications → This device shows. */
export function describePushDevices(count: number | undefined): string {
  if (count === undefined) return "Reading the subscribed devices…";
  if (count === 0) return "No device is subscribed.";
  return count === 1 ? "1 device is subscribed." : `${count} devices are subscribed.`;
}

/** What one test push reports, in the counts the route answered with rather than a promise it cannot keep. */
export function describePushTest(sent: number, devices: number): string {
  if (devices === 0) return SETTINGS_COPY.push.noDevices;
  if (sent === 0) return SETTINGS_COPY.push.noAccept;
  const verb = sent === 1 ? "1 device" : `${sent} devices`;
  return sent === devices
    ? `The test push went to ${verb}.`
    : `The test push went to ${verb} of ${devices}.`;
}
