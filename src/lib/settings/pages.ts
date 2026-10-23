/** The Settings pages in their list order, with the group each sits under, the search that keeps the pages whose name or group matches, and the words Settings shows (page introductions, the empty search, Color mode and Text size names); shared by the web's Settings shell and the iOS app. */
import type { TextScaleStop } from "../theme/appearance.ts";
import type { ThemeMode } from "../theme/theme.ts";

export const SETTINGS_PAGES = [
  { id: "appearance", label: "Appearance", group: "", icon: "palette" },
  { id: "connection", label: "Gateway", group: "Connections", icon: "radio" },
  { id: "integrations", label: "Integrations", group: "Connections", icon: "grid" },
  { id: "workers", label: "Workers", group: "Connections", icon: "globe" },
  { id: "models", label: "Models", group: "Agents & Tools", icon: "box" },
  { id: "plugins", label: "Plugins", group: "Agents & Tools", icon: "plug" },
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
  intros: {
    appearance: "Theme, chat, and sidebar preferences for this Control UI client.",
    connection: "Gateway access and live PI runtime state.",
    integrations: "Connect HUI to external services. Credentials stay on this machine and are never sent to the browser.",
    plugins: "PI packages and extension sources. Disable one to exclude it from new HUI SDK runtimes without uninstalling it or changing PI settings.",
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
  intros: Partial<Record<SettingsPage, string>>;
};
