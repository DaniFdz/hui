/**
 * Importing bots from other platforms' templates, and exporting HUI's (HUI-18; docs/api.md#importing-and-exporting-bots).
 *
 * An import reads its source (`bot-templates/`) into a `BotTemplate`, then plans it against this gateway: the handle it
 * gets, SOUL.md (its persona, then its memories under "What you already know": OptChat's memory is the chat's own log,
 * so nothing else can seed it), the model it names when one resolves, the tools a Claude Code subagent keeps, its
 * skills (renamed when a skill of its directory has the name), its routines' schedules and the HUI tool each
 * integration maps to. The preview is that plan; creating runs it again on the template the preview showed and makes
 * the bot through `BotService.create`, then its own skills, then its routines (disabled): a failure there deletes the
 * new bot again. Its opener is its first turn, a kickoff that asks it to send it.
 *
 * Nothing an import brings turns on more than a new bot has: a template can only turn tools off, routines start
 * disabled, and a model is kept only when it resolves. Its skills are on, like every skill of a bot: they are text the
 * operator read in the preview, they widen no tool, and each can be turned off in the Tools tab.
 *
 * An export is a zip: bot.json (profile, routines, the tool and skill lists), SOUL.md, the bot's own skills and, when
 * asked for, memory.md (its memory's view). Importing it gives the bot back.
 */
import { BOT_HANDLE, BOT_LIMITS, BOT_THINKING_LEVELS, handleFromName, isBotFaceShape, type BotAvatar, type BotView } from "../shared/bots.ts";
import {
  BOT_EXPORT_FORMAT, BOT_EXPORT_VERSION, BOT_TEMPLATE_FORMATS, BOT_TEMPLATE_LIMITS, botExportFileName, botOpenerKickoffText,
  type BotExportManifest, type BotImportPreview, type BotImportResult, type BotImportRoutine, type BotTemplate,
} from "../shared/bot-templates.ts";
import type { AutomationSchedule, AutomationTask, AutomationTaskInput } from "../src/lib/automation-types.ts";
import { nextScheduleAt } from "./automation.ts";
import type { BotOffer, BotService } from "./bot-service.ts";
import type { BotSkillFiles } from "./bot-skills.ts";
import { BotInputError, isOneGrapheme, RESERVED_HANDLES, uniqueHandle } from "./bots.ts";
import { CLAUDE_CODE_TOOLS } from "./bot-templates/claude-code.ts";
import { isRecord, oneLine, skillFileText, skillName, TemplateFormatError, type ImportFile } from "./bot-templates/common.ts";
import { readFileTemplates, readFolderTemplates, readTextTemplates, type TemplateChoice } from "./bot-templates/detect.ts";
import { parseGrokBotPage, grokBotUrl } from "./bot-templates/grok.ts";
import { huiExportEntries } from "./bot-templates/hui-export.ts";
import { composeSoul, matchIntegration, normalizeTemplate, resolveModel, type ModelInfo } from "./bot-templates/mapping.ts";
import { readSchedule } from "./bot-templates/schedule.ts";
import { safeRelativePath, writeZip } from "./bot-templates/zip.ts";

export type BotTemplateDeps = {
  bots: Pick<BotService, "create" | "get" | "list" | "send" | "delete" | "update" | "catalog" | "soul" | "memory">;
  /** What a new bot's chat is offered (the tools every chat has, the skills of a new home folder), here or on a worker. */
  offer(worker?: string): Promise<BotOffer>;
  /** Every model this gateway resolves. */
  models(): Promise<readonly ModelInfo[]>;
  routines: { tasks(): Promise<readonly AutomationTask[]>; create(input: AutomationTaskInput): Promise<AutomationTask> };
  /** A bot's own skills where its chat runs; undefined when that worker can't keep them. */
  skills(worker?: string): BotSkillFiles | undefined;
  /** A remote worker by id or exact name; absent: bots run here only. */
  findWorker?(target: string): Promise<{ id: string; name: string }>;
  /** Settings' profile name, which a character card's `{{user}}` becomes. */
  operator(): Promise<string | undefined>;
  /** The time zone routines' schedules are read in. */
  timezone(): string;
  /** A Grok Bot marketplace page's HTML, fetched only now, on the operator's request. */
  fetchPage(url: string): Promise<string>;
  /** A bot's own skills changed on this machine: its chat's resources load again. */
  skillsWritten?(cwd: string): void;
  now?: () => number;
  report?(event: { level: "warning" | "error"; action: string; summary: string; detail?: string }): void;
};

type Plan = {
  preview: Omit<BotImportPreview, "template" | "candidates" | "pick">;
  /** `POST /__hui/bots`'s body. */
  input: Record<string, unknown>;
  skills: { name: string; text: string }[];
  routines: (BotImportRoutine & { description?: string })[];
  /** A HUI export's turned-off skills, by name: set once its own skills exist. */
  disabledSkills: string[];
};

const listed = (items: readonly string[]) => items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A body's fields, refusing any other. */
function fields(body: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isRecord(body)) throw new BotInputError(`${what} must be an object.`);
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new BotInputError(`Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  return body;
}

function base64(value: unknown, what: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/=\s]*$/u.test(value)) throw new BotInputError(`${what} must be base64.`);
  if (value.length > Math.ceil(BOT_TEMPLATE_LIMITS.fileBytes / 3) * 4 + 1_024) throw new BotInputError(`${what} is larger than ${BOT_TEMPLATE_LIMITS.fileBytes / 1024 / 1024} MB.`);
  return Buffer.from(value, "base64");
}

/** A schedule HUI keeps as it is: a HUI export's, when it still has a next run. */
function exactSchedule(schedule: AutomationSchedule, now: number): AutomationSchedule | undefined {
  try {
    return nextScheduleAt(schedule, now) === null ? undefined : schedule;
  } catch {
    return undefined;
  }
}

export class BotTemplateService {
  readonly #deps: BotTemplateDeps;
  readonly #now: () => number;

  constructor(deps: BotTemplateDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  /** `POST /__hui/bots/import/preview`: `{ source, pick?, worker? }`. Reads the source (fetching a Grok Bot page now) and
   * says what creating its bot would do; nothing is created. */
  async preview(body: unknown): Promise<BotImportPreview> {
    const input = fields(body, ["source", "pick", "worker"], "An import preview");
    const choices = await this.#read(input["source"]);
    const pick = input["pick"] === undefined ? undefined : String(input["pick"]);
    const choice = pick === undefined ? choices[0]! : choices.find((each) => each.key === pick);
    if (!choice) throw new BotInputError(`This source holds no agent ${JSON.stringify(pick)}.`);
    const worker = await this.#worker(input["worker"]);
    // The template the browser gets back is exactly what creating it checks again.
    const template = normalizeTemplate(JSON.parse(JSON.stringify(choice.template)) as unknown);
    const plan = await this.#plan(template, worker);
    return {
      template,
      ...(choices.length > 1 ? { candidates: choices.map(({ key, template: each }) => ({ key, name: each.name, ...(each.title ? { title: each.title } : {}) })), pick: choice.key } : {}),
      ...plan.preview,
    };
  }

  /** `POST /__hui/bots/import`: `{ template, worker? }`, the template a preview returned. */
  async create(body: unknown): Promise<BotImportResult> {
    const input = fields(body, ["template", "worker"], "An import");
    const template = normalizeTemplate(input["template"]);
    const worker = await this.#worker(input["worker"]);
    const plan = await this.#plan(template, worker);
    const bot = await this.#deps.bots.create(plan.input);
    const warnings: string[] = [];
    try {
      if (plan.skills.length) {
        const files = this.#deps.skills(worker?.id);
        if (!files) throw new BotInputError(`${worker?.name ?? "This machine"} can't keep a bot's own skills.`);
        await files.write(bot.id, plan.skills);
        if (!worker) this.#deps.skillsWritten?.(bot.cwd);
      }
      for (const routine of plan.routines) {
        await this.#deps.routines.create({
          name: routine.name, sessionId: bot.sessionId, prompt: routine.prompt, schedule: routine.schedule, enabled: false,
          ...(routine.description ? { description: routine.description } : {}),
        });
      }
    } catch (error) {
      // Half an import is no import: the bot goes again, with its folder and the routines made so far.
      await this.#deps.bots.delete(bot.id).catch((cleanup: unknown) => this.#report("error", "bot_import_rollback_failed", `@${bot.handle} was left half imported`, cleanup));
      throw error;
    }
    if (plan.disabledSkills.length) {
      try {
        const catalog = await this.#deps.bots.catalog(bot.id);
        const known = plan.disabledSkills.filter((name) => catalog.skills.some((skill) => skill.name === name));
        if (known.length) await this.#deps.bots.update(bot.id, { disabledSkills: known });
      } catch (error) {
        warnings.push(`Its skills ${listed(plan.disabledSkills)} stay on: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let opener = false;
    if (plan.preview.opener) {
      try {
        await this.#deps.bots.send(bot.id, { text: botOpenerKickoffText(bot.name, plan.preview.opener) });
        opener = true;
      } catch (error) {
        warnings.push(`Its first message was not sent: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { bot: await this.#deps.bots.get(bot.id), skills: plan.skills.map((skill) => skill.name), routines: plan.routines.length, opener, warnings };
  }

  /** `GET /__hui/bots/:id/export`: the bot as a zip HUI imports again; `memory` adds its memory's view. */
  async export(target: string, options: { memory: boolean }): Promise<{ name: string; data: Buffer }> {
    const bot = await this.#deps.bots.get(target);
    const [soul, tasks] = await Promise.all([this.#deps.bots.soul(bot.id), this.#deps.routines.tasks()]);
    const files = this.#deps.skills(bot.worker?.id);
    const skills = files ? await files.read(bot.id) : [];
    const memory = options.memory ? await this.#memory(bot) : undefined;
    const avatar: BotExportManifest["bot"]["avatar"] = bot.avatar && Object.keys(bot.avatar).length ? { ...bot.avatar } : undefined;
    const manifest: BotExportManifest = {
      format: BOT_EXPORT_FORMAT,
      version: BOT_EXPORT_VERSION,
      exportedAt: new Date(this.#now()).toISOString(),
      bot: {
        name: bot.name, handle: bot.handle,
        ...(bot.title ? { title: bot.title } : {}),
        ...(bot.description ? { description: bot.description } : {}),
        ...(avatar ? { avatar } : {}),
        ...(bot.model ? { model: bot.model } : {}),
        ...(bot.thinking ? { thinking: bot.thinking } : {}),
        ...(bot.memoryModel ? { memoryModel: bot.memoryModel } : {}),
        ...(bot.memoryThinking ? { memoryThinking: bot.memoryThinking } : {}),
        ...(bot.voice ? { voice: { ...bot.voice } } : {}),
      },
      routines: tasks.filter((task) => task.sessionId === bot.sessionId).map((task) => ({
        name: task.name, ...(task.description ? { description: task.description } : {}), prompt: task.prompt, schedule: task.schedule,
        enabled: task.enabled, timeoutSeconds: task.timeoutSeconds,
      })),
      disabledTools: [...bot.disabledTools ?? []],
      disabledSkills: (bot.disabledSkills ?? []).map(({ name, path }) => ({ name, path })),
      skills: skills.map((skill) => skill.name),
      ...(memory ? { memory: "memory.md" as const } : {}),
    };
    return { name: botExportFileName(bot.handle), data: writeZip(huiExportEntries({ manifest, ...(soul ? { soul } : {}), skills, ...(memory ? { memory } : {}) }), new Date(this.#now())) };
  }

  async #memory(bot: BotView): Promise<string> {
    const { view } = await this.#deps.bots.memory(bot.id);
    return [
      `# Memory of @${bot.handle} (${bot.name})`,
      "",
      `Its OptChat memory as HUI exported it on ${new Date(this.#now()).toISOString().slice(0, 10)}: the latest messages one line each, older ones summarized. Importing this file puts it in the new bot's SOUL.md, under "What you already know".`,
      "",
      view.trim(),
    ].join("\n");
  }

  async #worker(value: unknown): Promise<{ id: string; name: string } | undefined> {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || !value.trim() || value.length > 100) throw new BotInputError("worker must name a worker: its name or id.");
    if (!this.#deps.findWorker) throw new BotInputError("This gateway cannot run bots on remote workers.");
    return this.#deps.findWorker(value.trim());
  }

  /** Every bot a source holds. */
  async #read(source: unknown): Promise<TemplateChoice[]> {
    if (!isRecord(source)) throw new BotInputError("source is required: a file, a folder, a link or text.");
    const options = { operator: await this.#deps.operator().catch(() => undefined) };
    const { kind } = source;
    if (kind === "text") {
      const input = fields(source, ["kind", "text"], "A pasted source");
      if (typeof input["text"] !== "string") throw new BotInputError("text must be text.");
      return readTextTemplates(input["text"], undefined, options.operator ? options : {});
    }
    if (kind === "url") {
      const input = fields(source, ["kind", "url"], "A link");
      const url = typeof input["url"] === "string" ? grokBotUrl(input["url"]) : undefined;
      if (!url) throw new TemplateFormatError("HUI fetches Grok Bot marketplace links only (https://x.ai/bot/marketplace/bots/…). For anything else, download the file and import it, or paste its text.");
      return [{ key: "0", template: parseGrokBotPage(await this.#deps.fetchPage(url), url) }];
    }
    if (kind === "file") {
      const input = fields(source, ["kind", "name", "data"], "A file");
      const name = typeof input["name"] === "string" ? input["name"].split(/[\\/]/u).pop()!.slice(0, 255) : "";
      if (!name) throw new BotInputError("A file needs its name.");
      return readFileTemplates(name, base64(input["data"], name), options.operator ? options : {});
    }
    if (kind === "files") {
      const input = fields(source, ["kind", "files"], "A folder");
      const list = input["files"];
      if (!Array.isArray(list) || !list.length) throw new BotInputError("A folder needs its files.");
      if (list.length > BOT_TEMPLATE_LIMITS.files) throw new TemplateFormatError(`This folder holds ${list.length} files; HUI imports at most ${BOT_TEMPLATE_LIMITS.files}.`);
      const files: ImportFile[] = [];
      for (const entry of list) {
        if (!isRecord(entry) || typeof entry["path"] !== "string") throw new BotInputError("Each file of a folder needs its path and data.");
        const path = safeRelativePath(entry["path"]);
        if (!path) throw new BotInputError(`${JSON.stringify(entry["path"].slice(0, 200))} is not a path inside the folder.`);
        files.push({ path, data: base64(entry["data"], path) });
      }
      return readFolderTemplates(files, options.operator ? options : {});
    }
    throw new BotInputError("source.kind must be file, files, url or text.");
  }

  async #plan(template: BotTemplate, worker: { id: string; name: string } | undefined): Promise<Plan> {
    const now = this.#now();
    const dropped = [...template.dropped];
    const notes = [...template.notes];
    const [bots, offer, models] = await Promise.all([this.#deps.bots.list({ archived: "all" }), this.#deps.offer(worker?.id), this.#deps.models().catch(() => [])]);
    const taken = new Set(bots.map((bot) => bot.handle));
    const name = oneLine(template.name, BOT_LIMITS.name) || "Imported Bot";
    const own = template.hui?.handle;
    const keepHandle = own !== undefined && BOT_HANDLE.test(own) && !taken.has(own) && !RESERVED_HANDLES.has(own);
    const handle = keepHandle ? own : uniqueHandle(handleFromName(name), taken);
    if (own && !keepHandle) notes.push(`@${own} is taken here, so it is @${handle}.`);
    const input: Record<string, unknown> = { name, ...(keepHandle ? { handle } : {}) };
    if (worker) input["worker"] = worker.id;
    if (template.title) input["title"] = oneLine(template.title, BOT_LIMITS.title);
    if (template.description) input["description"] = template.description.slice(0, BOT_LIMITS.description);
    const avatar: BotAvatar = {
      ...(template.emoji && isOneGrapheme(template.emoji) ? { emoji: template.emoji } : {}),
      ...(isBotFaceShape(template.avatar?.shape) ? { shape: template.avatar.shape } : {}),
      ...(template.avatar?.color && /^#[0-9a-f]{6}$/u.test(template.avatar.color) ? { color: template.avatar.color } : {}),
    };
    if (template.emoji && !avatar.emoji) dropped.push(`Its emoji "${oneLine(template.emoji, 20)}": a HUI bot's emoji is one character.`);
    if (Object.keys(avatar).length) input["avatar"] = avatar;

    // Tools: a Claude Code subagent's list keeps only what it maps to; a HUI export turns its own list off. Never more on.
    const offered = offer.tools.map((tool) => tool.name);
    let disabledTools: string[] = [];
    if (template.tools) {
      const keep = new Set(template.tools.flatMap((tool) => CLAUDE_CODE_TOOLS[tool] ?? []));
      const unknown = template.tools.filter((tool) => !CLAUDE_CODE_TOOLS[tool]);
      disabledTools = offered.filter((tool) => !keep.has(tool));
      if (unknown.length) dropped.push(`Claude Code tools with nothing like them here: ${listed(unknown)}.`);
      const kept = offered.filter((tool) => keep.has(tool));
      notes.push(`Its tools list keeps ${kept.length ? listed(kept) : "none of HUI's tools"} on and turns the other ${plural(disabledTools.length, "tool")} off; turn any back on in its Tools tab.`);
    } else if (template.hui?.disabledTools?.length) {
      disabledTools = template.hui.disabledTools.filter((tool) => offered.includes(tool));
      const missing = template.hui.disabledTools.filter((tool) => !offered.includes(tool));
      if (missing.length) dropped.push(`Turned off there, but no tool of a new bot here: ${listed(missing)}.`);
    }
    if (disabledTools.length) input["disabledTools"] = disabledTools;

    // Its own skills, named as PI wants them, and apart from the skills its directory already has.
    const skills: Plan["skills"] = [];
    const previewSkills: BotImportPreview["skills"] = [];
    if (template.skills.length) {
      if (!this.#deps.skills(worker?.id)) {
        dropped.push(`${plural(template.skills.length, "skill")}: ${worker?.name ?? "This machine"} runs an older HUI worker that can't keep a bot's own skills.`);
      } else {
        const names = new Set(offer.skills.map((skill) => skill.name));
        for (const skill of template.skills) {
          const wanted = skillName(skill.name);
          let unique = wanted;
          for (let suffix = 2; names.has(unique); suffix += 1) unique = `${wanted.slice(0, 64 - String(suffix).length - 1).replace(/-+$/u, "")}-${suffix}`;
          names.add(unique);
          if (unique !== wanted) notes.push(`Skill ${skill.name} is imported as ${unique}: a skill of its directory has the name ${wanted}.`);
          skills.push({ name: unique, text: skillFileText({ ...skill, name: unique }) });
          previewSkills.push({ name: unique, original: skill.name, description: skill.description, content: skill.content });
        }
      }
    }

    // SOUL.md: the persona, then what it already knows.
    const source = `${BOT_TEMPLATE_FORMATS[template.format]}${template.origin ? ` (${oneLine(template.origin, 120)})` : ""}`;
    // A template whose job lives in its memories (many Grok marketplace bots leave their instructions empty) keeps them:
    // its description stands in as the persona they follow.
    let persona = template.soul;
    if (!persona.trim() && template.memories.length) {
      persona = template.description?.trim() || `You are ${name}${template.title ? `, ${template.title}` : ""}.`;
      notes.push("It has no instructions of its own: its description stands in as its persona, followed by what it already knows.");
    }
    const composed = composeSoul(persona, template.memories, source);
    if (composed.cut) notes.push(`Its persona has ${template.soul.length.toLocaleString("en-US")} characters; SOUL.md keeps the first ${BOT_LIMITS.soul.toLocaleString("en-US")}.`);
    const left = template.memories.length - composed.included;
    if (left) dropped.push(composed.soul ? `${plural(left, "memory", "memories")} that didn't fit in SOUL.md's ${BOT_LIMITS.soul.toLocaleString("en-US")} characters.` : `${plural(left, "memory", "memories")}: without a persona the bot writes its own soul in its first conversation.`);
    if (composed.soul) input["soul"] = composed.soul;
    else notes.push("It has no persona, so it starts with its first conversation: it asks what you expect and writes its SOUL.md.");
    const opener = composed.soul ? template.opener : undefined;
    if (template.opener && !opener) dropped.push("Its first message: without a persona the bot opens its first conversation itself.");

    // Models: only what this gateway resolves.
    let model: string | undefined;
    if (template.model) {
      model = resolveModel(template.model, models);
      if (model) input["model"] = model;
      else dropped.push(`Its model ${oneLine(template.model, 80)}: this gateway has none by that name, so it starts on the default.`);
    }
    const levels: readonly string[] = BOT_THINKING_LEVELS;
    const thinking = template.hui?.thinking && levels.includes(template.hui.thinking) ? template.hui.thinking : undefined;
    if (thinking) input["thinking"] = thinking;
    let utilityModel: string | undefined;
    if (template.hui?.memoryModel) {
      utilityModel = resolveModel(template.hui.memoryModel, models);
      if (utilityModel) input["memoryModel"] = utilityModel;
      else dropped.push(`Its utility model ${template.hui.memoryModel}: this gateway has none by that name.`);
    }
    if (template.hui?.memoryThinking && levels.includes(template.hui.memoryThinking)) input["memoryThinking"] = template.hui.memoryThinking;
    if (template.hui?.voice && Object.keys(template.hui.voice).length) input["voice"] = { ...template.hui.voice };

    // Routines: disabled, each on the schedule HUI reads from it.
    const timezone = this.#deps.timezone();
    const routines: Plan["routines"] = template.routines.map((routine) => {
      const exact = routine.automation ? exactSchedule(routine.automation, now) : undefined;
      const read = exact ? { schedule: exact, guessed: false } : readSchedule(routine.schedule, timezone, now);
      return {
        name: oneLine(routine.name, 200) || "Routine", prompt: routine.prompt, schedule: read.schedule, guessed: read.guessed,
        ...(routine.schedule ? { scheduleText: routine.schedule } : {}),
        ...(routine.description ? { description: routine.description.slice(0, 500) } : {}),
      };
    });
    if (routines.length) notes.push(`${routines.length === 1 ? "Its routine starts" : `Its ${routines.length} routines start`} disabled: check ${routines.length === 1 ? "it" : "them"} in its Routines tab, then turn ${routines.length === 1 ? "it" : "them"} on.`);

    const integrations = template.integrations.map((integration) => {
      const tool = matchIntegration(integration, offer.tools);
      return { ...integration, ...(tool ? { tool: { name: tool.name, label: tool.label } } : {}) };
    });
    const disabledSkills = template.hui?.disabledSkills ?? [];
    return {
      input,
      skills,
      routines,
      disabledSkills,
      preview: {
        bot: {
          name, handle,
          ...(input["title"] ? { title: input["title"] as string } : {}),
          ...(input["description"] ? { description: input["description"] as string } : {}),
          ...(avatar.emoji ? { emoji: avatar.emoji } : {}),
          ...(avatar.shape || avatar.color ? { avatar: { ...(avatar.shape ? { shape: avatar.shape } : {}), ...(avatar.color ? { color: avatar.color } : {}) } } : {}),
          ...(worker ? { worker } : {}),
        },
        soul: composed.soul,
        ...(opener ? { opener } : {}),
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
        ...(utilityModel ? { utilityModel } : {}),
        memories: { included: composed.included, total: template.memories.length },
        skills: previewSkills,
        routines: routines.map(({ description: _description, ...routine }) => routine),
        integrations,
        disabledTools,
        disabledSkills,
        dropped,
        notes,
      },
    };
  }

  #report(level: "warning" | "error", action: string, summary: string, error?: unknown): void {
    this.#deps.report?.({ level, action, summary, ...(error === undefined ? {} : { detail: error instanceof Error ? error.message : String(error) }) });
  }
}
