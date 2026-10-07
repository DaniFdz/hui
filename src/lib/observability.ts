/**
 * Browser client for the gateway's diagnostics: recent activity and logs, usage totals and runtime details,
 * plus a download of the redacted diagnostics export. The gateway collects and retains the events in memory.
 */
import { fetchJson } from "./settings-store.ts";

export type DiagnosticEvent = {
  id: number;
  timestamp: string;
  area: "gateway" | "session" | "runtime" | "automation" | "ui";
  level: "info" | "warning" | "error";
  action: string;
  summary: string;
  /** Redacted cause of a warning or error. */
  detail?: string;
  sessionId?: string;
};

export type ObservabilitySnapshot = {
  generatedAt: string;
  retention: { kind: "memory"; maximum: number; since: string };
  activity: readonly DiagnosticEvent[];
  logs: readonly DiagnosticEvent[];
  usage: {
    sessions: number;
    filesRead: number;
    records: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    costUsd: number | null;
    models: readonly { model: string; tokens: number }[];
    unavailable: readonly string[];
  };
  debug: {
    node: string;
    platform: string;
    uptimeSeconds: number;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    eventCount: number;
  };
};

export function loadObservability(): Promise<ObservabilitySnapshot> {
  return fetchJson<ObservabilitySnapshot>("/__hui/observability");
}

export async function downloadDiagnostics(): Promise<void> {
  const snapshot = await fetchJson<ObservabilitySnapshot>("/__hui/diagnostics/export");
  const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hui-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
