import { fetchJson } from "./settings-store.ts";
import type { BotInput, WorkerBot, WorkerInput, WorkerView } from "../../shared/workers.ts";

export type { BotInput, WorkerBot, WorkerInput, WorkerView };

const WORKERS_URL = "/__hui/workers";
const JSON_HEADERS = { "content-type": "application/json" } as const;
const workerUrl = (id: string, suffix = "") => `${WORKERS_URL}/${encodeURIComponent(id)}${suffix}`;

export async function loadWorkers(): Promise<WorkerView[]> {
  return (await fetchJson<{ workers?: WorkerView[] }>(WORKERS_URL)).workers ?? [];
}

export async function createWorker(input: WorkerInput): Promise<WorkerView> {
  return (await fetchJson<{ worker: WorkerView }>(WORKERS_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) })).worker;
}

export async function updateWorker(id: string, input: Partial<WorkerInput>): Promise<WorkerView> {
  return (await fetchJson<{ worker: WorkerView }>(workerUrl(id), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(input) })).worker;
}

export async function removeWorker(id: string): Promise<void> {
  await fetchJson(workerUrl(id), { method: "DELETE" });
}

/** Connect, sync and disconnect run in the gateway; poll the list for progress. */
export async function workerAction(id: string, action: "connect" | "sync" | "disconnect"): Promise<void> {
  await fetchJson(workerUrl(id, `/${action}`), { method: "POST" });
}

export async function createBot(workerId: string, input: BotInput): Promise<WorkerBot> {
  return (await fetchJson<{ bot: WorkerBot }>(workerUrl(workerId, "/bots"), {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
  })).bot;
}

export async function updateBot(workerId: string, key: string, input: BotInput): Promise<WorkerBot> {
  return (await fetchJson<{ bot: WorkerBot }>(workerUrl(workerId, `/bots/${encodeURIComponent(key)}`), {
    method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
  })).bot;
}

export async function deleteBot(workerId: string, key: string): Promise<void> {
  await fetchJson(workerUrl(workerId, `/bots/${encodeURIComponent(key)}`), { method: "DELETE", signal: AbortSignal.timeout(60_000) });
}

export async function runBot(workerId: string, key: string): Promise<void> {
  await fetchJson(workerUrl(workerId, `/bots/${encodeURIComponent(key)}/run`), { method: "POST", signal: AbortSignal.timeout(60_000) });
}
