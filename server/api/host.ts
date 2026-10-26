/** Public payloads of the gateway host's metrics: CPU, memory, disk, network, GPU and the gateway process. */
import { Type, type Static } from "typebox";

export const HostMetrics = Type.Object({
  sampledAt: Type.String(),
  host: Type.Object({ platform: Type.String(), cores: Type.Number() }),
  cpu: Type.Object({ percent: Type.Number(), load: Type.Array(Type.Number()) }),
  memory: Type.Object({ totalBytes: Type.Number(), usedBytes: Type.Number(), swapUsedBytes: Type.Optional(Type.Number()) }),
  disk: Type.Union([Type.Object({ path: Type.String(), totalBytes: Type.Number(), usedBytes: Type.Number() }), Type.Null()]),
  network: Type.Union([Type.Object({ rxBytesPerSecond: Type.Number(), txBytesPerSecond: Type.Number() }), Type.Null()]),
  gpu: Type.Union([Type.Object({ percent: Type.Number() }), Type.Null()]),
  gateway: Type.Object({ cpuPercent: Type.Number(), rssBytes: Type.Number() }),
}, { $id: "HostMetrics" });
export type HostMetrics = Static<typeof HostMetrics>;

export const HostMetricsError = Type.Object({ error: Type.String() }, { $id: "HostMetricsError" });
export type HostMetricsError = Static<typeof HostMetricsError>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/host-metrics", response: HostMetrics },
];
