/**
 * The `pi` configuration the dashboard reports on, and which skills are enabled. Its requests live in src/api/pi.ts.
 *
 * These types mirror the server's `server/pi-config.ts`. They are redeclared
 * here rather than imported so the browser bundle never reaches into `server/`,
 * which imports `node:fs`. The HTTP payload is the contract between them.
 */
import type { RuntimeModel } from "../api/sessions.ts";

export type PiTool = {
  name: string;
  kind: "builtin" | "hui";
  source?: string;
};

export type PiSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  root: string;
  origin?: "hui";
  tags?: readonly string[];
  preferencePath?: string;
};

export function skillPreferencePath(skill: PiSkill): string {
  return skill.preferencePath ?? skill.path;
}

export function skillIsEnabled(skill: PiSkill, disabled: readonly { path: string }[]): boolean {
  return !disabled.some((entry) => entry.path === skillPreferencePath(skill) || entry.path === skill.path);
}

export type PiResourceDocument = {
  id: string;
  kind: "skill" | "package" | "extension";
  title: string;
  fileName: string;
  format: "markdown" | "code" | "json";
  content: string;
  truncated: boolean;
};

export type PiModel = {
  defaultProvider: string;
  defaultModel: string;
  thinking: string | null;
  enabled: readonly string[];
  authenticated: readonly string[];
  catalog: readonly (RuntimeModel & { contextWindow?: number; maxTokens?: number })[];
};

export type PiSettingsSummary = {
  path: string;
  exists: boolean;
  packages: readonly string[];
  extensions: readonly string[];
  resources: readonly PiConfiguredResource[];
  skillRoots: readonly string[];
};

export type PiConfiguredResource = {
  id: string;
  label: string;
  kind: "package" | "extension";
};

export type PiSnapshot = {
  agentDir: string;
  settings: PiSettingsSummary;
  skills: readonly PiSkill[];
  tools: readonly PiTool[];
  model: PiModel;
  diagnostics: readonly string[];
};

export type PiMutationKind = "package-install" | "package-remove" | "skill-install";

export type PiMutationResult = {
  kind: PiMutationKind;
  target: string;
  message: string;
  snapshot: PiSnapshot;
};

export type PiMutationState = {
  kind: PiMutationKind;
  target: string;
  status: "running" | "ok" | "error";
  message: string;
};
