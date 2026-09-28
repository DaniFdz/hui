/**
 * The `pi` configuration the dashboard reports on.
 *
 * These types mirror the server's `server/pi-config.ts`. They are redeclared
 * here rather than imported so the browser bundle never reaches into `server/`,
 * which imports `node:fs`. The HTTP payload is the contract between them.
 */
import { fetchJson } from "./settings-store.ts";

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
  catalog: readonly { provider: string; id: string; name: string; contextWindow?: number; maxTokens?: number }[];
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

const PI_URL = "/__hui/pi";

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

/** Transport failures are intentionally not collapsed into an empty snapshot:
 * the caller owns an explicit loading/error/retry state. */
export function loadPiConfig(): Promise<PiSnapshot> {
  return fetchJson<PiSnapshot>(PI_URL);
}

export function loadPiResource(kind: "skill" | "plugin", id: string): Promise<PiResourceDocument> {
  return fetchJson<PiResourceDocument>(`${PI_URL}/resources/${kind}/${id}`);
}

function mutatePi(path: string, body: Record<string, string>, timeoutMs: number): Promise<PiMutationResult> {
  return fetchJson<PiMutationResult>(`${PI_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function installPiPackage(url: string): Promise<PiMutationResult> {
  return mutatePi("packages/install", { url }, 125_000);
}

export function removePiPackage(source: string): Promise<PiMutationResult> {
  return mutatePi("packages/remove", { source }, 125_000);
}

export function installPiSkill(url: string): Promise<PiMutationResult> {
  return mutatePi("skills/install", { url }, 305_000);
}
