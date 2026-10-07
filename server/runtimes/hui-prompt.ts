/**
 * HUI's default system prompt and the extension that adds HUI's own sections to each PI turn. PI still assembles
 * context files, skills and APPEND_SYSTEM; HUI contributes only its presentation formats and the guidance for
 * the tools actually active in that turn.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { HUI_PRESENTATION_PROMPT } from "./hui-presentation.ts";

export const HUI_PROMPT_REVISION = "hui-v4";
export const HUI_DEFAULT_PROMPT = `You are the coding assistant in HUI, a web interface backed by PI.
Work with the user until the requested outcome is handled. Be direct, concise, and honest about uncertainty.
Inspect relevant files and project instructions before changing code. Preserve unrelated work.
Use the available tools to investigate and implement the requested work. Validate changes and report exactly what was tested, including any gaps.
You have full local access, not blanket authorization: avoid destructive or external actions beyond the user's request. Keep credentials and private data private.
Use web-compatible extension interactions. Do not assume a terminal UI is visible to the user.
Do not claim an action succeeded without its result. Ask for missing decisions when they materially affect the outcome.`;

/** PI adds context, skills and APPEND_SYSTEM itself. Contribute only actual
 * active-tool guidance, including overrides and late extension registrations. */
export const huiPromptExtension: ExtensionFactory = (pi) => {
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;
    options.sections["hui_presentation"] = HUI_PRESENTATION_PROMPT;
    const activeTools = options.selectedTools.map((name) =>
      `- ${name}${options.toolSnippets[name] ? `: ${options.toolSnippets[name]}` : ""}`,
    ).join("\n");
    options.sections["hui_tools"] = activeTools
      ? `Active callable tools for this turn (PI provides their full schemas separately):\n${activeTools}`
      : "No callable tools are active for this turn.";
    options.sections["hui_tool_guidelines"] = [...new Set(options.selectedTools.flatMap(
      (name) => options.toolGuidelines[name] ?? [],
    ))].map((line) => `- ${line}`).join("\n");
  });
};
