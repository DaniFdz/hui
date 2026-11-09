/**
 * The `worker_stats` view an agent reads before choosing where a session runs: this gateway's machine and every
 * configured worker, with their resources, connection state and session counts, plus the least loaded connected
 * choice. Pure so the ranking is testable without starting a worker; `services.ts` gathers the samples.
 */
import type { HostMetrics } from "../api/host.ts";
import type { WorkerMetrics, WorkerState } from "../api/workers.ts";
import type { SessionStatus } from "../api/sessions.ts";

export type WorkerStatsInput = {
  /** Where the caller runs: `local`, or a worker id. */
  current: string;
  local: { metrics?: HostMetrics; error?: string; hostname?: string };
  workers: readonly (WorkerMetrics & { hostname?: string })[];
  sessions: readonly { worker?: string; status: SessionStatus; archived?: boolean }[];
};

export type MachineStats = {
  id: string;
  name: string;
  current: boolean;
  state: WorkerState | "local";
  hostname?: string;
  platform?: string;
  cores?: number;
  cpuPercent?: number;
  load?: readonly number[];
  memory?: { usedBytes: number; totalBytes: number; percent: number };
  disk?: { usedBytes: number; totalBytes: number; percent: number } | null;
  gpuPercent?: number | null;
  gateway?: { cpuPercent: number; rssBytes: number };
  sessions: { total: number; running: number };
  error?: string;
};

export type WorkerStats = {
  current: string;
  machines: MachineStats[];
  recommended?: { id: string; name: string; reason: string };
  sampledAt: string;
};

const percent = (used: number, total: number): number => total > 0 ? Math.round(used / total * 1000) / 10 : 0;

function machine(
  input: { id: string; name: string; state: WorkerState | "local"; hostname?: string; metrics?: HostMetrics; error?: string },
  current: string,
  sessions: WorkerStatsInput["sessions"],
): MachineStats {
  const counts = sessions.filter((session) => !session.archived && (session.worker ?? "local") === input.id);
  const metrics = input.metrics;
  return {
    id: input.id,
    name: input.name,
    current: input.id === current,
    state: input.state,
    ...(input.hostname ? { hostname: input.hostname } : {}),
    ...(metrics ? {
      platform: metrics.host.platform,
      cores: metrics.host.cores,
      cpuPercent: metrics.cpu.percent,
      load: metrics.cpu.load,
      memory: { ...metrics.memory, percent: percent(metrics.memory.usedBytes, metrics.memory.totalBytes) },
      disk: metrics.disk ? { ...metrics.disk, percent: percent(metrics.disk.usedBytes, metrics.disk.totalBytes) } : null,
      gpuPercent: metrics.gpu?.percent ?? null,
      gateway: metrics.gateway,
    } : {}),
    sessions: { total: counts.length, running: counts.filter((session) => session.status === "running").length },
    ...(input.error ? { error: input.error } : {}),
  };
}

/** Lower is less loaded. A running session costs more than an idle one; a disconnected machine has no score. */
function score(machine: MachineStats): number | undefined {
  if (machine.state !== "local" && machine.state !== "connected") return undefined;
  if (machine.cpuPercent === undefined) return undefined;
  return (machine.cpuPercent ?? 0)
    + (machine.memory?.percent ?? 0)
    + (machine.disk?.percent ?? 0)
    + machine.sessions.running * 15
    + machine.sessions.total * 2;
}

export function summarizeWorkerStats(input: WorkerStatsInput): WorkerStats {
  const machines: MachineStats[] = [
    machine({ id: "local", name: "This machine", state: "local", hostname: input.local.hostname, metrics: input.local.metrics, error: input.local.error }, input.current, input.sessions),
    ...input.workers.map((worker) => machine({
      id: worker.id,
      name: worker.name,
      state: worker.state,
      hostname: worker.hostname,
      metrics: worker.metrics,
      error: worker.error,
    }, input.current, input.sessions)),
  ];
  const ranked = machines
    .map((entry) => ({ entry, value: score(entry) }))
    .filter((entry): entry is { entry: MachineStats; value: number } => entry.value !== undefined)
    .sort((left, right) => left.value - right.value);
  return {
    current: input.current,
    machines,
    ...(ranked[0] ? {
      recommended: {
        id: ranked[0].entry.id,
        name: ranked[0].entry.name,
        reason: "lowest CPU, memory and disk use, weighted by running sessions",
      },
    } : {}),
    sampledAt: input.local.metrics?.sampledAt ?? new Date().toISOString(),
  };
}
