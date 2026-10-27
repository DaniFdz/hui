/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type HostMetrics = { "sampledAt": string; "host": { "platform": string; "cores": number; }; "cpu": { "percent": number; "load": Array<number>; }; "memory": { "totalBytes": number; "usedBytes": number; "swapUsedBytes"?: number; }; "disk": ({ "path": string; "totalBytes": number; "usedBytes": number; }) | (null); "network": ({ "rxBytesPerSecond": number; "txBytesPerSecond": number; }) | (null); "gpu": ({ "percent": number; }) | (null); "gateway": { "cpuPercent": number; "rssBytes": number; }; };

export type HostMetricsError = { "error": string; };
