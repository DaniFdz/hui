/**
 * HUI's own bot export: a zip with `bot.json` (`BotExportManifest`), `SOUL.md`, the bot's own skills as
 * `skills/<name>/SKILL.md` and, when asked for, `memory.md` (its memory's view). Importing one gives the same profile,
 * soul, skills, routines (disabled, as every import's) and tool and skill lists; its memory joins the soul's "What you
 * already know", as every template's memories do.
 */
import { BOT_LIMITS, isBotFaceEars, isBotFaceShape, type BotVoice } from "../../shared/bots.ts";
import { BOT_EXPORT_FILES, BOT_EXPORT_FORMAT, BOT_EXPORT_VERSION, type BotExportManifest, type BotTemplate } from "../../shared/bot-templates.ts";
import type { AutomationSchedule } from "../../src/lib/automation-types.ts";
import { blankTemplate, fileText, findFile, isRecord, oneLine, skillFromFile, str, TemplateFormatError, unwrapFolder, type ImportFile } from "./common.ts";
import type { ZipEntry } from "./zip.ts";

function manifestOf(files: readonly ImportFile[]): unknown {
  const file = findFile(unwrapFolder(files).files, BOT_EXPORT_FILES.manifest);
  const text = file ? fileText(file) : undefined;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Whether a parsed JSON file is a HUI export's manifest. */
export function isHuiManifest(value: unknown): boolean {
  return isRecord(value) && value["format"] === BOT_EXPORT_FORMAT;
}

export function isHuiExport(files: readonly ImportFile[]): boolean {
  return isHuiManifest(manifestOf(files));
}

function schedule(value: unknown): AutomationSchedule | undefined {
  if (!isRecord(value)) return undefined;
  if (value["kind"] === "at" && typeof value["at"] === "string") return { kind: "at", at: value["at"] };
  if (value["kind"] === "every" && typeof value["everyMs"] === "number") return { kind: "every", everyMs: value["everyMs"] };
  if (value["kind"] === "cron" && typeof value["expression"] === "string") return { kind: "cron", expression: value["expression"], timezone: str(value["timezone"]) || "UTC" };
  return undefined;
}

/** `AutomationSchedule` as the text the schedule reader reads back exactly. */
export function scheduleLabel(value: AutomationSchedule): string {
  if (value.kind === "at") return `at ${value.at}`;
  if (value.kind === "every") return `every ${Math.round(value.everyMs / 60_000)}m`;
  return `cron ${value.expression} ${value.timezone}`;
}

/** A HUI export's bot, from its manifest (parsed) and its files. */
export function parseHuiExport(all: readonly ImportFile[], origin?: string, parsedManifest?: unknown): BotTemplate {
  const { files } = unwrapFolder(all);
  const manifest = parsedManifest ?? manifestOf(all);
  if (!isRecord(manifest) || manifest["format"] !== BOT_EXPORT_FORMAT) throw new TemplateFormatError("This is not a HUI bot export: its bot.json is missing or broken.");
  if (typeof manifest["version"] === "number" && manifest["version"] > BOT_EXPORT_VERSION) throw new TemplateFormatError("This bot was exported by a newer HUI. Update HUI to import it.");
  const bot = isRecord(manifest["bot"]) ? manifest["bot"] : {};
  const name = str(bot["name"]);
  if (!name) throw new TemplateFormatError("This HUI bot export names no bot.");
  const template = blankTemplate("hui", oneLine(name, BOT_LIMITS.name), origin);
  const title = str(bot["title"]);
  if (title) template.title = title;
  const description = str(bot["description"]);
  if (description) template.description = description;
  const avatar = isRecord(bot["avatar"]) ? bot["avatar"] : {};
  if (str(avatar["emoji"])) template.emoji = str(avatar["emoji"]);
  const shape = isBotFaceShape(avatar["shape"]) ? avatar["shape"] : undefined;
  const ears = isBotFaceEars(avatar["ears"]) ? avatar["ears"] : undefined;
  const color = /^#[0-9a-f]{6}$/iu.test(str(avatar["color"])) ? str(avatar["color"]).toLowerCase() : undefined;
  if (shape || ears || color) template.avatar = { ...(shape ? { shape } : {}), ...(ears ? { ears } : {}), ...(color ? { color } : {}) };
  if (str(bot["model"])) template.model = str(bot["model"]);
  const voice = isRecord(bot["voice"]) ? bot["voice"] : undefined;
  const extras: NonNullable<BotTemplate["hui"]> = {
    ...(str(bot["handle"]) ? { handle: str(bot["handle"]) } : {}),
    ...(str(bot["thinking"]) ? { thinking: str(bot["thinking"]) } : {}),
    ...(str(bot["memoryModel"]) ? { memoryModel: str(bot["memoryModel"]) } : {}),
    ...(str(bot["memoryThinking"]) ? { memoryThinking: str(bot["memoryThinking"]) } : {}),
    ...(voice ? { voice: { ...(str(voice["language"]) ? { language: str(voice["language"]) } : {}), ...(str(voice["live"]) ? { live: str(voice["live"]) } : {}) } as BotVoice } : {}),
    disabledTools: Array.isArray(manifest["disabledTools"]) ? manifest["disabledTools"].map(str).filter(Boolean) : [],
    disabledSkills: Array.isArray(manifest["disabledSkills"]) ? manifest["disabledSkills"].map((skill) => isRecord(skill) ? str(skill["name"]) : str(skill)).filter(Boolean) : [],
  };
  template.hui = extras;
  const soul = findFile(files, BOT_EXPORT_FILES.soul);
  template.soul = (soul ? fileText(soul) ?? "" : "").trim();
  for (const skill of Array.isArray(manifest["skills"]) ? manifest["skills"].map(str).filter(Boolean) : []) {
    const file = findFile(files, `${BOT_EXPORT_FILES.skills}/${skill}/SKILL.md`);
    const text = file ? fileText(file) : undefined;
    if (text === undefined) {
      template.dropped.push(`Skill ${skill}: its SKILL.md is missing from the export.`);
      continue;
    }
    const parsed = skillFromFile(text, skill, template.dropped);
    if (parsed) template.skills.push(parsed);
  }
  for (const routine of Array.isArray(manifest["routines"]) ? manifest["routines"].filter(isRecord) : []) {
    const exact = schedule(routine["schedule"]);
    const routineName = str(routine["name"]);
    const prompt = str(routine["prompt"]);
    if (!routineName || !prompt) continue;
    const about = str(routine["description"]);
    template.routines.push({ name: routineName, prompt, ...(exact ? { automation: exact, schedule: scheduleLabel(exact) } : {}), ...(about ? { description: about } : {}) });
  }
  // memory.md: a header for people, a line, then the memory's view; a file without the line is the memory whole.
  const memory = findFile(files, BOT_EXPORT_FILES.memory);
  const text = memory ? fileText(memory) ?? "" : "";
  const separator = text.search(/^---[ \t]*$/mu);
  const remembered = (separator === -1 ? text : text.slice(separator).replace(/^---[ \t]*\n?/u, "")).trim();
  if (remembered && !/^<chat>\s*<\/chat>$/u.test(remembered)) template.memories.push({ name: `Memory of @${extras.handle ?? name} when it was exported`, text: remembered });
  else if (memory) template.notes.push("Its exported memory was empty.");
  return template;
}

/** An export's files, in the order a person opening it reads them. */
export function huiExportEntries(input: { manifest: BotExportManifest; soul?: string; skills: readonly { name: string; text: string }[]; memory?: string }): ZipEntry[] {
  const text = (value: string) => Buffer.from(value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return [
    { path: BOT_EXPORT_FILES.manifest, data: text(JSON.stringify(input.manifest, null, 2)) },
    ...(input.soul ? [{ path: BOT_EXPORT_FILES.soul, data: text(input.soul) }] : []),
    ...input.skills.map((skill) => ({ path: `${BOT_EXPORT_FILES.skills}/${skill.name}/SKILL.md`, data: text(skill.text) })),
    ...(input.memory ? [{ path: BOT_EXPORT_FILES.memory, data: text(input.memory) }] : []),
  ];
}
