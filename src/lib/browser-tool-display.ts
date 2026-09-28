/** Display-only summary of a `browser` tool call for its transcript row, such
 * as "open example.com/docs" or "act click e4". Never interprets page data. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  try {
    const url = new URL(text);
    const shown = url.protocol === "http:" || url.protocol === "https:"
      ? `${url.host}${url.pathname === "/" ? "" : url.pathname}`
      : url.href;
    return shown.length > 80 ? `${shown.slice(0, 79)}…` : shown;
  } catch {
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  }
}

export function browserToolSummary(args: unknown): string {
  if (!isRecord(args) || typeof args["action"] !== "string") return "";
  const action = args["action"];
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  switch (action) {
    case "open":
    case "navigate":
      return [action, shortUrl(args["url"])].filter(Boolean).join(" ");
    case "act": {
      const kind = text(args["kind"]) || "act";
      const detail = kind === "press" ? text(args["key"]) : kind === "wait" ? shortUrl(args["url"]) || text(args["text"]).slice(0, 40) : "";
      return ["act", kind, text(args["ref"]), detail].filter(Boolean).join(" ");
    }
    case "focus":
    case "close":
      return [action, text(args["tabId"])].filter(Boolean).join(" ");
    case "resize":
      return typeof args["width"] === "number" && typeof args["height"] === "number" ? `resize ${args["width"]}×${args["height"]}` : "resize";
    default:
      return action;
  }
}
