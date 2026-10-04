/**
 * HUI's system prompt for Durable conversations, built by PI's own section
 * builder from PI's resource loader: SYSTEM.md / HUI's default preamble,
 * APPEND_SYSTEM, AGENTS.md context files, skills and the working directory,
 * plus HUI's presentation and active-tool sections. The loader runs with no
 * extensions; only HUI-owned tools exist in Durable conversations.
 */
import { DefaultResourceLoader, SettingsManager, type Skill } from "@earendil-works/pi-coding-agent";
import { defineExtension, section, type PromptInput } from "@earendil-works/pi-durable";
import type { Settings } from "../../src/lib/settings.ts";
import { enabledBundledSkillPaths, isBundledSkillPreference } from "../bundled-skills.ts";
import { HUI_DEFAULT_PROMPT } from "./hui-prompt.ts";
import { HUI_PRESENTATION_PROMPT } from "./hui-presentation.ts";
import { huiToolDefinitions } from "./hui-tools.ts";

export type PromptSettings = Pick<Settings, "disabledSkills" | "browser">;

type SectionInput = {
  customPrompt?: string;
  selectedTools: string[];
  toolSnippets: Record<string, string>;
  toolGuidelines: Record<string, string[]>;
  appendSystemPrompt?: string;
  sections: Record<string, string>;
  cwd: string;
  contextFiles: Array<{ path: string; content: string }>;
  skills: Skill[];
};
type Contribution = { readonly snippet: string; readonly guidelines: readonly string[] };

const internal = async <T>(path: string): Promise<T> =>
  await import(new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent")).href) as T;
const { buildSystemPromptSections } = await internal<{ buildSystemPromptSections(input: SectionInput): Record<string, string> }>("./core/system-prompt.js");
const PI_TOOL_CONTRIBUTIONS: Record<string, Contribution> = {
  read: (await internal<{ readToolSystemPromptContribution: Contribution }>("./core/tools/read.js")).readToolSystemPromptContribution,
  bash: (await internal<{ bashToolSystemPromptContribution: Contribution }>("./core/tools/bash.js")).bashToolSystemPromptContribution,
  edit: (await internal<{ editToolSystemPromptContribution: Contribution }>("./core/tools/edit.js")).editToolSystemPromptContribution,
  write: (await internal<{ writeToolSystemPromptContribution: Contribution }>("./core/tools/write.js")).writeToolSystemPromptContribution,
};
const HUI_TOOL_CONTRIBUTIONS: Record<string, Contribution> = Object.fromEntries(huiToolDefinitions().map((tool) => [
  tool.name, { snippet: tool.promptSnippet ?? "", guidelines: tool.promptGuidelines ?? [] },
]));

/** PI's section order, then HUI's; the builder tags every section but the preamble. */
const SECTION_KEYS = [
  "preamble", "tools", "rules", "docs", "addendum", "project_context", "skills", "cwd",
  "hui_presentation", "hui_tools", "hui_tool_guidelines",
] as const;

/** Same text as the PI worker's `huiPromptExtension`. */
export function huiToolSections(selectedTools: readonly string[], contributions: Record<string, Contribution>): Record<string, string> {
  const activeTools = selectedTools.map((name) => {
    const snippet = contributions[name]?.snippet;
    return `- ${name}${snippet ? `: ${snippet}` : ""}`;
  }).join("\n");
  const guidelines = [...new Set(selectedTools.flatMap((name) => contributions[name]?.guidelines ?? []))]
    .map((line) => `- ${line}`).join("\n");
  return {
    hui_presentation: HUI_PRESENTATION_PROMPT,
    hui_tools: activeTools
      ? `Active callable tools for this turn (PI provides their full schemas separately):\n${activeTools}`
      : "No callable tools are active for this turn.",
    ...(guidelines ? { hui_tool_guidelines: guidelines } : {}),
  };
}

export class DurablePrompt {
  readonly #agentDir: string;
  readonly #readSettings: () => Promise<PromptSettings>;
  /** Context files and skills load once per directory, like a PI session. */
  #loaders = new Map<string, Promise<DefaultResourceLoader>>();
  #built = new WeakMap<PromptInput, Promise<Record<string, string>>>();
  readonly extension;

  constructor(agentDir: string, readSettings: () => Promise<PromptSettings>) {
    this.#agentDir = agentDir;
    this.#readSettings = readSettings;
    this.extension = defineExtension({
      name: "hui-prompt",
      sections: SECTION_KEYS.map((key) => section(key, async (input) => (await this.#build(input))[key], { tag: false })),
    });
  }

  /** PI resources for one working directory, honoring HUI's skill controls. */
  loader(cwd: string): Promise<DefaultResourceLoader> {
    let loading = this.#loaders.get(cwd);
    if (!loading) {
      loading = this.#load(cwd);
      loading.catch(() => this.#loaders.delete(cwd));
      this.#loaders.set(cwd, loading);
    }
    return loading;
  }

  async #load(cwd: string): Promise<DefaultResourceLoader> {
    const disabled = (await this.#readSettings()).disabledSkills;
    // Bundled opt-out controls only the fallback; other skills are filtered by path.
    const disabledPaths = new Set(disabled.filter((entry) => !isBundledSkillPreference(entry)).map((entry) => entry.path));
    const loader = new DefaultResourceLoader({
      cwd, agentDir: this.#agentDir,
      settingsManager: SettingsManager.create(cwd, this.#agentDir),
      additionalSkillPaths: enabledBundledSkillPaths(disabled),
      noExtensions: true, noThemes: true,
      systemPromptOverride: (base) => base ?? HUI_DEFAULT_PROMPT,
      skillsOverride: (base) => ({ ...base, skills: base.skills.filter((skill) => !disabledPaths.has(skill.filePath)) }),
    });
    await loader.reload();
    return loader;
  }

  /** Re-read context files, skills and prompt templates for later requests. */
  reload(cwd?: string): void {
    if (cwd) this.#loaders.delete(cwd);
    else this.#loaders.clear();
  }

  #build(input: PromptInput): Promise<Record<string, string>> {
    let built = this.#built.get(input);
    if (!built) {
      built = this.#sections(input);
      this.#built.set(input, built);
    }
    return built;
  }

  /** The prompt a request with these tools would carry, for inspection. */
  async render(cwd: string, selectedTools: readonly string[]): Promise<string> {
    const sections = await this.#sectionsFor(cwd, [...selectedTools]);
    return SECTION_KEYS.flatMap((key) => sections[key] ? [sections[key]] : []).join("\n\n");
  }

  #sections(input: PromptInput): Promise<Record<string, string>> {
    return this.#sectionsFor(input.env?.cwd ?? input.agent.cwd ?? this.#agentDir, input.agent.tools.map((tool) => tool.name));
  }

  async #sectionsFor(cwd: string, selectedTools: string[]): Promise<Record<string, string>> {
    const loader = await this.loader(cwd);
    const contributions = { ...PI_TOOL_CONTRIBUTIONS, ...HUI_TOOL_CONTRIBUTIONS };
    const toolSnippets: Record<string, string> = {};
    const toolGuidelines: Record<string, string[]> = {};
    for (const name of selectedTools) {
      const contribution = contributions[name];
      if (!contribution) continue;
      if (contribution.snippet) toolSnippets[name] = contribution.snippet;
      toolGuidelines[name] = [...contribution.guidelines];
    }
    const custom = loader.getSystemPrompt();
    const append = loader.getAppendSystemPrompt().join("\n\n");
    return buildSystemPromptSections({
      ...(custom ? { customPrompt: custom } : {}),
      selectedTools, toolSnippets, toolGuidelines,
      ...(append ? { appendSystemPrompt: append } : {}),
      sections: huiToolSections(selectedTools, contributions),
      cwd,
      contextFiles: loader.getAgentsFiles().agentsFiles,
      skills: loader.getSkills().skills,
    });
  }
}
