/** Public model-request measurements HUI takes itself: time to first token, generation and prompt throughput, token
 * counts and status. Time to first token counts from the request start PI records on the message to the first token
 * HUI sees, so it includes the progress interval before that partial commits; a response that reached HUI whole has no
 * split to measure and reports PI's own duration instead. Prompt throughput is an estimate: it includes queue and
 * prefill, which the stream cannot separate. The provider summary is stored history; the session payload is the latest
 * sample for the chat composer. */
import { Type, type Static } from "typebox";

export const ModelMetric = Type.Object({
  at: Type.Number(),
  provider: Type.String(),
  model: Type.String(),
  inputTokens: Type.Optional(Type.Number()),
  outputTokens: Type.Optional(Type.Number()),
  cacheReadTokens: Type.Optional(Type.Number()),
  cacheWriteTokens: Type.Optional(Type.Number()),
  /** Request start PI recorded to the first content token HUI saw; absent when HUI saw the answer only whole. */
  ttftMs: Type.Optional(Type.Number()),
  durationMs: Type.Optional(Type.Number()),
  /** First content token HUI saw to completion. */
  generationMs: Type.Optional(Type.Number()),
  /** Output tokens divided by `generationMs`, or by `durationMs` for a request HUI saw no separate generation of. */
  tokensPerSecond: Type.Optional(Type.Number()),
  /** New input tokens divided by `ttftMs`; includes queue and prefill, so it is an estimate. */
  promptTokensPerSecond: Type.Optional(Type.Number()),
  status: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
}, { $id: "ModelMetric" });
export type ModelMetric = Static<typeof ModelMetric>;

export const ModelMetricAverage = Type.Object({
  tokensPerSecond: Type.Optional(Type.Number()),
  ttftMs: Type.Optional(Type.Number()),
  promptTokensPerSecond: Type.Optional(Type.Number()),
}, { $id: "ModelMetricAverage" });
export type ModelMetricAverage = Static<typeof ModelMetricAverage>;

export const ModelMetricSummary = Type.Object({
  provider: Type.String(),
  since: Type.Number(),
  requests: Type.Number(),
  last: Type.Optional(ModelMetric),
  average: ModelMetricAverage,
  p50: ModelMetricAverage,
  p95: ModelMetricAverage,
  /** Recent samples, oldest first, for the dialog's trend. */
  samples: Type.Array(ModelMetric),
}, { $id: "ModelMetricSummary" });
export type ModelMetricSummary = Static<typeof ModelMetricSummary>;

export const ModelMetricSession = Type.Object({ metric: Type.Optional(ModelMetric) }, { $id: "ModelMetricSession" });
export type ModelMetricSession = Static<typeof ModelMetricSession>;

export const ModelMetricError = Type.Object({ error: Type.String() }, { $id: "ModelMetricError" });
export type ModelMetricError = Static<typeof ModelMetricError>;

export const routeSchemas = [
  { method: "GET", path: "/__hui/model-metrics/providers/:provider", response: ModelMetricSummary },
  { method: "GET", path: "/__hui/model-metrics/sessions/:session", response: ModelMetricSession },
];
