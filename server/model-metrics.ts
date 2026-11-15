/** HUI's own history of model-request measurements, one compact JSON line per completed request. It backs the
 * per-provider metrics dialog; the session's latest sample reaches the chat composer through the runtime event and
 * the session route, so the dashboard never has to guess from transcript timing.
 *
 * The file is capped: old samples roll off, and a compaction rewrites the last cap atomically. A sample carries the
 * session id only for the composer lookup; the public payload strips it. */
import { appendFile, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "./paths.ts";
import type { ModelMetric, ModelMetricAverage, ModelMetricSummary } from "./api/model-metrics.ts";

export type StoredModelMetric = ModelMetric & { session?: string };

/** Samples kept in memory and on disk after a roll-off. */
export const MODEL_METRIC_HISTORY = 5_000;
const COMPACT_AT = MODEL_METRIC_HISTORY * 2;

export function averageMetrics(samples: readonly ModelMetric[]): ModelMetricAverage {
  return averageOf(samples.map((sample) => ({
    tokensPerSecond: sample.tokensPerSecond,
    ttftMs: sample.ttftMs,
    promptTokensPerSecond: sample.promptTokensPerSecond,
  })));
}

export function percentileMetrics(samples: readonly ModelMetric[], percentile: number): ModelMetricAverage {
  const at = (values: readonly (number | undefined)[]): number | undefined => {
    const seen = values.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
    if (!seen.length) return undefined;
    const index = Math.min(seen.length - 1, Math.max(0, Math.ceil((percentile / 100) * seen.length) - 1));
    return seen[index];
  };
  return cleanAverage({
    tokensPerSecond: at(samples.map((sample) => sample.tokensPerSecond)),
    ttftMs: at(samples.map((sample) => sample.ttftMs)),
    promptTokensPerSecond: at(samples.map((sample) => sample.promptTokensPerSecond)),
  });
}

function averageOf(values: readonly ModelMetricAverage[]): ModelMetricAverage {
  const mean = (pick: (value: ModelMetricAverage) => number | undefined): number | undefined => {
    const seen = values.map(pick).filter((value): value is number => value !== undefined);
    return seen.length ? seen.reduce((sum, value) => sum + value, 0) / seen.length : undefined;
  };
  return cleanAverage({ tokensPerSecond: mean((v) => v.tokensPerSecond), ttftMs: mean((v) => v.ttftMs), promptTokensPerSecond: mean((v) => v.promptTokensPerSecond) });
}

function cleanAverage(value: ModelMetricAverage): ModelMetricAverage {
  return {
    ...(value.tokensPerSecond === undefined ? {} : { tokensPerSecond: value.tokensPerSecond }),
    ...(value.ttftMs === undefined ? {} : { ttftMs: value.ttftMs }),
    ...(value.promptTokensPerSecond === undefined ? {} : { promptTokensPerSecond: value.promptTokensPerSecond }),
  };
}

export class ModelMetricsStore {
  readonly file: string;
  #samples: StoredModelMetric[] = [];
  #ready: Promise<void>;
  #write: Promise<void> = Promise.resolve();

  constructor(dir = CONFIG_DIR) {
    this.file = join(dir, "model-metrics.jsonl");
    this.#ready = this.#load();
  }

  /** Records a completed request without delaying the stream. The line is appended in order. */
  record(metric: ModelMetric, session?: string): void {
    const sample: StoredModelMetric = { ...metric, ...(session ? { session } : {}) };
    this.#write = this.#write.then(async () => {
      await this.#ready;
      this.#samples.push(sample);
      if (this.#samples.length > COMPACT_AT) {
        this.#samples = this.#samples.slice(-MODEL_METRIC_HISTORY);
        await this.#compact();
      } else {
        await this.#append(sample);
      }
    }).catch(() => {
      // A full disk must never fail a model request; the in-memory history still serves the dialog.
    });
  }

  /** Test and shutdown seam: the queued samples are on disk. */
  async flush(): Promise<void> {
    await this.#ready;
    await this.#write;
  }

  async latestForSession(session: string): Promise<ModelMetric | undefined> {
    await this.#ready;
    const sample = this.#samples.findLast((entry) => entry.session === session);
    return sample ? publicMetric(sample) : undefined;
  }

  async summary(provider: string, since: number, samples = 80): Promise<ModelMetricSummary> {
    await this.#ready;
    const matching = this.#samples.filter((sample) => sample.provider === provider && sample.at >= since);
    const publicSamples = matching.slice(-samples).map(publicMetric);
    return {
      provider,
      since,
      requests: matching.length,
      ...(publicSamples.length ? { last: publicSamples[publicSamples.length - 1] } : {}),
      average: averageMetrics(matching),
      p50: percentileMetrics(matching, 50),
      p95: percentileMetrics(matching, 95),
      samples: publicSamples,
    };
  }

  async #load(): Promise<void> {
    try {
      const text = await readFile(this.file, "utf8");
      await chmod(this.file, 0o600).catch(() => undefined);
      const lines = text.split("\n").filter((line) => line.trim());
      const parsed = lines.slice(-MODEL_METRIC_HISTORY).flatMap((line) => {
        try {
          const value: unknown = JSON.parse(line);
          return isStoredMetric(value) ? [value] : [];
        } catch {
          return [];
        }
      });
      this.#samples = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.#samples = [];
    }
  }

  async #append(sample: StoredModelMetric): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, `${JSON.stringify(sample)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  /** Rewrites the capped in-memory history, replacing the file in one rename so a crash keeps a complete one. */
  async #compact(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const body = `${this.#samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`;
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.file);
  }
}

function publicMetric(sample: StoredModelMetric): ModelMetric {
  return {
    at: sample.at,
    provider: sample.provider,
    model: sample.model,
    status: sample.status,
    ...(sample.inputTokens === undefined ? {} : { inputTokens: sample.inputTokens }),
    ...(sample.outputTokens === undefined ? {} : { outputTokens: sample.outputTokens }),
    ...(sample.cacheReadTokens === undefined ? {} : { cacheReadTokens: sample.cacheReadTokens }),
    ...(sample.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: sample.cacheWriteTokens }),
    ...(sample.ttftMs === undefined ? {} : { ttftMs: sample.ttftMs }),
    ...(sample.durationMs === undefined ? {} : { durationMs: sample.durationMs }),
    ...(sample.generationMs === undefined ? {} : { generationMs: sample.generationMs }),
    ...(sample.tokensPerSecond === undefined ? {} : { tokensPerSecond: sample.tokensPerSecond }),
    ...(sample.promptTokensPerSecond === undefined ? {} : { promptTokensPerSecond: sample.promptTokensPerSecond }),
  };
}

function isStoredMetric(value: unknown): value is StoredModelMetric {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metric = value as Partial<StoredModelMetric>;
  return typeof metric.at === "number" && typeof metric.provider === "string" && typeof metric.model === "string"
    && (metric.status === "ok" || metric.status === "error")
    && (metric.session === undefined || typeof metric.session === "string");
}

/** The gateway's one history; tests construct their own store in a temporary directory. */
export const modelMetrics = new ModelMetricsStore();
