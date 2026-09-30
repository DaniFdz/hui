export type HuiPage = {
  id: string;
  label: string;
  area: string;
  summary: string;
};

/** Routed HUI pages. Each one is served at `/<id>` and has a real renderer;
 * sessions, Settings and the Kanban board have their own routes. */
const PAGE_ROWS = [
  ["about", "About", "System", "Version, runtime, licenses and diagnostic links."],
  ["activity", "Activity", "Operations", "Gateway activity and recent operational events."],
  ["config", "Config", "Settings", "PI configuration and its effective sources."],
  ["connection", "Connection", "System", "Gateway URL, authentication and connection diagnostics."],
  ["cron", "Automations", "Automation", "Scheduled jobs, run history and manual triggers."],
  ["debug", "Debug", "System", "Logs, RPC inspection and diagnostic actions."],
  ["labs", "Labs", "Experimental", "Experimental and opt-in product features."],
  ["logs", "Logs", "System", "Live gateway logs and filtering."],
  ["memory-import", "Memory Import", "Memory", "Import and inspect long-term memory sources."],
  ["model-providers", "Model Providers", "Models", "Provider credentials, models and availability."],
  ["model-setup", "Model Setup", "Models", "Default model, fallback and thinking configuration."],
  ["new-session", "New Session", "Sessions", "Create a session with workspace options."],
  ["plugin", "Plugin", "Extensions", "One plugin's details, permissions and actions."],
  ["plugins", "Plugins", "Extensions", "Installed plugins, lifecycle and discovery."],
  ["profile", "Profile", "Identity", "User profile and presentation preferences."],
  ["sessions", "Sessions", "Sessions", "Session registry, search, groups and lifecycle."],
  ["skill-workshop", "Skill Workshop", "Extensions", "Create, review and publish skills."],
  ["skills", "Skills", "Extensions", "Installed skills, descriptions and discovery roots."],
  ["tasks", "Tasks", "Automation", "Durable tasks, run controls and task history."],
  ["usage", "Usage", "Models", "Token, cost and model usage reporting."],
] as const;

export type HuiPageId = (typeof PAGE_ROWS)[number][0];

export const HUI_PAGES: readonly HuiPage[] = PAGE_ROWS.map(([id, label, area, summary]) => ({ id, label, area, summary }));
