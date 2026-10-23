/** The Settings pages in their list order, with the group each sits under, and the search that keeps the pages whose name or group matches; shared by the web's Settings shell and the iOS app. */
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
