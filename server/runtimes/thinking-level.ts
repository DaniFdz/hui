/**
 * The cheapest reasoning level a model will actually be sent. Utility calls
 * (titles, Jira drafts, side questions) want no reasoning, but "off" is not
 * always delivered: PI omits the effort field entirely for OpenAI-compatible
 * chat completions when the model's thinkingLevelMap has no string for "off",
 * and many such models (DeepSeek, Qwen behind gateways) then reason at their
 * provider default. Choosing from the model's own map keeps this working when
 * the configured utility model changes.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ThinkingModel = {
  api: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  /** Provider compat flags; only `thinkingFormat` is read. */
  compat?: object;
};

const ABOVE_OFF: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
/** Effort names every OpenAI-compatible reasoning endpoint accepts as-is. */
const STANDARD: ReadonlySet<ThinkingLevel> = new Set(["low", "medium", "high"]);

/** Whether PI sends an explicit "no reasoning" value for this model. Only the
 * default OpenAI thinking format on chat completions omits it when unmapped;
 * the other APIs and formats send their own disabled value. */
export function offIsSent(model: ThinkingModel): boolean {
  if (model.thinkingLevelMap?.off === null) return false;
  if (model.api !== "openai-completions") return true;
  const format = (model.compat as { thinkingFormat?: unknown } | undefined)?.thinkingFormat;
  if ((format ?? "openai") !== "openai") return true;
  return typeof model.thinkingLevelMap?.off === "string";
}

export function lowestThinkingLevel(model: ThinkingModel): ThinkingLevel {
  if (!model.reasoning || offIsSent(model)) return "off";
  const map = model.thinkingLevelMap ?? {};
  for (const level of ABOVE_OFF) {
    const value = map[level];
    if (value === null) continue;
    // A mapped string is known to be accepted; an unmapped level is sent by
    // name, which only the standard efforts are safe to assume.
    if (typeof value === "string" || STANDARD.has(level)) return level;
  }
  return "off";
}

/**
 * A custom gateway entry often names an upstream catalog model as
 * "<provider>/<model id>" without copying its reasoning metadata. When the
 * entry declares no thinkingLevelMap, borrow the upstream model's map so "off"
 * can be sent as that provider's explicit value (for example "none").
 */
export function withUpstreamThinkingMap<T extends ThinkingModel & { id: string }>(
  model: T,
  lookup: (provider: string, id: string) => ThinkingModel | undefined,
): T {
  if (model.thinkingLevelMap || !model.reasoning) return model;
  const separator = model.id.indexOf("/");
  if (separator <= 0) return model;
  const upstream = lookup(model.id.slice(0, separator), model.id.slice(separator + 1));
  if (!upstream?.thinkingLevelMap || upstream.api !== model.api) return model;
  return { ...model, thinkingLevelMap: upstream.thinkingLevelMap };
}
