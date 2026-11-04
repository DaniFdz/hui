/**
 * The Dashboard chart's series: what each metric plots, the top of the axis every machine shares, and where each
 * sample sits in a window that ends now. A metric the machine cannot report is left out of its line.
 */
import type { HostMetrics } from "../api/schema/host.ts";

export type ChartMetric = "cpu" | "memory" | "disk" | "gpu" | "network" | "process";
type Reading = {
  label: string;
  read: (metrics: HostMetrics) => number | null;
  /** A share of a full scale the axis always shows; without it the axis follows the busiest machine, never below
   * `floor`, so an idle machine's noise is not drawn as a mountain. */
  full?: number;
  floor?: number;
};
export type MetricChart = Record<ChartMetric, Reading>;

const share = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

/** In the order the chart's switch offers them. */
export const CHART_METRICS: MetricChart = {
  cpu: { label: "CPU", floor: 10, read: (metrics) => metrics.cpu.percent },
  memory: { label: "Memory", full: 100, read: (metrics) => share(metrics.memory.usedBytes, metrics.memory.totalBytes) },
  disk: { label: "Disk", full: 100, read: (metrics) => metrics.disk ? share(metrics.disk.usedBytes, metrics.disk.totalBytes) : null },
  gpu: { label: "GPU", floor: 10, read: (metrics) => metrics.gpu?.percent ?? null },
  network: { label: "Network", read: (metrics) => metrics.network ? metrics.network.rxBytesPerSecond + metrics.network.txBytesPerSecond : null },
  process: { label: "Process", floor: 10, read: (metrics) => metrics.gateway.cpuPercent },
};

export const CHART_METRIC_KEYS = Object.keys(CHART_METRICS) as ChartMetric[];

export const CHART_WINDOWS = [5, 15, 30] as const;
export type ChartWindow = (typeof CHART_WINDOWS)[number];

export type Point = { x: number; y: number; at: number };
export type Series = { points: Point[]; latest: number | null };
/** How far from a hovered instant a sample still counts as that instant's reading. */
export const HOVER_TOLERANCE_MS = 60_000;

/** The sample closest to `at` across the machines shown, so a pointer anywhere in the plot names a time something was
 * actually read at. */
export function snapTime(series: readonly Series[], at: number): number | null {
  let closest: number | null = null;
  for (const line of series) {
    for (const point of line.points) {
      if (closest === null || Math.abs(point.at - at) < Math.abs(closest - at)) closest = point.at;
    }
  }
  return closest;
}

/** A line's reading at `at`: its nearest sample, or nothing when the line has none near enough. */
export function valueAt(series: Series | undefined, at: number, toleranceMs = HOVER_TOLERANCE_MS): Point | null {
  let closest: Point | null = null;
  for (const point of series?.points ?? []) {
    if (Math.abs(point.at - at) > toleranceMs) continue;
    if (closest === null || Math.abs(point.at - at) < Math.abs(closest.at - at)) closest = point;
  }
  return closest;
}

/** `x` and `y` are shares of the plot, so the view maps them onto whatever size it draws at. */
export function chartSeries(samples: readonly (readonly HostMetrics[])[], metric: ChartMetric, minutes: number, now: number): { top: number; series: Series[] } {
  const { full, floor, read } = CHART_METRICS[metric];
  const start = now - minutes * 60_000;
  const read1 = (samples_: readonly HostMetrics[]) => samples_
    .map((sample) => ({ at: Date.parse(sample.sampledAt), value: read(sample) }))
    .filter((entry): entry is { at: number; value: number } => entry.value !== null);
  const all = samples.map(read1);
  const highest = Math.max(0, ...all.map((entries) => Math.max(0, ...entries.map((entry) => entry.value))));
  const top = full ?? Math.max(highest, floor ?? 1);
  return {
    top,
    series: all.map((entries) => {
      const shown = entries.filter((entry) => entry.at >= start);
      return {
        points: shown.map((entry) => ({ x: (entry.at - start) / (now - start), y: entry.value / top, at: entry.at })),
        latest: entries.at(-1)?.value ?? null,
      };
    }),
  };
}
