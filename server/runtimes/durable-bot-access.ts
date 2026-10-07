/**
 * What a bot's chat may use (HUI-18; SPEC decision of 2026-10-06): every tool
 * and skill a session in its directory gets, except the ones the operator
 * turned off for that bot. What is off lives in its conversation's `hui.bot`
 * document, and everything here reads that document where the conversation
 * runs, so a worker host enforces the same choices as the gateway. A tool or
 * skill that appears later (a new extension, a HUI update, a new skill) is on
 * until the operator turns it off.
 *
 * - `DurableSession.applyTools` leaves what is off out of a bot's offer
 *   (`planBotTools`), extension tools included, and the HUI tool bridge
 *   (`DurableHost`) refuses a bot's call to a HUI tool that is off.
 * - Its prompt lists only the skills that are on, and `/skill:` offers only
 *   them. A bot with neither read nor bash loads them with `load_skill`.
 * - While something is off, `request_access` asks the operator for it through
 *   HUI's question flow: Allow turns it back on from the run's next request.
 *
 * Tools are the boundary, nothing more: a bot with bash or read reaches what
 * the user's account can, the files of turned-off skills included. Isolation
 * is a worker in a container.
 */
import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { defineTool, section, type ConversationId, type PromptSection, type ToolExecutionResult, type ToolRegistration } from "@earendil-works/pi-durable";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BOT_ACCESS_ANSWERS, botTurnOrigin, type BotAccess, type BotCatalogSkill, type BotCatalogTool, type BotSkillRef, type BotToolGroup } from "../../shared/bots.ts";
import { bundledSkills } from "../bundled-skills.ts";
import { BotDoc, conversationBotState, MESSAGE_BOT_TOOL, SET_PROFILE_TOOL, WRITE_SOUL_TOOL } from "./durable-bots.ts";
import { huiToolDefinitions } from "./hui-tools.ts";
import type { QuestionDraft } from "./question-box.ts";
import type { RuntimeQuestionResponse } from "./types.ts";

export const REQUEST_ACCESS_TOOL = "request_access";
export const LOAD_SKILL_TOOL = "load_skill";
/**
 * A bot's own tools, its essentials: the operator can't turn them off, and the catalog doesn't offer them. Its soul
 * and profile tools are always offered; `request_access` and `load_skill` while it has a use for them. OptChat's
 * memory tools are essentials too, kept apart because only a chat with OptChat has them.
 */
export const BOT_OWN_TOOLS: readonly string[] = [WRITE_SOUL_TOOL, SET_PROFILE_TOOL, REQUEST_ACCESS_TOOL, LOAD_SKILL_TOOL];
/** The file tools a model loads skills with (PI's skills section names one); a bot with neither gets `load_skill`. */
const SKILL_READERS: readonly string[] = ["read", "bash"];

/**
 * Tools that reach past whatever else the operator turned off: they run commands (`bash`, `terminal`, `watcher`),
 * change files other programs load, such as PI extensions or shell startup files (`write`, `edit`), drive HUI's own
 * page and `file://` URLs (`browser`), or act through another session, which has every tool (`sessions_spawn`,
 * `sessions_send`, `subagents`). Like every tool they are on by default; the catalog labels them, so the operator sees
 * what turning another tool off leaves open. `secret_request` is not one: it only asks the operator, who answers each
 * request in the chat's Secret card or refuses it.
 */
export const POWERFUL_TOOLS: ReadonlySet<string> = new Set([
  "write", "edit", "bash", "terminal", "watcher", "browser", "sessions_spawn", "sessions_send", "subagents",
]);

/** What the catalog shows as always on: a bot's own tools and OptChat's memory tools, which every bot's chat has. */
export const BOT_ALWAYS_ON: readonly { name: string; description: string }[] = [
  { name: WRITE_SOUL_TOOL, description: "Rewrite its SOUL.md when you ask" },
  { name: SET_PROFILE_TOOL, description: "Change its name or title when you ask" },
  { name: REQUEST_ACCESS_TOOL, description: "Ask you to turn something back on, while anything is off" },
  { name: LOAD_SKILL_TOOL, description: "Load its skills when it has neither read nor bash" },
  { name: "zoom", description: "Open older lines of its memory" },
  { name: "date", description: "Tell when a line of its memory was said" },
];

/** What a bot's own tools add to HUI's active-tool section; the `bot_access` section explains the rest. */
export const BOT_ACCESS_CONTRIBUTIONS: Readonly<Record<string, { snippet: string; guidelines: readonly string[] }>> = {
  [REQUEST_ACCESS_TOOL]: { snippet: "Ask the operator to turn back on a tool or skill they turned off", guidelines: [] },
  [LOAD_SKILL_TOOL]: { snippet: "Load one of your skills, or a file it refers to", guidelines: [] },
};

/** The largest file `load_skill` returns from a skill's directory. */
const MAX_SKILL_FILE_BYTES = 256 * 1024;
/** Longest skill description the access section repeats. */
const ACCESS_DESCRIPTION_CHARS = 100;
const [ALLOW, DENY] = BOT_ACCESS_ANSWERS;

/* ── catalog ─────────────────────────────────────────────────────────── */

/** One tool of a bot's chat the operator can turn off, as the catalog and the access section describe it. */
export type OfferedTool = Omit<BotCatalogTool, "enabled">;
export type OfferedSkill = Omit<BotCatalogSkill, "enabled">;

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

/** The tools every bot's chat has, before extensions, that the operator can turn off: the coding tools, HUI's and
 * `message_bot`. What a chat that isn't running here can be checked against. */
export function builtinOffer(coding: readonly ToolRegistration[], hui: readonly ToolRegistration[], bots: readonly ToolRegistration[]): OfferedTool[] {
  return [
    ...coding.map((tool) => describeTool(tool, { kind: "coding" })),
    ...hui.map((tool) => describeTool(tool, { kind: "hui" })),
    ...bots.filter((tool) => !BOT_OWN_TOOLS.includes(tool.name)).map((tool) => describeTool(tool, { kind: "bot" })),
  ];
}

/** A skill as the catalog shows it: by the name and path a bot's lists use, with where it comes from (the directory
 * holding it, `~` for this host's home). */
export function offeredSkill(skill: Pick<Skill, "name" | "description" | "filePath" | "baseDir">): OfferedSkill {
  const ref = skillRef(skill);
  const bundled = ref.path !== skill.filePath;
  const folder = dirname(skill.baseDir);
  const home = homedir();
  const shown = folder === home || folder.startsWith(home + sep) ? `~${folder.slice(home.length)}` : folder;
  return { ...ref, description: skill.description, source: bundled ? "HUI defaults" : shown };
}

/** Where a tool probably comes from, by its name, for a description without a live session. */
function originOf(name: string): ToolOrigin {
  if (CODING_TOOLS[name]) return { kind: "coding" };
  if (BOT_TOOLS[name]) return { kind: "bot" };
  return huiTool(name) ? { kind: "hui" } : { kind: "extension", source: "extension" };
}

/* ── tools ───────────────────────────────────────────────────────────── */

/** How a bot's chat is offered tools. */
export type BotToolPlan<T> = {
  /** The tools the operator can turn off, in offer order: all but OptChat's memory tools and the bot's own. */
  listable: T[];
  /** The tools of the offer its chat goes without: those turned off, and its own ones it has no use for. */
  removed: T[];
};

/**
 * A bot's chat gets what a session in its directory is offered (`offer`, in offer order), less what the operator
 * turned off. OptChat's memory tools and its own tools can't be turned off; it is offered `request_access` while
 * something is off, and `load_skill` while it has a skill and neither read nor bash.
 */
export function planBotTools<T extends { readonly name: string }>(
  offer: readonly T[], access: BotAccess, context: { memory: readonly string[]; skillsOn: number; skillsOff: number },
): BotToolPlan<T> {
  const listable = offer.filter((tool) => !context.memory.includes(tool.name) && !BOT_OWN_TOOLS.includes(tool.name));
  const off = new Set(listable.filter((tool) => access.disabledTools.includes(tool.name)).map((tool) => tool.name));
  const kept = (name: string) => offer.some((tool) => tool.name === name) && !off.has(name);
  const unused = new Set([
    ...(off.size || context.skillsOff ? [] : [REQUEST_ACCESS_TOOL]),
    ...(context.skillsOn && !SKILL_READERS.some(kept) ? [] : [LOAD_SKILL_TOOL]),
  ]);
  return { listable, removed: offer.filter((tool) => off.has(tool.name) || unused.has(tool.name)) };
}

/** Whether a bot's chat may call the HUI tool `name`: the bridge's own check, apart from what the chat is offered. */
export function botMayCall(access: BotAccess, name: string): boolean {
  return BOT_OWN_TOOLS.includes(name) || !access.disabledTools.includes(name);
}

/* ── skills ──────────────────────────────────────────────────────────── */

/** How a bot's lists name a skill: its name and SKILL.md path, or a bundled skill's stable preference path, which
 * survives upgrades and checkout moves (as Settings' disabled skills do). */
export function skillRef(skill: { readonly name: string; readonly filePath: string }): BotSkillRef {
  const bundled = bundledSkills.find((each) => each.path === skill.filePath);
  return { name: skill.name, path: bundled?.preferencePath ?? skill.filePath };
}

export function hasSkill(refs: readonly BotSkillRef[], ref: BotSkillRef): boolean {
  return refs.some((each) => each.name === ref.name && each.path === ref.path);
}

/** The skills of `skills` a bot's chat has: all but the ones the operator turned off. */
export function botSkills<T extends { readonly name: string; readonly filePath: string }>(skills: readonly T[], disabled: readonly BotSkillRef[]): T[] {
  return skills.filter((skill) => !hasSkill(disabled, skillRef(skill)));
}

/** A skill's instructions as the model reads them, from `/skill:name` or `load_skill`: SKILL.md without its front
 * matter, with the directory its references are relative to. */
export function skillBlock(skill: Pick<Skill, "name" | "filePath" | "baseDir">): string {
  const body = readFileSync(skill.filePath, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "").trim();
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

const escapeXml = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");

/** The `skills` prompt section of a bot with neither read nor bash: PI's own, told to load each skill with
 * `load_skill`. Skills that disable model invocation stay out, as in PI. */
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

/** The `bot_access` section of a bot's chat: what the operator turned off and how to ask for it back. Undefined while
 * nothing is off, so a bot nobody restricted reads the prompt it always did. */
export function botAccessText(tools: readonly Pick<OfferedTool, "name" | "description" | "powerful">[], skills: readonly Pick<Skill, "name" | "description">[]): string | undefined {
  if (!tools.length && !skills.length) return undefined;
  return [
    "The operator turned off some of your tools and skills in this chat:",
    ...(tools.length ? ["Tools:", ...tools.map((tool) => `- ${tool.name}: ${tool.description}${tool.powerful ? " (powerful)" : ""}`)] : []),
    ...(skills.length ? ["Skills:", ...skills.map((skill) => `- ${skill.name}: ${oneLine(skill.description, ACCESS_DESCRIPTION_CHARS)}`)] : []),
    "If a job truly needs one of them, ask for it with request_access: name exactly what you need and say why. The operator answers Allow or Deny in this chat, and what they allow is yours from your next step. Ask for one thing at a time, and don't work around a turned-off tool through other tools, bots or sessions.",
  ].join("\n");
}

/* ── the bot's own tools ─────────────────────────────────────────────── */

/** The live chat of a bot's conversation, which its own tools ask through. */
export interface BotChat {
  /** The tools the operator can turn off in this chat, as the latest tool offer found them. */
  botOffer(): readonly OfferedTool[];
  /** Skills a session in this chat's directory gets, Settings' choices applied. */
  availableSkills(): Promise<readonly Skill[]>;
  /** Asks the operator in this chat; undefined once dismissed, or when `signal` aborts first. */
  ask(question: QuestionDraft, signal?: AbortSignal): Promise<RuntimeQuestionResponse | undefined>;
  /** Offers the conversation its tools again, after its lists changed. */
  applyTools(): Promise<void>;
  /** The message that started the run going now (or the latest one): who started the turn, as `botTurnOrigin` reads
   * it. */
  runInput(): string | undefined;
}

export type BotAccessDeps = {
  /** The live session of a conversation; undefined while none has it open. */
  chat(conversationId: ConversationId): BotChat | undefined;
  /** Skills of a directory, for prompts and `load_skill` without a live session. */
  skills(cwd: string): Promise<readonly Skill[]>;
  /** Where a conversation without a directory runs. */
  agentDir: string;
  /** HUI tools a bot's chat here is never offered, since they act on another machine (a worker host's
   * `gatewayOnlyTools`): never listed as off, never asked for. */
  gatewayOnly?: readonly string[];
  /** After the operator allowed a request: the gateway mirrors the lists into its roster. */
  recorded?(botId: string, access: BotAccess): Promise<void>;
  /** A step after a grant failed: mirroring it (`roster`) or offering the tools again (`offer`). Never the model's. */
  report?(step: "roster" | "offer", error: unknown): void;
};

type Result = ToolExecutionResult;
const text = (value: string, isError = false): Result => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
const unique = (values: readonly string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];

/** Who started the turn that asks, when it wasn't the operator; the operator answers either way. */
export function turnNote(input: string | undefined): string | undefined {
  const origin = botTurnOrigin(input);
  switch (origin.kind) {
    case "routine": return `Asked during the routine "${origin.name}".`;
    case "bot": return `Asked while handling a message from @${origin.handle}.`;
    case "kickoff": return "Asked in its first turn, before you wrote.";
    case "operator": return undefined;
  }
}

/** What the operator is asked: Allow or Deny, the items (powerful ones marked), the bot's reason and, when a routine,
 * another bot or HUI started the turn, which. */
export function accessQuestion(tools: readonly OfferedTool[], skills: readonly BotSkillRef[], reason: string, note?: string): QuestionDraft {
  const items = [
    ...tools.map((tool) => (tool.powerful ? `${tool.name} (powerful)` : tool.name)),
    ...skills.map((skill) => `the ${skill.name} skill`),
  ];
  return { method: "select", title: `Allow access to ${listed(items)}?`, message: note ? `${reason}\n\n${note}` : reason, options: [ALLOW, DENY] };
}

/** `request_access`, `load_skill` and the `bot_access` section. Allows one request per bot at a time. */
export function botAccessParts(deps: BotAccessDeps): { tools: ToolRegistration[]; sections: PromptSection[] } {
  const pending = new Set<string>();

  const requestAccess = defineTool({
    name: REQUEST_ACCESS_TOOL,
    description: "Ask the operator to turn back on tools or skills they turned off in your chat. They answer Allow or Deny there; what they allow is yours from your next step. Name exactly what the current job needs and say why. Names that aren't turned off are refused with the ones that are.",
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
      const chat = deps.chat(api.conversationId);
      if (!chat) return text("Your chat isn't open in HUI, so the operator can't be asked now. Try again in a later turn.", true);
      const wanted = { tools: unique(args.tools), skills: unique(args.skills) };
      if (!wanted.tools.length && !wanted.skills.length) return text("Name at least one tool or skill to ask for.", true);
      const current = new Set((await api.agent(context)).tools.map((tool) => tool.name));
      const offer = chat.botOffer();
      const available = await chat.availableSkills();
      const offTools = offer.filter((tool) => state.disabledTools.includes(tool.name));
      const offSkills = available.filter((skill) => hasSkill(state.disabledSkills, skillRef(skill)));
      // What acts on another machine isn't this chat's to ask for, whatever its lists say.
      const elsewhere = wanted.tools.filter((name) => deps.gatewayOnly?.includes(name) === true);
      const unknownTools = wanted.tools.filter((name) => !elsewhere.includes(name) && !current.has(name) && !offer.some((tool) => tool.name === name));
      const unknownSkills = wanted.skills.filter((name) => !available.some((skill) => skill.name === name));
      if (elsewhere.length || unknownTools.length || unknownSkills.length) {
        const askable = (names: readonly string[], kind: string) => (names.length ? names.join(", ") : `nothing, no ${kind} is turned off`);
        const one = elsewhere.length === 1;
        return text([
          ...(elsewhere.length ? [`${listed(elsewhere)} ${one ? "works" : "work"} only on HUI's own machine, not the one you run on: ${one ? "it isn't" : "they aren't"} yours to ask for.`] : []),
          ...(unknownTools.length ? [`No tool named ${listed(unknownTools)}.`] : []),
          ...(elsewhere.length || unknownTools.length ? [`You can ask for: ${askable(offTools.map((tool) => tool.name), "tool")}.`] : []),
          ...(unknownSkills.length ? [`No skill named ${listed(unknownSkills)}. You can ask for: ${askable(offSkills.map((skill) => skill.name), "skill")}.`] : []),
        ].join(" "), true);
      }
      const tools = offTools.filter((tool) => wanted.tools.includes(tool.name));
      const skills = offSkills.filter((skill) => wanted.skills.includes(skill.name)).map(skillRef);
      if (!tools.length && !skills.length) return text(`You already have ${listed([...wanted.tools, ...wanted.skills.map((name) => `the ${name} skill`)])}.`);
      if (pending.has(state.bot)) return text("Another access request is already waiting for the operator. Wait for its answer before asking again.", true);
      pending.add(state.bot);
      let response: RuntimeQuestionResponse | undefined;
      try {
        // A routine's or another bot's turn may ask too; only the operator answers, through HUI's question routes.
        response = await chat.ask(accessQuestion(tools, skills, args.reason.trim(), turnNote(chat.runInput())), context.abortSignal);
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
        const names = new Set(tools.map((tool) => tool.name));
        doc.disabledTools = (Array.isArray(doc.disabledTools) ? doc.disabledTools : []).filter((name) => !names.has(name));
        doc.disabledSkills = (Array.isArray(doc.disabledSkills) ? doc.disabledSkills : []).filter((ref) => !hasSkill(skills, ref));
        return JSON.parse(JSON.stringify({ disabledTools: doc.disabledTools, disabledSkills: doc.disabledSkills })) as BotAccess;
      }, context);
      await deps.recorded?.(state.bot, granted).catch((error: unknown) => deps.report?.("roster", error));
      // Offered again at once: request_access goes once nothing is off, load_skill comes with a first skill.
      await chat.applyTools().catch((error: unknown) => deps.report?.("offer", error));
      const loader = skills.length > 0 && !SKILL_READERS.some((name) => current.has(name));
      const names = [...tools.map((tool) => tool.name), ...skills.map((skill) => `the ${skill.name} skill`)];
      return {
        content: [{ type: "text", text: `The operator allowed it: you now have ${listed(names)}, from your next step.${loader ? " Load a skill with load_skill." : ""}` }],
        // Should offering them again have failed, Durable still adds them to this run's tools when the round ends.
        control: { addTools: [...tools.map((tool) => tool.name), ...(loader ? [LOAD_SKILL_TOOL] : [])] },
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
      const name = args.name.trim();
      const mine = botSkills(available, state.disabledSkills);
      const skill = mine.find((candidate) => candidate.name === name);
      if (!skill) {
        if (available.some((candidate) => candidate.name === name)) {
          return text(`The operator turned off the ${name} skill. Ask for it with request_access if the job needs it.`, true);
        }
        return text(`You have no skill named "${name}". ${mine.length ? `Your skills: ${mine.map((each) => each.name).join(", ")}.` : "You have no skills."}`, true);
      }
      if (!args.path) return text(skillBlock(skill));
      const file = await skillFile(skill, args.path);
      return "error" in file ? text(file.error, true) : text(file.text);
    },
  });

  const accessSection = section("bot_access", async (input, context) => {
    const state = await conversationBotState(input.read, input.conversationId, context);
    if (!state || (!state.disabledTools.length && !state.disabledSkills.length)) return undefined;
    const offered = new Set(input.agent.tools.map((tool) => tool.name));
    // The live chat's offer, or what the request's extensions compose: never what acts on another machine.
    const live = deps.chat(input.conversationId)?.botOffer();
    const candidates = live ?? input.agent.extensions.flatMap((extension) => extension.tools ?? [])
      .filter((tool) => !BOT_OWN_TOOLS.includes(tool.name) && !deps.gatewayOnly?.includes(tool.name)).map((tool) => describeTool(tool, originOf(tool.name)));
    const tools = candidates.filter((tool) => state.disabledTools.includes(tool.name) && !offered.has(tool.name));
    const cwd = input.env?.cwd ?? input.agent.cwd ?? deps.agentDir;
    const skills = (await deps.skills(cwd).catch(() => [])).filter((skill) => hasSkill(state.disabledSkills, skillRef(skill)));
    return botAccessText(tools, skills);
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
