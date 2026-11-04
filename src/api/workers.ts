/**
 * Browser client for remote workers: listing, adding, editing and removing them and requesting connect, sync or
 * disconnect. Those operations run in the gateway; the UI polls the list for progress.
 */
import { fetchJson } from "./request.ts";
import type { WorkerInput, WorkerMetrics, WorkerMetricsHistoryResponse, WorkerMetricsResponse, WorkerView, WorkersResponse, WorkerResponse } from "./schema/workers.ts";
import type { HostMetrics } from "./schema/host.ts";

export type { WorkerInput, WorkerMetrics, WorkerView };

const WORKERS_URL = "/__hui/workers";
const JSON_HEADERS = { "content-type": "application/json" } as const;
const workerUrl = (id: string, suffix = "") => `${WORKERS_URL}/${encodeURIComponent(id)}${suffix}`;

export async function loadWorkers(): Promise<WorkerView[]> {
  return (await fetchJson<WorkersResponse>(WORKERS_URL)).workers ?? [];
}

/** Each worker's own machine: resource use for a connected one, its state and why for the rest. */
export async function loadWorkerMetrics(): Promise<WorkerMetrics[]> {
  return (await fetchJson<WorkerMetricsResponse>(`${WORKERS_URL}/metrics`)).workers ?? [];
}

/** The samples the given workers kept for the last `minutes`, for the Dashboard's chart, by worker id. */
export async function loadWorkerMetricsHistory(minutes: number, ids: readonly string[]): Promise<Map<string, readonly HostMetrics[]>> {
  const query = new URLSearchParams({ minutes: String(minutes), ids: ids.join(",") });
  const { workers } = await fetchJson<WorkerMetricsHistoryResponse>(`${WORKERS_URL}/metrics/history?${query}`);
  return new Map((workers ?? []).map((worker) => [worker.id, worker.history] as const));
}

export async function createWorker(input: WorkerInput): Promise<WorkerView> {
  return (await fetchJson<WorkerResponse>(WORKERS_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) })).worker;
}

export async function updateWorker(id: string, input: Partial<WorkerInput>): Promise<WorkerView> {
  return (await fetchJson<WorkerResponse>(workerUrl(id), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(input) })).worker;
}

export async function removeWorker(id: string): Promise<void> {
  await fetchJson(workerUrl(id), { method: "DELETE" });
}

/** Connect, sync and disconnect run in the gateway; poll the list for progress. */
export async function workerAction(id: string, action: "connect" | "sync" | "disconnect"): Promise<void> {
  await fetchJson(workerUrl(id, `/${action}`), { method: "POST" });
}
