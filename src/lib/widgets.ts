/**
 * Host side of the inline widgets shown by `show_widget`: what a call renders, the theme tokens passed into
 * the sandbox, validation of messages coming back from it, and the limits on size and links. The widget
 * code itself runs only inside the sandboxed frame.
 */
import {
  isCompleteHtmlDocument,
  WIDGET_CODE_MAX_BYTES,
  WIDGET_MAX_HEIGHT,
  WIDGET_MIN_HEIGHT,
  WIDGET_SANDBOX_METHOD_PREFIX,
  WIDGET_THEME_TOKENS,
  WIDGET_TITLE_MAX_LENGTH,
  WIDGET_TOKENS,
  widgetTokenValue,
  type WidgetTheme,
} from "../../shared/widgets.ts";

type ToolCall = { name: string; args?: unknown; details?: unknown; output?: string; status?: "running" | "succeeded" | "failed" };

/** What the chat shows for one `show_widget` call. The code is the call's own
 * argument, rendered only once the gateway accepted it (`details.widget`). */
export type WidgetView =
  | { state: "pending"; title: string }
  | { state: "ready"; title: string; code: string }
  | { state: "failed"; title: string; error: string }
  | { state: "unavailable"; title: string };

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const encoder = new TextEncoder();

function widgetTitle(call: ToolCall): string {
  for (const value of [objectValue(objectValue(call.details)?.["widget"])?.["title"], objectValue(call.args)?.["title"]]) {
    if (typeof value === "string" && value.trim()) return [...value.trim()].slice(0, WIDGET_TITLE_MAX_LENGTH).join("");
  }
  return "Widget";
}

export function widgetView(call: ToolCall): WidgetView | undefined {
  if (call.name !== "show_widget") return undefined;
  const title = widgetTitle(call);
  const status = call.status ?? "running";
  if (status === "running") return { state: "pending", title };
  if (status === "failed") return { state: "failed", title, error: call.output?.trim() || "The widget was rejected." };
  const code = objectValue(call.args)?.["widget_code"];
  const accepted = objectValue(objectValue(call.details)?.["widget"]);
  if (!accepted || typeof code !== "string" || !code.trim() || encoder.encode(code).byteLength > WIDGET_CODE_MAX_BYTES || isCompleteHtmlDocument(code)) {
    return { state: "unavailable", title };
  }
  return { state: "ready", title, code };
}

/** HUI's current theme as widget tokens, read from the document root. */
export function currentWidgetTheme(root: HTMLElement = document.documentElement): WidgetTheme {
  const style = getComputedStyle(root);
  const tokens: WidgetTheme["tokens"] = {};
  for (const token of WIDGET_TOKENS) {
    const value = widgetTokenValue(style.getPropertyValue(WIDGET_THEME_TOKENS[token]));
    if (value) tokens[token] = value;
  }
  return { mode: root.dataset["themeMode"] === "light" ? "light" : "dark", tokens };
}

/** MCP Apps' `ui/notifications/host-context-changed` with HUI's tokens. */
export function widgetHostContext(theme: WidgetTheme, displayMode: "inline" | "fullscreen") {
  return {
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: {
      theme: theme.mode,
      displayMode,
      styles: { variables: Object.fromEntries(Object.entries(theme.tokens).map(([token, value]) => [`--${token}`, value])) },
    },
  } as const;
}

export type WidgetError = { message: string; source?: string; line?: number; column?: number };

export type WidgetFrameMessage =
  | { kind: "proxy-ready" }
  | { kind: "loaded"; renderId: string }
  | { kind: "navigated"; renderId: string }
  | { kind: "size"; height: number }
  | ({ kind: "error" } & WidgetError)
  | { kind: "open-link"; id?: string | number; url: string }
  | { kind: "display-mode"; id?: string | number; mode: "inline" | "fullscreen" };

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value < 10_000_000 ? value : undefined;

/** Validates one message from a widget's sandbox page. Anything else is ignored. */
export function parseWidgetFrameMessage(data: unknown): WidgetFrameMessage | undefined {
  const message = objectValue(data);
  if (!message || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") return undefined;
  const params = objectValue(message["params"]) ?? {};
  const rawId = message["id"];
  const id = (typeof rawId === "string" && rawId.length <= 100) || (typeof rawId === "number" && Number.isFinite(rawId)) ? { id: rawId } : {};
  const renderId = typeof params["renderId"] === "string" ? params["renderId"] : undefined;
  switch (message["method"]) {
    case `${WIDGET_SANDBOX_METHOD_PREFIX}proxy-ready`:
      return { kind: "proxy-ready" };
    case `${WIDGET_SANDBOX_METHOD_PREFIX}resource-loaded`:
      return renderId ? { kind: "loaded", renderId } : undefined;
    case `${WIDGET_SANDBOX_METHOD_PREFIX}resource-navigated`:
      return renderId ? { kind: "navigated", renderId } : undefined;
    case "ui/notifications/size-changed": {
      const height = params["height"];
      return typeof height === "number" && Number.isFinite(height) && height > 0 ? { kind: "size", height } : undefined;
    }
    case "notifications/message": {
      const detail = objectValue(params["data"]) ?? {};
      const text = typeof detail["message"] === "string" ? detail["message"].replace(/\s+/gu, " ").trim().slice(0, 500) : "";
      if (params["level"] !== "error" || !text) return undefined;
      const source = typeof detail["source"] === "string" && detail["source"] ? detail["source"].slice(0, 200) : undefined;
      const line = positiveInteger(detail["line"]);
      const column = positiveInteger(detail["column"]);
      return { kind: "error", message: text, ...(source ? { source } : {}), ...(line ? { line } : {}), ...(column ? { column } : {}) };
    }
    case "ui/open-link":
      return typeof params["url"] === "string" ? { kind: "open-link", ...id, url: params["url"] } : undefined;
    case "ui/request-display-mode":
      return params["mode"] === "inline" || params["mode"] === "fullscreen" ? { kind: "display-mode", ...id, mode: params["mode"] } : undefined;
    default:
      return undefined;
  }
}

export const clampWidgetHeight = (height: number): number =>
  Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, Math.ceil(height)));

/** An http(s) URL, without credentials, that a widget may ask to open in a new tab. */
export function openableWidgetUrl(raw: string): string | undefined {
  if (raw.length > 2_048) return undefined;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A notice line. Inline-script lines count from the agent's own fragment,
 * which starts on `fragmentLine` of the composed document. */
export function widgetErrorText(error: WidgetError, fragmentLine: number): string {
  const inline = error.source === "widget";
  const line = error.line === undefined ? undefined : inline ? error.line - fragmentLine + 1 : error.line;
  const place = [
    ...(error.source && !inline ? [error.source] : []),
    ...(line !== undefined && line > 0 ? [`line ${line}`] : []),
    ...(line !== undefined && line > 0 && error.column ? [`column ${error.column}`] : []),
  ];
  return place.length ? `${error.message} (${place.join(", ")})` : error.message;
}
