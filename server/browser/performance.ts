/**
 * What a page costs, read from the browser instead of guessed: the renderer's
 * counters (heap, DOM nodes, layouts, style recalculation, script and task time)
 * and the document's own navigation and paint timings.
 *
 * Chrome reports the counters in seconds and bytes, which is the wrong shape for
 * an agent to reason about, so this module turns them into the handful of lines
 * that answer "is this page slow, and what is doing the work". It is pure: the
 * manager reads CDP and the page, and tests here run without a browser.
 */

export type MetricMap = Readonly<Record<string, number>>;

export type NavigationTiming = Readonly<{
  /** Milliseconds from navigation start to the first byte of the response. */
  firstByte?: number;
  domContentLoaded?: number;
  load?: number;
  /** Bytes on the wire for the document itself. */
  transferSize?: number;
  decodedBodySize?: number;
  type?: string;
}>;

export type PaintTiming = Readonly<{ name: string; start: number }>;

const MEGABYTE = 1024 * 1024;

/** `942 ms`, `1.4 s`, `2 min 4 s` — one significant unit, never a fraction soup. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < MEGABYTE) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/** Chrome counts milliseconds; CDP's `Performance.getMetrics` counts seconds. */
function secondsToMs(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value * 1_000 : undefined;
}

function part(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${value}`;
}

/** The renderer's own counters as lines an agent can act on. */
export function describeMetrics(metrics: MetricMap): string[] {
  const used = metrics["JSHeapUsedSize"];
  const total = metrics["JSHeapTotalSize"];
  const heap = used === undefined
    ? undefined
    : total === undefined ? formatBytes(used) : `${formatBytes(used)} of ${formatBytes(total)}`;
  const counts = [
    part("heap", heap),
    part("nodes", metrics["Nodes"] === undefined ? undefined : String(Math.round(metrics["Nodes"]))),
    part("documents", metrics["Documents"] === undefined ? undefined : String(Math.round(metrics["Documents"]))),
    part("frames", metrics["Frames"] === undefined ? undefined : String(Math.round(metrics["Frames"]))),
    part("JS listeners", metrics["JSEventListeners"] === undefined ? undefined : String(Math.round(metrics["JSEventListeners"]))),
  ].filter((value): value is string => value !== undefined);

  const layouts = metrics["LayoutCount"] === undefined
    ? undefined
    : `${Math.round(metrics["LayoutCount"])}${metrics["LayoutDuration"] === undefined ? "" : ` (${formatDuration(secondsToMs(metrics["LayoutDuration"]) ?? 0)})`}`;
  const styles = metrics["RecalcStyleCount"] === undefined
    ? undefined
    : `${Math.round(metrics["RecalcStyleCount"])}${metrics["RecalcStyleDuration"] === undefined ? "" : ` (${formatDuration(secondsToMs(metrics["RecalcStyleDuration"]) ?? 0)})`}`;
  const script = secondsToMs(metrics["ScriptDuration"]);
  const task = secondsToMs(metrics["TaskDuration"]);

  const lines = [counts.length ? counts.join(" · ") : "The browser reported no counters for this page."];
  const work = [part("layouts", layouts), part("style recalcs", styles)].filter((value): value is string => value !== undefined);
  if (work.length) lines.push(work.join(" · "));
  if (script !== undefined || task !== undefined) {
    const share = script !== undefined && task !== undefined && task > 0 ? ` (${Math.round((script / task) * 100)}% of task time)` : "";
    lines.push(`script ${formatDuration(script ?? 0)} of ${formatDuration(task ?? 0)} task time${share}`);
  }
  return lines;
}

/** The document's navigation and paint entries, as one line each. */
export function describeTimings(timing: NavigationTiming | undefined, paints: readonly PaintTiming[]): string[] {
  const lines: string[] = [];
  if (!timing) {
    lines.push("The page has no navigation timing yet; it may still be loading.");
  } else {
    const marks = [
      part("first byte", timing.firstByte === undefined ? undefined : formatDuration(timing.firstByte)),
      part("DOMContentLoaded", timing.domContentLoaded === undefined ? undefined : formatDuration(timing.domContentLoaded)),
      part("load", timing.load === undefined ? undefined : formatDuration(timing.load)),
    ].filter((value): value is string => value !== undefined);
    const transfer = timing.transferSize === undefined
      ? undefined
      : `${formatBytes(timing.transferSize)}${timing.decodedBodySize !== undefined && timing.decodedBodySize !== timing.transferSize ? ` (${formatBytes(timing.decodedBodySize)} decoded)` : ""}`;
    const document = [part("document", transfer), part("type", timing.type)].filter((value): value is string => value !== undefined).join(" · ");
    lines.push(`Load: ${marks.length ? marks.join(", ") : "no marks reported"}${document ? ` · ${document}` : ""}`);
  }
  if (paints.length) {
    lines.push(`Paints: ${paints.map((paint) => `${paint.name} ${formatDuration(paint.start)}`).join(", ")}`);
  } else {
    lines.push("Paints: none reported yet.");
  }
  return lines;
}

/** Chrome's navigation entry names and units, normalized for `describeTimings`. */
export function navigationFromEntry(entry: Record<string, unknown> | undefined): NavigationTiming | undefined {
  if (!entry) return undefined;
  const read = (name: string): number | undefined => {
    const value = entry[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const load = read("loadEventEnd");
  return {
    ...(read("responseStart") !== undefined ? { firstByte: read("responseStart") } : {}),
    ...(read("domContentLoadedEventEnd") !== undefined ? { domContentLoaded: read("domContentLoadedEventEnd") } : {}),
    ...(load !== undefined && load > 0 ? { load } : {}),
    ...(read("transferSize") !== undefined ? { transferSize: read("transferSize") } : {}),
    ...(read("decodedBodySize") !== undefined ? { decodedBodySize: read("decodedBodySize") } : {}),
    ...(typeof entry["type"] === "string" ? { type: entry["type"] } : {}),
  };
}
