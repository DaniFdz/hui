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
    error: number;
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

export function loadWorkspaceInspection(): Promise<WorkspaceInspection> {
  return fetchJson<WorkspaceInspection>("/__hui/workspaces");
}
