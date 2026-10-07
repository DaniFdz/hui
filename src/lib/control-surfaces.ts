/**
 * Browser client for the gateway's read-mostly control surfaces: health, macOS power and the workspace
 * inspection of context files, memory and worktrees. The gateway gathers all of it; this module only fetches
 * and types the results.
 */
import type { PowerStatus } from "../../shared/power.ts";
import { fetchJson } from "./settings-store.ts";

export type GatewayHealth = {
  status: "online";
  transport: "HTTP + SSE";
  uptimeSeconds: number;
  access: "Full Access";
  sessions: {
    registered: number;
    starting: number;
    idle: number;
    running: number;
    waiting: number;
    error: number;
    reconnecting: number;
    disconnected: number;
    processes: number;
  };
};

export type MemorySource = {
  workspace: string;
  path: string;
  relativePath: string;
  kind: "context" | "memory";
  bytes: number;
  modifiedAt: string;
};

export type WorktreeView = {
  repository: string;
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  detached: boolean;
  sessionIds: readonly string[];
};

export type WorkspaceInspection = {
  workspaces: readonly string[];
  memory: readonly MemorySource[];
  worktrees: readonly WorktreeView[];
  diagnostics: readonly string[];
};

export function loadGatewayHealth(): Promise<GatewayHealth> {
  return fetchJson<GatewayHealth>("/__hui/health");
}

/** `null` when the gateway does not run on macOS. */
export async function loadPower(): Promise<PowerStatus | null> {
  return (await fetchJson<{ power: PowerStatus | null }>("/__hui/power")).power;
}

export async function setLidAwake(lidAwake: boolean): Promise<PowerStatus | null> {
  return (await fetchJson<{ power: PowerStatus | null }>("/__hui/power", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lidAwake }),
  })).power;
}

export function loadWorkspaceInspection(): Promise<WorkspaceInspection> {
  return fetchJson<WorkspaceInspection>("/__hui/workspaces");
}
