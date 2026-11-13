/** Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit. */

export type ModelMetric = { "at": number; "provider": string; "model": string; "inputTokens"?: number; "outputTokens"?: number; "cacheReadTokens"?: number; "cacheWriteTokens"?: number; "ttftMs"?: number; "durationMs"?: number; "generationMs"?: number; "tokensPerSecond"?: number; "promptTokensPerSecond"?: number; "status": ("ok") | ("error"); };

export type ModelMetricAverage = { "tokensPerSecond"?: number; "ttftMs"?: number; "promptTokensPerSecond"?: number; };

export type ModelMetricError = { "error": string; };

export type ModelMetricSession = { "metric"?: ModelMetric; };

export type ModelMetricSummary = { "provider": string; "since": number; "requests": number; "last"?: ModelMetric; "average": ModelMetricAverage; "p50": ModelMetricAverage; "p95": ModelMetricAverage; "samples": Array<ModelMetric>; };
