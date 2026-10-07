/**
 * The declarative response formats HUI's chat renders — diagrams, charts, math, callouts and link embeds — and
 * the prompt section that tells the model about them. The renderers themselves live in the browser.
 */
export interface HuiPresentationCapability {
  id: "alerts" | "math" | "mermaid" | "slack-link" | "vega-lite" | "x-post";
  guidance: string;
}

/** Compact, stable renderer catalog injected into every HUI-backed PI turn.
 * These are declarative output forms, not tools, so they stay separate from
 * PI's selected-tool schemas and snippets. */
export const HUI_PRESENTATION_CAPABILITIES: readonly HuiPresentationCapability[] = [
  {
    id: "mermaid",
    guidance: "Use a fenced `mermaid` block when a flowchart, sequence, state, class, entity relationship, timeline, mindmap, or similar diagram materially clarifies the answer.",
  },
  {
    id: "vega-lite",
    guidance: "Use a fenced `chart` block containing one Vega-Lite JSON specification for quantitative data. Put data in `data.values`; external `url` and `href` fields are rejected. Prefer `width: \"container\"` and a concise title.",
  },
  {
    id: "math",
    guidance: "Use `$...$` for inline math and `$$...$$` on delimiter-only lines for display math. HUI renders both with KaTeX; ordinary currency without a closing delimiter stays text.",
  },
  {
    id: "alerts",
    guidance: "Use GitHub-style blockquote callouts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, or `CAUTION`) only when the distinction helps the user scan the answer.",
  },
  {
    id: "x-post",
    guidance: "An isolated bare HTTPS `x.com/.../status/...` or `twitter.com/.../status/...` URL becomes a consent-gated post embed. Labeled and inline links remain ordinary links.",
  },
  {
    id: "slack-link",
    guidance: "An isolated bare HTTPS Slack message or channel permalink becomes a static link card. HUI does not authenticate to Slack or reveal private content; do not claim that displaying the card means you read the conversation.",
  },
] as const;

export const HUI_PRESENTATION_PROMPT = [
  "HUI can render the following declarative response formats:",
  ...HUI_PRESENTATION_CAPABILITIES.map(({ id, guidance }) => `- ${id}: ${guidance}`),
  "- Raw HTML, arbitrary SVG and iframes in Markdown are escaped. When the show_widget tool is active, it is the way to show interactive HTML or SVG. Do not claim unsupported markup will render.",
].join("\n");
