/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */
import type { HostMetrics } from "./host.ts";

export type WorkerActionResponse = { "ok": true; };

export type WorkerError = { "error": string; };

export type WorkerInput = { "name": string; "command": string; "extraPaths"?: Array<string>; };

export type WorkerMetrics = { "id": string; "name": string; "state": WorkerState; "metrics"?: HostMetrics; "error"?: string; };

export type WorkerMetricsResponse = { "workers": Array<WorkerMetrics>; };

export type WorkerPatch = { "name"?: string; "command"?: string; "extraPaths"?: Array<string>; };

export type WorkerResponse = { "worker": WorkerView; };

export type WorkerState = ("disconnected") | ("connecting") | ("connected") | ("error");

export type WorkerView = { "id": string; "name": string; "command": string; "extraPaths": Array<string>; "state": WorkerState; "phase"?: string; "error"?: string; "host"?: { "hostname": string; "platform": string; "arch": string; "node": string; "home": string; "release": string; }; "sync"?: { "at": string; "files": number; "uploaded": number; "deleted": number; "installed": Array<string>; "skipped": Array<string>; "errors": Array<string>; }; };

export type WorkersResponse = { "workers": Array<WorkerView>; };
