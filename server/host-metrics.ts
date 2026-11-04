/**
 * Samples the gateway host's CPU, memory, disk, network and GPU use and the gateway process's own share. Rates and
 * percentages are deltas against the previous sample this module keeps; one sample serves every caller for
 * `MIN_INTERVAL_MS`, and concurrent callers share the read in flight, so open tabs don't multiply the cost. Child
 * processes run asynchronously with a timeout, and a metric the host can't report is `null`. The GPU gauge is read
 * on its own slower cadence, since one `ioreg` run there costs more than every other read together. The last
 * `HISTORY_MS` of samples stays here for the Dashboard's chart: the reads a page asks for fill it, and
 * `sampleInBackground` keeps it filling when no page is open.
 */
import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import type { HostMetrics } from "./api/host.ts";
import { CONFIG_DIR } from "./paths.ts";

const execFileAsync = promisify(execFile);
const MIN_INTERVAL_MS = 2_000;
const STALE_BASELINE_MS = 30_000;
const FIRST_GAP_MS = 250;
const COMMAND_TIMEOUT_MS = 2_000;
const GPU_INTERVAL_MS = 20_000;
/** What the Dashboard's chart can show, per host. */
export const HISTORY_MS = 30 * 60_000;
/** How often a host samples itself with no page watching, so a chart opened later has a past to draw. */
export const BACKGROUND_SAMPLE_MS = 15_000;
const VIRTUAL_DARWIN = /^(lo|utun|bridge|awdl|llw)/u;
const VIRTUAL_LINUX = /^(lo|veth|docker|br-|virbr)/u;

export type RawSample = {
  at: number;
  cpu: { idle: number; total: number };
  load: number[];
  cores: number;
  memory: HostMetrics["memory"];
  disk: HostMetrics["disk"];
  network: { rx: number; tx: number } | null;
  gpuPercent: number | null;
  process: { cpuMicros: number; rssBytes: number };
};

/** `netstat -ib` lists each interface once with a `<Link#N>` network, and its Address column can be empty, so the
 * counters are read from the row's end. Tunnels and bridges repeat traffic a physical interface already counts. */
export function parseNetstat(text: string): { rx: number; tx: number } | null {
  let rx = 0, tx = 0, found = false;
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/u);
    if (!fields[2]?.startsWith("<Link#") || VIRTUAL_DARWIN.test(fields[0] ?? "")) continue;
    const ibytes = Number(fields.at(-5)), obytes = Number(fields.at(-2));
    if (!Number.isFinite(ibytes) || !Number.isFinite(obytes)) continue;
    rx += ibytes;
    tx += obytes;
    found = true;
  }
  return found ? { rx, tx } : null;
}

export function parseProcNetDev(text: string): { rx: number; tx: number } | null {
  let rx = 0, tx = 0, found = false;
  for (const line of text.split("\n")) {
    const [name, counters] = line.split(":");
    if (counters === undefined || VIRTUAL_LINUX.test(name?.trim() ?? "")) continue;
    const fields = counters.trim().split(/\s+/u).map(Number);
    if (!Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;
    rx += fields[0]!;
    tx += fields[8]!;
    found = true;
  }
  return found ? { rx, tx } : null;
}

/** `os.freemem()` on macOS leaves inactive and purgeable pages out, overstating what is in use. */
export function parseVmStat(text: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/u.exec(text)?.[1]);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`, "u").exec(text)?.[1]);
  const used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor");
  return Number.isFinite(pageSize * used) ? pageSize * used : null;
}

export function parseSwapUsage(text: string): number | null {
  const match = /used = ([\d.]+)([KMG])/u.exec(text);
  return match ? Number(match[1]) * 1024 ** (" KMG".indexOf(match[2]!)) : null;
}

export function parseMeminfoSwap(text: string): number | null {
  const kb = (label: string) => Number(new RegExp(`^${label}:\\s+(\\d+) kB`, "mu").exec(text)?.[1]);
  const used = (kb("SwapTotal") - kb("SwapFree")) * 1024;
  return Number.isFinite(used) ? used : null;
}

/** Apple Silicon reports "Device Utilization %" here without sudo. */
export function parseIoregGpu(text: string): number | null {
  const values = [...text.matchAll(/"Device Utilization %"\s*=\s*(\d+)/gu)].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : null;
}

export function parseNvidiaSmi(text: string): number | null {
  const values = text.split("\n").map((line) => line.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

async function run(file: string, args: string[]): Promise<string | undefined> {
  try {
    return (await execFileAsync(file, args, { timeout: COMMAND_TIMEOUT_MS, encoding: "utf8" })).stdout;
  } catch {
    return undefined;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

const parsed = <T>(text: string | undefined, parse: (text: string) => T | null): T | null =>
  text === undefined ? null : parse(text);

/** A reading taken on its own cadence: one that is fresh answers at once, one that expired answers at once too while
 * the next read runs, and only a reading never taken waits for one. */
export function createGauge<T>(read: () => Promise<T>, intervalMs: number): () => Promise<T | null> {
  let known: { value: T; at: number } | undefined;
  let pending: Promise<void> | undefined;
  return () => {
    if (known && Date.now() - known.at < intervalMs) return Promise.resolve(known.value);
    pending ??= read().then((value) => { known = { value, at: Date.now() }; }, () => undefined).finally(() => { pending = undefined; });
    return known ? Promise.resolve(known.value) : pending.then(() => known?.value ?? null);
  };
}

let gpu: { platform: NodeJS.Platform; read: () => Promise<number | null> } | undefined;

function gpuReader(platform: NodeJS.Platform): () => Promise<number | null> {
  if (gpu?.platform !== platform) {
    const darwin = platform === "darwin";
    gpu = { platform, read: createGauge(async () => parsed(await (darwin
      ? run("/usr/sbin/ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"])
      : platform === "linux" ? run("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"]) : undefined),
    darwin ? parseIoregGpu : parseNvidiaSmi), GPU_INTERVAL_MS) };
  }
  return gpu.read;
}

async function disk(path: string): Promise<HostMetrics["disk"]> {
  try {
    const stats = await statfs(path);
    const totalBytes = stats.blocks * stats.bsize;
    return { path, totalBytes, usedBytes: totalBytes - stats.bavail * stats.bsize };
  } catch {
    return null;
  }
}

export async function collect(platform: NodeJS.Platform = process.platform): Promise<RawSample> {
  const darwin = platform === "darwin", linux = platform === "linux";
  // Every counter and the stamp that dates it are taken together, before the
  // child processes answer, so all three deltas cover the same window.
  const at = Date.now();
  const cores = cpus();
  const usage = process.cpuUsage();
  const [vmStat, swap, network, gpu, diskUsage] = await Promise.all([
    darwin ? run("/usr/bin/vm_stat", []) : undefined,
    darwin ? run("/usr/sbin/sysctl", ["vm.swapusage"]) : linux ? readText("/proc/meminfo") : undefined,
    darwin ? run("/usr/sbin/netstat", ["-ib"]) : linux ? readText("/proc/net/dev") : undefined,
    gpuReader(platform)(),
    disk(CONFIG_DIR),
  ]);
  const cpu = cores.reduce((sum, core) => {
    const { idle, user, nice, sys, irq } = core.times;
    return { idle: sum.idle + idle, total: sum.total + idle + user + nice + sys + irq };
  }, { idle: 0, total: 0 });
  const totalBytes = totalmem();
  const swapUsedBytes = parsed(swap, darwin ? parseSwapUsage : parseMeminfoSwap);
  return {
    at,
    cpu,
    load: loadavg(),
    cores: cores.length,
    memory: {
      totalBytes,
      usedBytes: Math.min(totalBytes, parsed(vmStat, parseVmStat) ?? totalBytes - freemem()),
      ...swapUsedBytes === null ? {} : { swapUsedBytes },
    },
    disk: diskUsage,
    network: parsed(network, darwin ? parseNetstat : parseProcNetDev),
    gpuPercent: gpu,
    process: { cpuMicros: usage.user + usage.system, rssBytes: process.memoryUsage.rss() },
  };
}

const round = (value: number) => Math.round(value * 10) / 10;
const rate = (now: number, then: number, seconds: number) => Math.max(0, (now - then) / seconds);

export function metricsBetween(previous: RawSample, current: RawSample, platform: string): HostMetrics {
  const seconds = Math.max(0.001, (current.at - previous.at) / 1000);
  const total = current.cpu.total - previous.cpu.total;
  const idle = current.cpu.idle - previous.cpu.idle;
  return {
    sampledAt: new Date(current.at).toISOString(),
    host: { platform, cores: current.cores },
    cpu: { percent: total > 0 ? round(Math.min(100, Math.max(0, 100 * (1 - idle / total)))) : 0, load: current.load.map(round) },
    memory: current.memory,
    disk: current.disk,
    network: current.network && previous.network ? {
      rxBytesPerSecond: Math.round(rate(current.network.rx, previous.network.rx, seconds)),
      txBytesPerSecond: Math.round(rate(current.network.tx, previous.network.tx, seconds)),
    } : null,
    gpu: current.gpuPercent === null ? null : { percent: current.gpuPercent },
    gateway: {
      cpuPercent: round(rate(current.process.cpuMicros, previous.process.cpuMicros, seconds) / 10_000),
      rssBytes: current.process.rssBytes,
    },
  };
}

/** Keeps a host's samples coming with no page asking. The timer is unref'd: it never holds the process open by itself. */
export function sampleInBackground(hostMetrics: () => Promise<HostMetrics>, intervalMs = BACKGROUND_SAMPLE_MS): void {
  setInterval(() => { void hostMetrics().catch(() => undefined); }, intervalMs).unref();
}

export function createHostMetrics(read: () => Promise<RawSample> = collect, platform: string = process.platform) {
  let previous: RawSample | undefined;
  let last: { at: number; metrics: HostMetrics } | undefined;
  let pending: Promise<HostMetrics> | undefined;
  const samples: HostMetrics[] = [];

  /** The samples of the last `minutes`, oldest first. */
  function history(minutes: number): HostMetrics[] {
    const since = Date.now() - Math.min(minutes, HISTORY_MS / 60_000) * 60_000;
    return samples.filter((sample) => Date.parse(sample.sampledAt) >= since);
  }

  async function sample(): Promise<HostMetrics> {
    if (!previous || Date.now() - previous.at > STALE_BASELINE_MS) {
      previous = await read();
      // A slow read (macOS commands take a while) already spans the gap the rates need.
      const waited = Date.now() - previous.at;
      if (waited < FIRST_GAP_MS) await delay(FIRST_GAP_MS - waited);
    }
    const current = await read();
    const metrics = metricsBetween(previous, current, platform);
    previous = current;
    last = { at: Date.now(), metrics };
    if (samples.at(-1)?.sampledAt !== metrics.sampledAt) {
      samples.push(metrics);
      while (samples.length > 1 && Date.parse(samples[0]!.sampledAt) < Date.parse(metrics.sampledAt) - HISTORY_MS) samples.shift();
    }
    return metrics;
  }

  function hostMetrics(): Promise<HostMetrics> {
    if (last && Date.now() - last.at < MIN_INTERVAL_MS) return Promise.resolve(last.metrics);
    return pending ??= sample().finally(() => { pending = undefined; });
  }

  return Object.assign(hostMetrics, { history });
}
