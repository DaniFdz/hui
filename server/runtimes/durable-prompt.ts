/**
 * HUI's system prompt for Durable conversations, built by PI's own section
 * builder from PI's resource loader: SYSTEM.md / HUI's default preamble,
 * APPEND_SYSTEM, AGENTS.md context files, skills and the working directory,
 * plus HUI's presentation and active-tool sections. This loader runs with no
 * extensions; a session's PI extensions (`durable-extensions.ts`) add their
 * tools' snippets and may change the prompt of a run, as in PI. Skills load per
 * directory, and a bot's chat adds its own (`skills/` in its home folder,
 * `bots/skills.ts`); it lists only the ones the operator left on
 * (`bots/durable-access.ts`), so two chats in one directory can differ. A
 * session on Ultra adds OpenClaw's plan, delegate and verify section, and one in
 * Autonomous mode the section that makes it the lead of its own task.
 */
import { DefaultResourceLoader, type BuildSystemPromptOptions, type Skill } from "@earendil-works/pi-coding-agent";
import { defineExtension, section, type ConversationId, type PromptInput } from "@earendil-works/pi-durable";
import type { Settings } from "../hui-settings.ts";
import { enabledBundledSkillPaths, isBundledSkillPreference } from "../pi/bundled-skills.ts";
import { createPolicySettingsManager } from "./resource-policy.ts";
import { HUI_DEFAULT_PROMPT, routeGuidelines, type RouteLine } from "./hui-prompt.ts";
import { HUI_PRESENTATION_PROMPT } from "./hui-presentation.ts";
import { huiToolDefinitions } from "./hui-tools.ts";
import type { Contribution, RunPrompt } from "./durable-extensions.ts";

export type PromptSettings = Pick<Settings, "disabledSkills" | "browser" | "codemode" | "disabledPlugins" | "notifications" | "models">;

/** The skills of a bot's chat: the ones it has of a directory's, and its own `skills` section when it loads them with
 * `load_skill`. */
export type BotSkills = {
  skills(skills: readonly Skill[]): Skill[];
  section(skills: readonly Skill[], selectedTools: readonly string[]): string | undefined;
};

/** What a conversation's PI extensions add: their tools' snippets, and the prompt `before_agent_start` gave the run. */
export type PromptExtras = { readonly contributions: Record<string, Contribution>; readonly run?: RunPrompt };

const internal = async <T>(path: string): Promise<T> =>
  await import(new URL(path, import.meta.resolve("@earendil-works/pi-coding-agent")).href) as T;
const { buildSystemPromptSections } = await internal<{ buildSystemPromptSections(input: BuildSystemPromptOptions): Record<string, string> }>("./core/system-prompt.js");
const PI_TOOL_CONTRIBUTIONS: Record<string, Contribution> = {
  read: (await internal<{ readToolSystemPromptContribution: Contribution }>("./core/tools/read.js")).readToolSystemPromptContribution,
  bash: (await internal<{ bashToolSystemPromptContribution: Contribution }>("./core/tools/bash.js")).bashToolSystemPromptContribution,
  edit: (await internal<{ editToolSystemPromptContribution: Contribution }>("./core/tools/edit.js")).editToolSystemPromptContribution,
  write: (await internal<{ writeToolSystemPromptContribution: Contribution }>("./core/tools/write.js")).writeToolSystemPromptContribution,
};
const HUI_TOOL_CONTRIBUTIONS: Record<string, Contribution> = {
  ...Object.fromEntries(huiToolDefinitions().map((tool) => [
    tool.name, { snippet: tool.promptSnippet ?? "", guidelines: tool.promptGuidelines ?? [] },
  ])),
};

/** PI's section order, then HUI's; the builder tags every section but the preamble. Sections an extension adds in
 * `before_agent_start` follow PI's, already tagged, in `extension_sections`. */
const SECTION_KEYS = [
  "preamble", "tools", "rules", "docs", "addendum", "project_context", "skills", "cwd", "extension_sections",
  "hui_presentation", "hui_tools", "hui_tool_guidelines", "hui_goal", "hui_extensions", "hui_ultra", "hui_autonomous",
] as const;
const KNOWN_SECTIONS = new Set<string>(SECTION_KEYS);

/** Same text as the PI worker's `huiPromptExtension`. */
export function huiToolSections(
  selectedTools: readonly string[],
  contributions: Record<string, Contribution>,
  routes: readonly RouteLine[] = [],
): Record<string, string> {
  const activeTools = selectedTools.map((name) => {
    const snippet = contributions[name]?.snippet;
    return `- ${name}${snippet ? `: ${snippet}` : ""}`;
  }).join("\n");
  const guidelines = [...new Set(selectedTools.flatMap((name) => contributions[name]?.guidelines ?? []))]
    .map((line) => `- ${line}`).join("\n");
  const guidance = [guidelines, routeGuidelines(selectedTools.includes("sessions_spawn") ? routes : [])].filter(Boolean).join("\n\n");
  return {
    hui_presentation: HUI_PRESENTATION_PROMPT,
    hui_tools: activeTools
      ? `Active callable tools for this turn (PI provides their full schemas separately):\n${activeTools}`
      : "No callable tools are active for this turn.",
    ...(guidance ? { hui_tool_guidelines: guidance } : {}),
  };
}

/** OpenClaw's Ultra guidance (`ultra-orchestration.ts`): delegation only where the request offers `sessions_spawn`. */
export function ultraSection(delegates: boolean): string {
  return [
    delegates ? "## Proactive Sub-Agent Orchestration" : "## Ultra Execution",
    "Ultra active for this session. Plan the work, carry it through, and verify the result before replying.",
    "Decide what you can: make easy or reversible choices yourself and list them in your reply. When a choice needs facts, find them instead of asking. Ask only before actions that are hard to undo or reach other people, or when the operator's instructions say to ask.",
    ...delegates ? [
      "Use `sessions_spawn` when independent work improves speed or quality.",
      "- Parallelize independent investigation, implementation and verification.",
      "- Keep simple or tightly coupled work local.",
      "- Give each subagent a bounded objective; synthesize the results before replying.",
    ] : [],
  ].join("\n");
}

/** Autonomous mode: the session plans, stops for its supervisor's approval, then drives the task to a draft pull request
 * and stops again only on a blocker or on its report. Its supervisor is the Chief of Staff that started it
 * (`server/heartbeat.ts`), or the operator otherwise. */
export function autonomousSection(delegates: boolean): string {
  const report = "your last reply is your report: the goal and whether it was met, the pull request and its head commit, each check with its result, what remains and the proof gaps";
  return [
    "## Autonomous mode",
    "Autonomous mode is on for this session. You drive one task to a draft pull request that is ready for review. Decide every technical matter yourself: scope, design, tests, retries, model routes and review findings.",
    "You report to whoever supervises you: the Chief of Staff that started this session, or otherwise the operator. A message from the operator always comes first. Where another part of this prompt says otherwise (Ultra, a pull request lead's phases, an active goal), these steps win.",
    "1. Plan, then stop for approval. Investigate enough to plan, then end your turn with the plan and nothing else implemented. Write it for the person who supervises you, following the `technical-writing` skill: short declarative sentences, one thought per sentence, no filler, no formatting tells, no wall of text. Give the goal, what changes, what stays, the evidence that will prove it, the risks, and where you will stop. End with one question that asks for approval or a change. Change nothing before the answer: a subagent's result or the passing of time is not approval.",
    ...delegates ? [
      "2. Delegate every step to a subagent, one task each, and do not do their work yourself: an `explorer` or `planner` for the investigation, one `worker` per change, a fresh `verifier` for the deciding checks, a `reviewer` for the diff, and a fresh worker for each fix round. While subagents work, end your turn: their results wake you.",
      "3. One checkout, one branch. Every subagent works in this session's own checkout, so spawn them without `worktree: true`: the branch, the worktree and the pull request are the session's, and a fix round sees what the change before it did. If this session works directly in the operator's checkout, say so before committing to its branch.",
    ] : [
      "2. Implement the approved plan, then run the repository's own checks.",
      "3. Read the whole diff against the plan: the intent, the logic and the failure paths. Fix what you find and check again.",
    ],
    "4. Verify before you call it done: the repository's checks have run, you have read the whole diff and compared it with what was approved.",
    "5. Ship a draft. Open the pull request as a draft and update it as you go, until its checks pass and no review comment is open. Never mark it ready for review, never merge it, never deploy: the operator does both, and the operator decides when it leaves draft.",
    `6. Stop three times, and only three. The plan, for approval. A blocker only your supervisor can clear, as one question at the end of your reply, never a question card and never the operator directly when a Chief of Staff started this session. And the report, when the draft pull request is tested, verified and ready for review: then ${report}.`,
  ].join("\n");
}

export class DurablePrompt {
  readonly #agentDir: string;
  readonly #readSettings: () => Promise<PromptSettings>;
  /** Context files and skills load once per directory (and a bot's own skill folders), like a PI session. */
  #loaders = new Map<string, Promise<DefaultResourceLoader>>();
  #built = new WeakMap<PromptInput, Promise<Record<string, string>>>();
  /** The prompt of each conversation's latest request, as PI's `ctx.getSystemPrompt()` reports it. */
  #last = new Map<ConversationId, string>();
  /** A conversation's extension additions; the Durable host answers for live sessions. */
  extras: (conversationId: ConversationId) => PromptExtras | undefined = () => undefined;
  /** The skills of a bot's chat; undefined for every other conversation, which lists every skill of its directory. The
   * Durable host answers. */
  botSkillsFor: (conversationId: ConversationId) => Promise<BotSkills | undefined> = async () => undefined;
  /** What the bots' tools add to HUI's active-tool section; the Durable host sets it with its bots. */
  botContributions: Readonly<Record<string, Contribution>> = {};
  /** A bot's own skill folders, which only its chat loads; none for every other conversation. The Durable host answers. */
  skillDirsFor: (conversationId: ConversationId) => Promise<readonly string[]> = async () => [];
  /** Whether the conversation's session is on Ultra. The Durable host answers. */
  ultraFor: (conversationId: ConversationId) => boolean = () => false;
  /** Whether the conversation's session is in Autonomous mode. The Durable host answers. */
  autonomousFor: (conversationId: ConversationId) => boolean = () => false;
  /** The active goal of the conversation's session, as its own prompt section. The Durable host answers. */
  goalFor: (conversationId: ConversationId) => Promise<string | undefined> = async () => undefined;
  /** The PR-lead section of a session a chief created, if it is one. The Durable host answers. */
  leadFor: (conversationId: ConversationId) => Promise<string | undefined> = async () => undefined;
  /** Gateway extensions' static prompt text for every Durable conversation, capped when they load. */
  gatewayPrompt: () => Promise<string | undefined> = async () => undefined;
  readonly extension;

  constructor(agentDir: string, readSettings: () => Promise<PromptSettings>) {
    this.#agentDir = agentDir;
    this.#readSettings = readSettings;
    this.extension = defineExtension({
      name: "hui-prompt",
      sections: SECTION_KEYS.map((key) => section(key, async (input) => (await this.#build(input))[key], { tag: false })),
    });
  }

  /** PI resources for one working directory, honoring HUI's skill controls; `skillDirs` adds a bot's own skills, after
   * its directory's (a skill of the directory wins a shared name, as PI's own skills win over HUI's bundled ones). */
  loader(cwd: string, skillDirs: readonly string[] = []): Promise<DefaultResourceLoader> {
    const key = [cwd, ...skillDirs].join("\0");
    let loading = this.#loaders.get(key);
    if (!loading) {
      loading = this.#load(cwd, skillDirs);
      loading.catch(() => this.#loaders.delete(key));
      this.#loaders.set(key, loading);
    }
    return loading;
  }

  async #load(cwd: string, skillDirs: readonly string[]): Promise<DefaultResourceLoader> {
    const settings = await this.#readSettings();
    const disabled = settings.disabledSkills;
    // Bundled opt-out controls only the fallback; other skills are filtered by path.
    const disabledPaths = new Set(disabled.filter((entry) => !isBundledSkillPreference(entry)).map((entry) => entry.path));
    const loader = new DefaultResourceLoader({
      cwd, agentDir: this.#agentDir,
      // A disabled package contributes no skills or prompts either, as for the PI worker.
      settingsManager: createPolicySettingsManager({ cwd, agentDir: this.#agentDir, disabledIds: new Set(settings.disabledPlugins.map((plugin) => plugin.id)) }),
      additionalSkillPaths: [...skillDirs, ...enabledBundledSkillPaths(disabled)],
      noExtensions: true, noThemes: true,
      systemPromptOverride: (base) => base ?? HUI_DEFAULT_PROMPT,
      skillsOverride: (base) => ({ ...base, skills: base.skills.filter((skill) => !disabledPaths.has(skill.filePath)) }),
    });
    await loader.reload();
    return loader;
  }

  /** Re-read context files, skills and prompt templates for later requests. */
  reload(cwd?: string): void {
    if (!cwd) this.#loaders.clear();
    else for (const key of [...this.#loaders.keys()]) if (key === cwd || key.startsWith(`${cwd}\0`)) this.#loaders.delete(key);
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
  async render(cwd: string, selectedTools: readonly string[], conversationId?: ConversationId): Promise<string> {
    return joined(await this.#sectionsFor(cwd, [...selectedTools], conversationId));
  }

  /** The prompt the conversation's latest request carried; empty before its first. */
  lastPrompt(conversationId: ConversationId): string {
    return this.#last.get(conversationId) ?? "";
  }

  async #sections(input: PromptInput): Promise<Record<string, string>> {
    const sections = await this.#sectionsFor(input.env?.cwd ?? input.agent.cwd ?? this.#agentDir, input.agent.tools.map((tool) => tool.name), input.conversationId);
    this.#last.set(input.conversationId, joined(sections));
    return sections;
  }

  /** PI's builder input for a request offering these tools. A bot's chat (`bot` given) lists only the skills the operator
   * left on: in PI's own section while it has read or bash, otherwise in one of HUI's that loads them with `load_skill`,
   * which such a chat is offered. */
  async options(cwd: string, selectedTools: readonly string[], extra: Record<string, Contribution> = {}, bot?: BotSkills, skillDirs: readonly string[] = [], ultra = false, autonomous = false): Promise<BuildSystemPromptOptions> {
    const loader = await this.loader(cwd, skillDirs);
    const skills = bot ? bot.skills(loader.getSkills().skills) : loader.getSkills().skills;
    const own = bot?.section(skills, selectedTools);
    const contributions = { ...PI_TOOL_CONTRIBUTIONS, ...extra, ...this.botContributions, ...HUI_TOOL_CONTRIBUTIONS };
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
    return {
      ...(custom ? { customPrompt: custom } : {}),
      selectedTools: [...selectedTools], toolSnippets, toolGuidelines,
      ...(append ? { appendSystemPrompt: append } : {}),
      sections: {
        ...huiToolSections(selectedTools, contributions, (await this.#readSettings()).models.routes), ...(own ? { skills: own } : {}),
        ...(ultra ? { hui_ultra: ultraSection(selectedTools.includes("sessions_spawn")) } : {}),
        ...(autonomous ? { hui_autonomous: autonomousSection(selectedTools.includes("sessions_spawn")) } : {}),
      },
      cwd,
      contextFiles: loader.getAgentsFiles().agentsFiles,
      skills: own ? [] : skills,
    };
  }

  async #sectionsFor(cwd: string, selectedTools: string[], conversationId?: ConversationId): Promise<Record<string, string>> {
    const extras = conversationId === undefined ? undefined : this.extras(conversationId);
    const run = extras?.run;
    // A prompt an extension forced replaces the whole prompt for its run, as in PI.
    if (run?.forced !== undefined) return { preamble: run.forced };
    const bot = conversationId === undefined ? undefined : await this.botSkillsFor(conversationId);
    const skillDirs = conversationId === undefined ? [] : await this.skillDirsFor(conversationId);
    const ultra = conversationId !== undefined && this.ultraFor(conversationId);
    const autonomous = conversationId !== undefined && this.autonomousFor(conversationId);
    const base = await this.options(cwd, selectedTools, extras?.contributions, bot, skillDirs, ultra, autonomous);
    const goal = conversationId === undefined ? undefined : await this.goalFor(conversationId);
    if (goal) base.sections = { ...base.sections, hui_goal: goal };
    const lead = conversationId === undefined ? undefined : await this.leadFor(conversationId);
    if (lead) base.sections = { ...base.sections, hui_lead: lead };
    const gateway = await this.gatewayPrompt();
    if (gateway) base.sections = { ...base.sections, hui_extensions: gateway };
    const sections = buildSystemPromptSections(run?.options ? {
      ...run.options,
      // The run keeps the sections its extensions edited; the tool loadout stays the request's own, and so do a bot's
      // skills.
      selectedTools: base.selectedTools!,
      toolSnippets: { ...base.toolSnippets, ...run.options.toolSnippets },
      toolGuidelines: { ...base.toolGuidelines, ...run.options.toolGuidelines },
      sections: { ...run.options.sections, ...base.sections },
      ...(bot ? { skills: base.skills ?? [] } : {}),
    } : base);
    const added = Object.entries(sections).filter(([key]) => !KNOWN_SECTIONS.has(key)).map(([, text]) => text);
    return added.length ? { ...sections, extension_sections: added.join("\n\n") } : sections;
  }
}

const joined = (sections: Record<string, string>) => SECTION_KEYS.flatMap((key) => sections[key] ? [sections[key]] : []).join("\n\n");
