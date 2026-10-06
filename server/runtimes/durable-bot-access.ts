/**
 * What a bot's chat may use (HUI-18; SPEC decision of 2026-10-06): each bot
 * has a tool list and a skill list, kept in its conversation's `hui.bot`
 * document, and its chat gets only those, its own tools and OptChat's memory
 * tools. Everything here reads that document where the conversation runs, so a
 * worker host enforces the same lists as the gateway.
 *
 * - `DurableSession.applyTools` offers a bot's chat exactly its tools
 *   (`botToolSelection`), extension tools included, and the HUI tool bridge
 *   (`DurableHost`) refuses a bot's call to a HUI tool that is not on its list.
 * - The prompt lists only its skills (`botSkillsPrompt`), `/skill:` offers only
 *   them, and `load_skill` returns one of them, so a bot without the read tool
 *   still loads its skills.
 * - `request_access` asks the operator through HUI's question flow; Allow adds
 *   the items to the lists and to the run's tools, for its next request.
 *
 * Tools are the boundary, nothing more: a bot with bash or read reaches what
 * the user's account can. Isolation is a worker in a container.
 */
import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { defineTool, section, type ConversationId, type PromptSection, type ToolExecutionResult, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bundledSkills } from "../bundled-skills.ts";
import { BotDoc, conversationBotState, MESSAGE_BOT_TOOL, type BotAccess, type BotSkillRef } from "./durable-bots.ts";
import { huiToolDefinitions } from "./hui-tools.ts";
import type { QuestionDraft } from "./question-box.ts";
import type { RuntimeQuestionResponse } from "./types.ts";

export const REQUEST_ACCESS_TOOL = "request_access";
export const LOAD_SKILL_TOOL = "load_skill";
/** A bot's own tools: its chat keeps them whatever its list says. `load_skill` joins once it has a skill. */
export const BOT_OWN_TOOLS: readonly string[] = [REQUEST_ACCESS_TOOL, LOAD_SKILL_TOOL];

/**
 * Tools that reach past a bot's selection: they run commands (`bash`, `terminal`, `watcher`), change files other
 * programs load, such as PI extensions or shell startup files (`write`, `edit`), drive HUI's own page and `file://`
 * URLs (`browser`), or act through another session, which has every tool (`sessions_spawn`, `sessions_send`,
 * `subagents`). New bots start without them and the catalog labels them.
 */
export const POWERFUL_TOOLS: ReadonlySet<string> = new Set([
  "write", "edit", "bash", "terminal", "watcher", "browser", "sessions_spawn", "sessions_send", "subagents",
]);

/** What a bot's own tools add to HUI's active-tool section; the `bot_access` section explains the rest. */
export const BOT_ACCESS_CONTRIBUTIONS: Readonly<Record<string, { snippet: string; guidelines: readonly string[] }>> = {
  [REQUEST_ACCESS_TOOL]: { snippet: "Ask the operator for tools or skills you don't have yet", guidelines: [] },
  [LOAD_SKILL_TOOL]: { snippet: "Load one of your skills, or a file it refers to", guidelines: [] },
};

/** The largest file `load_skill` returns from a skill's directory. */
const MAX_SKILL_FILE_BYTES = 256 * 1024;
/** Longest skill description the access section repeats. */
const ACCESS_DESCRIPTION_CHARS = 100;
const ALLOW = "Allow";
const DENY = "Deny";

/* ── catalog ─────────────────────────────────────────────────────────── */

/** How the Tools tab groups a tool: files, shell, HUI's own, an extension's (by source), or bots'. */
export type BotToolGroup = "files" | "shell" | "hui" | "extension" | "bots";

/** One tool a bot's chat could be given, as the catalog and the access section describe it. */
export type OfferedTool = {
  name: string;
  label: string;
  /** One line. */
  description: string;
  group: BotToolGroup;
  /** Where it comes from: `Durable` (the coding tools), `HUI`, or an extension's source label. */
  source: string;
  powerful: boolean;
};

/** Where a tool in a chat's offer comes from. */
export type ToolOrigin =
  | { kind: "coding" | "hui" | "bot" }
  | { kind: "extension"; source: string; label?: string; snippet?: string };

const CODING_TOOLS: Readonly<Record<string, { group: BotToolGroup; label: string; description: string }>> = {
  read: { group: "files", label: "Read files", description: "Read files and images" },
  write: { group: "files", label: "Write files", description: "Create or replace files" },
  edit: { group: "files", label: "Edit files", description: "Apply exact text replacements to files" },
  bash: { group: "shell", label: "Shell", description: "Run shell commands" },
};
const BOT_TOOLS: Readonly<Record<string, { label: string; description: string }>> = {
  [MESSAGE_BOT_TOOL]: { label: "Message bots", description: "Message another bot of this HUI, which answers in its own chat" },
};

function firstSentence(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  const end = line.search(/[.!?](?:\s|$)/u);
  const sentence = end === -1 ? line : line.slice(0, end);
  return sentence.length <= 160 ? sentence : `${sentence.slice(0, 159).trimEnd()}…`;
}

let huiInfo: Map<string, { label: string; description: string }> | undefined;
function huiTool(name: string): { label: string; description: string } | undefined {
  huiInfo ??= new Map(huiToolDefinitions().map((tool) => [tool.name, {
    label: tool.label || tool.name, description: tool.promptSnippet || firstSentence(tool.description),
  }]));
  return huiInfo.get(name);
}

/** The catalog's entry for one tool of a chat's offer. */
export function describeTool(tool: { readonly name: string; readonly description?: string }, origin: ToolOrigin): OfferedTool {
  const powerful = POWERFUL_TOOLS.has(tool.name);
  const fallback = firstSentence(tool.description ?? "");
  switch (origin.kind) {
    case "coding": {
      const known = CODING_TOOLS[tool.name];
      return { name: tool.name, label: known?.label ?? tool.name, description: known?.description ?? fallback, group: known?.group ?? "files", source: "Durable", powerful };
    }
    case "hui": {
      const known = huiTool(tool.name);
      return { name: tool.name, label: known?.label ?? tool.name, description: known?.description ?? fallback, group: "hui", source: "HUI", powerful };
    }
    case "bot": {
      const known = BOT_TOOLS[tool.name];
      return { name: tool.name, label: known?.label ?? tool.name, description: known?.description ?? fallback, group: "bots", source: "HUI", powerful };
    }
    case "extension":
      return {
        name: tool.name, label: origin.label || tool.name, description: origin.snippet || fallback,
        group: "extension", source: origin.source, powerful,
      };
  }
}

/* ── tools ───────────────────────────────────────────────────────────── */

/** What a bot's chat keeps whatever its list says: OptChat's memory tools, `request_access`, and `load_skill` once it
 * has a skill. */
export function alwaysKept(access: BotAccess, memoryTools: readonly string[]): Set<string> {
  return new Set([...memoryTools, REQUEST_ACCESS_TOOL, ...(access.skills.length ? [LOAD_SKILL_TOOL] : [])]);
}

/** A bot's chat is offered, in offer order, the tools on its list and the ones it always keeps; nothing else, so a
 * tool installed later is never offered to it by itself. */
export function botToolSelection<T extends { readonly name: string }>(offer: readonly T[], access: BotAccess, always: ReadonlySet<string>): T[] {
  const listed = new Set(access.tools);
  return offer.filter((tool) => always.has(tool.name) || listed.has(tool.name));
}

/** Whether a bot's chat may call the HUI tool `name`: the bridge's own check, apart from what the chat is offered. A
 * chat whose lists are not recorded yet keeps every tool. */
export function botMayCall(access: BotAccess | null, name: string): boolean {
  return access === null || access.tools.includes(name) || BOT_OWN_TOOLS.includes(name);
}

/* ── skills ──────────────────────────────────────────────────────────── */

/** How a bot's list names a skill: its name and SKILL.md path, or a bundled skill's stable preference path, which
 * survives upgrades and checkout moves (as Settings' disabled skills do). */
export function skillRef(skill: { readonly name: string; readonly filePath: string }): BotSkillRef {
  const bundled = bundledSkills.find((each) => each.path === skill.filePath);
  return { name: skill.name, path: bundled?.preferencePath ?? skill.filePath };
}

export function hasSkill(refs: readonly BotSkillRef[], ref: BotSkillRef): boolean {
  return refs.some((each) => each.name === ref.name && each.path === ref.path);
}

/** The skills of `skills` a bot's list names. */
export function botSkills<T extends { readonly name: string; readonly filePath: string }>(skills: readonly T[], refs: readonly BotSkillRef[]): T[] {
  return skills.filter((skill) => hasSkill(refs, skillRef(skill)));
}

/** A skill's instructions as the model reads them, from `/skill:name` or `load_skill`: SKILL.md without its front
 * matter, with the directory its references are relative to. */
export function skillBlock(skill: Pick<Skill, "name" | "filePath" | "baseDir">): string {
  const body = readFileSync(skill.filePath, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "").trim();
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

const escapeXml = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");

/** A bot's `skills` prompt section: PI's own, told to load each skill with `load_skill`, which every bot with a skill
 * has; PI's names the read tool, which a bot may lack. Skills that disable model invocation stay out, as in PI. */
export function botSkillsPrompt(skills: readonly Pick<Skill, "name" | "description" | "disableModelInvocation">[]): string | undefined {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (!visible.length) return undefined;
  return [
    "The following skills provide specialized instructions for specific tasks.",
    "Use the load_skill tool to load a skill when the task matches its description. When a skill refers to a file by a relative path, load it with load_skill and that path.",
    "",
    "<available_skills>",
    ...visible.flatMap((skill) => ["  <skill>", `    <name>${escapeXml(skill.name)}</name>`, `    <description>${escapeXml(skill.description)}</description>`, "  </skill>"]),
    "</available_skills>",
  ].join("\n");
}

/** `read, write and bash`. */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

/**
 * The `bot_access` section of a bot's chat: what it has, how to ask for more, and what it can ask for. Byte-stable
 * while its lists, its offer and its directory's skills are unchanged.
 */
export function botAccessText(access: BotAccess, offered: readonly string[], offer: readonly OfferedTool[], skills: readonly Pick<Skill, "name" | "filePath" | "description">[]): string {
  const mine = botSkills(skills, access.skills).map((skill) => skill.name);
  const tools = offer.filter((tool) => !offered.includes(tool.name) && !access.tools.includes(tool.name));
  const askable = skills.filter((skill) => !hasSkill(access.skills, skillRef(skill)));
  return [
    `The operator chooses which tools and skills you have. Your tools: ${offered.length ? offered.join(", ") : "none"}. Your skills: ${mine.length ? mine.join(", ") : "none"}.`,
    "When a job needs a tool or skill you don't have, ask for it with request_access: name exactly what you need and say why. The operator answers Allow or Deny in this chat, and what they allow is yours from your next step. Ask only for what the job needs, one request at a time.",
    ...(tools.length ? ["Tools you can ask for:", ...tools.map((tool) => `- ${tool.name}: ${tool.description}${tool.powerful ? " (powerful: it reaches beyond your other tools)" : ""}`)] : []),
    ...(askable.length ? ["Skills you can ask for:", ...askable.map((skill) => `- ${skill.name}: ${oneLine(skill.description, ACCESS_DESCRIPTION_CHARS)}`)] : []),
    ...(!tools.length && !askable.length ? ["There is nothing more to ask for."] : []),
  ].join("\n");
}

/* ── the bot's own tools ─────────────────────────────────────────────── */

/** The live chat of a bot's conversation, which a tool asks through. */
export interface BotChat {
  /** The tools a session in this chat's directory gets now, before the bot's list, without the ones it always keeps. */
  botOffer(): readonly OfferedTool[];
  /** Skills a session in this chat's directory gets, Settings' choices applied. */
  availableSkills(): Promise<readonly Skill[]>;
  /** Asks the operator in this chat; undefined once dismissed, or when `signal` aborts first. */
  ask(question: QuestionDraft, signal?: AbortSignal): Promise<RuntimeQuestionResponse | undefined>;
}

export type BotAccessDeps = {
  /** The live session of a conversation; undefined while none has it open. */
  chat(conversationId: ConversationId): BotChat | undefined;
  /** Skills of a directory, for `load_skill` without a live session. */
  skills(cwd: string): Promise<readonly Skill[]>;
  /** Where a conversation without a directory runs. */
  agentDir: string;
  /** After a grant: the gateway mirrors the lists into its roster. Failures are reported, never the model's. */
  recorded?(botId: string, access: BotAccess): Promise<void>;
  report?(error: unknown): void;
};

type Result = ToolExecutionResult;
const text = (value: string, isError = false): Result => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
const unique = (values: readonly string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];

/** What the operator is asked: Allow or Deny, the items (powerful ones marked) and the bot's reason. */
export function accessQuestion(tools: readonly OfferedTool[], skills: readonly BotSkillRef[], reason: string): QuestionDraft {
  const items = [
    ...tools.map((tool) => (tool.powerful ? `${tool.name} (powerful)` : tool.name)),
    ...skills.map((skill) => `the ${skill.name} skill`),
  ];
  return { method: "select", title: `Allow access to ${listed(items)}?`, message: reason, options: [ALLOW, DENY] };
}

/** `request_access`, `load_skill` and the `bot_access` section. Allows one request per bot at a time. */
export function botAccessParts(deps: BotAccessDeps): { tools: ToolRegistration[]; sections: PromptSection[] } {
  const pending = new Set<string>();

  const requestAccess = defineTool({
    name: REQUEST_ACCESS_TOOL,
    description: "Ask the operator for tools or skills you don't have yet. They answer Allow or Deny in your chat; what they allow is yours from your next step. Name exactly what the current job needs and say why. Unknown names are refused with the ones you can ask for.",
    parameters: Type.Object({
      tools: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 20, description: "Tool names, as your bot_access section lists them." })),
      skills: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 20, description: "Skill names, as your bot_access section lists them." })),
      reason: Type.String({ minLength: 1, maxLength: 1_000, description: "Why the job needs them, in a sentence or two for the operator." }),
    }),
    // An answered request is never asked again after a restart: the model hears the call was interrupted.
    replay: "unsafe",
    execute: async (args, api, context) => {
      const state = await conversationBotState(api, api.conversationId, context);
      if (!state) return text("request_access is only available in a bot's chat.", true);
      if (!state.access) return text("You already have every tool and skill a session in your directory gets. There is nothing to ask for.");
      const chat = deps.chat(api.conversationId);
      if (!chat) return text("Your chat isn't open in HUI, so the operator can't be asked now. Try again in a later turn.", true);
      const wanted = { tools: unique(args.tools), skills: unique(args.skills) };
      if (!wanted.tools.length && !wanted.skills.length) return text("Name at least one tool or skill to ask for.", true);
      const access = state.access;
      const current = new Set((await api.agent(context)).tools.map((tool) => tool.name));
      const offer = new Map(chat.botOffer().map((tool) => [tool.name, tool]));
      const available = await chat.availableSkills();
      const unknownTools = wanted.tools.filter((name) => !offer.has(name) && !current.has(name));
      const unknownSkills = wanted.skills.filter((name) => !available.some((skill) => skill.name === name));
      if (unknownTools.length || unknownSkills.length) {
        const askableTools = [...offer.keys()].filter((name) => !current.has(name) && !access.tools.includes(name));
        const askableSkills = available.filter((skill) => !hasSkill(access.skills, skillRef(skill))).map((skill) => skill.name);
        return text([
          ...(unknownTools.length ? [`No tool named ${listed(unknownTools)}. You can ask for: ${askableTools.length ? askableTools.join(", ") : "no other tools"}.`] : []),
          ...(unknownSkills.length ? [`No skill named ${listed(unknownSkills)}. You can ask for: ${askableSkills.length ? askableSkills.join(", ") : "no other skills"}.`] : []),
        ].join(" "), true);
      }
      const tools = wanted.tools.filter((name) => !current.has(name) && !access.tools.includes(name)).map((name) => offer.get(name)!);
      const skills = wanted.skills.map((name) => skillRef(available.find((skill) => skill.name === name)!)).filter((ref) => !hasSkill(access.skills, ref));
      if (!tools.length && !skills.length) return text(`You already have ${listed([...wanted.tools, ...wanted.skills.map((name) => `the ${name} skill`)])}.`);
      if (pending.has(state.bot)) return text("Another access request is already waiting for the operator. Wait for its answer before asking again.", true);
      pending.add(state.bot);
      let response: RuntimeQuestionResponse | undefined;
      try {
        response = await chat.ask(accessQuestion(tools, skills, args.reason.trim()), context.abortSignal);
      } finally {
        pending.delete(state.bot);
      }
      if (context.abortSignal?.aborted) throw new Error("The access request was stopped.");
      const answer = response && "value" in response ? response.value.trim() : undefined;
      if (answer !== ALLOW) {
        return text(answer === DENY ? "The operator denied the request. Carry on without it, and ask again only if the job truly needs it."
          : answer ? `The operator didn't allow it and wrote: ${answer}`
            : "The operator dismissed the request without answering. Carry on without it.");
      }
      const granted = await api.commit(async (tx) => {
        const doc = await tx.doc(BotDoc, api.conversationId);
        const before = doc.access ?? { tools: [], skills: [] };
        const next: BotAccess = {
          tools: [...before.tools, ...tools.map((tool) => tool.name).filter((name) => !before.tools.includes(name))],
          skills: [...before.skills, ...skills.filter((ref) => !hasSkill(before.skills, ref))],
        };
        doc.access = next;
        return JSON.parse(JSON.stringify(next)) as BotAccess;
      }, context);
      await deps.recorded?.(state.bot, granted).catch((error: unknown) => deps.report?.(error));
      const names = [...tools.map((tool) => tool.name), ...skills.map((skill) => `the ${skill.name} skill`)];
      return {
        content: [{ type: "text", text: `The operator allowed it: you now have ${listed(names)}, from your next step.${skills.length ? " Load a skill with load_skill." : ""}` }],
        // Durable adds them to this run's tools at once, so the very next request offers them.
        control: { addTools: [...tools.map((tool) => tool.name), ...(skills.length ? [LOAD_SKILL_TOOL] : [])] },
      };
    },
  });

  const loadSkill = defineTool({
    name: LOAD_SKILL_TOOL,
    description: "Load one of your skills: its SKILL.md instructions or, with path, a file the skill refers to inside its own directory.",
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200, description: "The skill's name, as your skills section lists it." }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000, description: "A file inside the skill's directory, relative to it, as the skill refers to it." })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const state = await conversationBotState(api, api.conversationId, context);
      if (!state) return text("load_skill is only available in a bot's chat.", true);
      const chat = deps.chat(api.conversationId);
      const available = chat ? await chat.availableSkills() : await deps.skills((await api.agent(context)).cwd ?? deps.agentDir);
      const mine = state.access ? botSkills(available, state.access.skills) : [...available];
      const skill = mine.find((candidate) => candidate.name === args.name.trim());
      if (!skill) {
        return text(`You have no skill named "${args.name}". ${mine.length ? `Your skills: ${mine.map((each) => each.name).join(", ")}.` : "You have no skills yet."} Ask the operator for one with request_access.`, true);
      }
      if (!args.path) return text(skillBlock(skill));
      const file = await skillFile(skill, args.path);
      return "error" in file ? text(file.error, true) : text(file.text);
    },
  });

  const accessSection = section("bot_access", async (input, context) => {
    const state = await conversationBotState(input.read, input.conversationId, context);
    if (!state?.access) return undefined;
    const chat = deps.chat(input.conversationId);
    const cwd = input.env?.cwd ?? input.agent.cwd ?? deps.agentDir;
    const skills = await (chat ? chat.availableSkills() : deps.skills(cwd)).catch(() => []);
    return botAccessText(state.access, input.agent.tools.map((tool) => tool.name), chat?.botOffer() ?? [], skills);
  });

  return { tools: [requestAccess, loadSkill], sections: [accessSection] };
}

/** A text file inside the skill's own directory, by a path relative to it; links that lead out are refused. */
async function skillFile(skill: Pick<Skill, "name" | "baseDir">, path: string): Promise<{ text: string } | { error: string }> {
  const outside = { error: `${path} is not a file inside the ${skill.name} skill's directory.` };
  const base = await realpath(skill.baseDir).catch(() => undefined);
  const target = await realpath(resolve(skill.baseDir, path)).catch(() => undefined);
  if (!base || !target || (target !== base && !target.startsWith(base + sep))) return outside;
  const info = await stat(target);
  if (!info.isFile()) return outside;
  if (info.size > MAX_SKILL_FILE_BYTES) return { error: `${path} is larger than ${MAX_SKILL_FILE_BYTES / 1024} KB.` };
  const data = await readFile(target);
  if (data.includes(0)) return { error: `${path} is not a text file.` };
  return { text: data.toString("utf8") };
}
