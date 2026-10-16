/**
 * A bot's export as a template someone else imports (HUI-18; SPEC.md, "Bot exports are templates, reviewed for
 * personal information"): `bot.json` version 2 (`BotExportManifest`), the review the gateway answers before a download
 * (`BotExportReview`: the bot's parts after its automatic cleanup and what the utility model would change in them), and
 * `buildExport`, which turns a review and the operator's picks into the files the zip holds. Pure and shared, so the
 * export dialog shows exactly the files the gateway then saves. See docs/api.md#importing-and-exporting-bots.
 */
import { handleFromName, type BotFaceEars, type BotFaceShape, type BotVoice } from "./bots.ts";
import type { BotTriggerFilter } from "./bot-triggers.ts";

export const BOT_EXPORT_FORMAT = "hui-bot";
/** 2: a template, reviewed for personal information. A version 1 export (an exact copy, memory included) still imports. */
export const BOT_EXPORT_VERSION = 2;
/** The zip's files: `bot.json`, `SOUL.md`, each own skill's folder under `skills/`; `memory.md` only in version 1. */
export const BOT_EXPORT_FILES = { manifest: "bot.json", soul: "SOUL.md", memory: "memory.md", skills: "skills" } as const;

/** A routine's schedule in a template: a cron expression carries no time zone, so it runs in the importer's. */
export type BotExportSchedule = { kind: "every"; everyMs: number } | { kind: "cron"; expression: string };

/** A point the template leaves to its new owner, which the imported bot goes through in its first chat. */
export type BotOpenPoint = {
  /** ask: they give their own value where an `[ask: …]` mark stands; confirm: they agree to what is written. */
  kind: "ask" | "confirm";
  /** Where it is: `SOUL.md`, `Skill review: SKILL.md`, `Routine “Digest”`, `Trigger “Reviews”`. */
  where: string;
  question: string;
  /** The passage a confirm point is about, shortened. */
  excerpt?: string;
  /** Only the operator can settle it (a trigger, in the Routines tab): the bot tells them where. */
  operator?: true;
};

/** A trigger as a template carries it: never its URL or token, and it starts disabled. */
export type BotTemplateTrigger = { name: string; filter: BotTriggerFilter; prompt?: string; cooldownSeconds: number };

/** `bot.json`, version 2: what of a bot travels once its review is done. No handle, path, date or memory. */
export type BotExportManifest = {
  format: typeof BOT_EXPORT_FORMAT;
  version: typeof BOT_EXPORT_VERSION;
  bot: {
    name: string;
    title?: string;
    description?: string;
    avatar?: { emoji?: string; shape?: BotFaceShape; ears?: BotFaceEars; color?: string };
    /** Bare model ids: the provider stays behind. */
    model?: string;
    thinking?: string;
    memoryModel?: string;
    memoryThinking?: string;
    voice?: BotVoice;
  };
  routines: { name: string; description?: string; prompt: string; schedule: BotExportSchedule; timeoutSeconds?: number }[];
  triggers: BotTemplateTrigger[];
  /** Built-in tools it turned off. */
  disabledTools: string[];
  /** Its own skills it turned off, by name. */
  disabledSkills: string[];
  /** Its own skills: each `skills/<name>/` with SKILL.md and the files beside it. */
  skills: string[];
  open: BotOpenPoint[];
  /** What it needs to work, one line each. */
  needs: string[];
};

/* ── the review ───────────────────────────────────────────────────────── */

/** keep: travels as written; remove: never leaves; ask: the new owner gives theirs; confirm: they agree to it first. */
export const BOT_EXPORT_GROUPS = ["keep", "remove", "ask", "confirm"] as const;
export type BotExportGroup = (typeof BOT_EXPORT_GROUPS)[number];

/** One text of a part: a profile field, SOUL.md, a skill's file, a routine's or a trigger's field. */
export type BotExportField = { key: string; text: string };

/** A part of the bot: text that changes in place (Markdown, its profile, prompts) or a script, kept whole or left out. */
export type BotExportPart = {
  /** `profile`, `SOUL.md`, `skills/<name>/<path>` (its path in the zip), `routines/<n>`, `triggers/<n>`. */
  id: string;
  label: string;
  kind: "text" | "script";
  /** Its texts after the automatic cleanup; a script's as it is, never rewritten. */
  fields: BotExportField[];
  /** The utility model read it; else `unread` says why. */
  read: boolean;
  unread?: string;
};

/** A passage the reviewer would change. A removed or asked one changes wherever it appears in the bot. */
export type BotExportChange = {
  id: string;
  /** The part it was found in. */
  part: string;
  /** Exactly as it stands in the part's cleaned text. */
  quote: string;
  /** The reviewer's group: what happens unless the operator picks another. */
  group: Exclude<BotExportGroup, "keep">;
  reason: string;
  /** What a removed passage becomes; may be empty. */
  replacement: string;
  /** What the new owner gives, should it be asked: it becomes `[ask: <label>]`. Never the passage itself. */
  label: string;
  /** What it asks the new owner in the reviewer's group (empty for a removed one). */
  question: string;
};

/** A script the cleanup or the reviewer found something in: it travels as it is, travels for the new owner to confirm,
 * or stays behind. */
export type BotExportFileChange = { id: string; part: string; group: "keep" | "remove" | "confirm"; reasons: string[]; question: string };

/** What the automatic cleanup changed in a part's field (or found in a script): listed, never undone. */
export type BotExportCleanup = { part: string; field: string; kind: string; sample: string; count: number };

/** What of the bot travels that no review reads: index-aligned with its `routines/<n>` and `triggers/<n>` parts. */
export type BotExportMeta = {
  avatar?: BotExportManifest["bot"]["avatar"];
  model?: string;
  thinking?: string;
  memoryModel?: string;
  memoryThinking?: string;
  voice?: BotVoice;
  routines: { schedule: BotExportSchedule; timeoutSeconds?: number }[];
  /** Each trigger's filter; a `match` value is its part's `match` field. */
  triggers: { filter: BotTriggerFilter; cooldownSeconds: number }[];
  disabledTools: string[];
  disabledSkills: string[];
  skills: string[];
};

/** `POST /__hui/bots/:id/export/review`: what the export would hold, and what the cleanup and the reviewer did to it. */
export type BotExportReview = {
  /** `POST /__hui/bots/:id/export` names it; the gateway keeps each bot's latest review until it restarts. */
  id: string;
  botId: string;
  name: string;
  /** The utility model that read it; absent when none did. */
  model?: string;
  /** Why the model read nothing, or not everything. */
  warning?: string;
  parts: BotExportPart[];
  cleanup: BotExportCleanup[];
  changes: BotExportChange[];
  files: BotExportFileChange[];
  needs: { id: string; text: string }[];
  /** What stays behind and why, one line each. */
  leftOut: string[];
  meta: BotExportMeta;
};

/** `POST /__hui/bots/:id/export`: the review, and the group of each change, script or need the operator moved. */
export type BotExportRequest = { review: string; picks: Record<string, BotExportGroup> };

/** What `buildExport` makes: the bot's final name, the zip's file name, its files in order and its open points. */
export type BotExportBuild = { name: string; fileName: string; files: { path: string; text: string }[]; open: BotOpenPoint[] };

/** The mark an asked passage becomes. */
export const askMark = (label: string): string => `[ask: ${label}]`;

/** What a change asks the new owner in the group picked: the reviewer's question in its own group, else one that fits
 * (an asked passage is never quoted: it is the owner's; a confirmed one travels anyway). */
export function changeQuestion(change: Pick<BotExportChange, "group" | "question" | "label" | "quote">, picked: "ask" | "confirm"): string {
  if (picked === change.group) return change.question;
  return picked === "ask" ? `What should stand for ${askMark(change.label)}?` : `Keep this as it is: “${oneLine(change.quote, 80)}”?`;
}

/**
 * `text` with each quote replaced, every time it appears. Where two overlap the longer wins and the other is left out
 * there; it is one pass over the text as it was, so a replacement is never matched again.
 */
export function applyChanges(text: string, changes: readonly { quote: string; replacement: string }[]): string {
  const ranges: { start: number; end: number; replacement: string }[] = [];
  for (const { quote, replacement } of changes) {
    if (!quote) continue;
    for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + quote.length)) ranges.push({ start: at, end: at + quote.length, replacement });
  }
  // ponytail: quadratic overlap check; fine for a review's tens of passages.
  const taken: typeof ranges = [];
  for (const range of ranges.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
    if (!taken.some((other) => range.start < other.end && other.start < range.end)) taken.push(range);
  }
  let result = "";
  let at = 0;
  for (const range of taken.sort((a, b) => a.start - b.start)) {
    result += text.slice(at, range.start) + range.replacement;
    at = range.end;
  }
  return result + text.slice(at);
}

/** The zip's name, from the bot's final name: `{{user}}` (and its `'s`) left out. */
export function botExportFileName(name: string): string {
  return `${handleFromName(name.replace(/\{\{\s*user\s*\}\}(?:['’]s)?/giu, ""))}.hui-bot.zip`;
}

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

/** A review and the operator's picks as the files of the zip, in the order a person opening it reads them. */
export function buildExport(review: BotExportReview, picks: Readonly<Record<string, BotExportGroup>> = {}): BotExportBuild {
  const group = (id: string, fallback: BotExportGroup): BotExportGroup => picks[id] ?? fallback;
  const replacements = review.changes.flatMap((change) => {
    const picked = group(change.id, change.group);
    return picked === "remove" ? [{ quote: change.quote, replacement: change.replacement }]
      : picked === "ask" ? [{ quote: change.quote, replacement: askMark(change.label) }]
      : [];
  });
  const parts = new Map(review.parts.map((part) => [part.id, part]));
  const fields = (id: string): Record<string, string> => {
    const part = parts.get(id);
    return Object.fromEntries((part?.fields ?? []).map((field) => [field.key, part!.kind === "text" ? applyChanges(field.text, replacements) : field.text]));
  };
  // Where an open point is: a routine or a trigger by its name as it travels, so a removed passage never names it.
  const where = (id: string) => id.startsWith("routines/") ? `Routine “${fields(id)["name"] ?? ""}”` : id.startsWith("triggers/") ? `Trigger “${fields(id)["name"] ?? ""}”` : parts.get(id)?.label ?? id;
  const onlyOperator = (id: string) => id.startsWith("triggers/") ? { operator: true as const } : {};

  const open: BotOpenPoint[] = [];
  for (const change of review.changes) {
    const picked = group(change.id, change.group);
    if (picked === "ask") open.push({ kind: "ask", where: where(change.part), question: changeQuestion(change, "ask"), ...onlyOperator(change.part) });
    if (picked === "confirm") open.push({ kind: "confirm", where: where(change.part), question: changeQuestion(change, "confirm"), excerpt: oneLine(change.quote, 160), ...onlyOperator(change.part) });
  }
  for (const file of review.files) {
    if (group(file.id, file.group) === "confirm") open.push({ kind: "confirm", where: where(file.part), question: file.question });
  }

  const { meta } = review;
  const profile = fields("profile");
  const name = profile["name"] || review.name;
  const routines = meta.routines.map((routine, index) => {
    const text = fields(`routines/${index}`);
    return {
      name: text["name"] || `Routine ${index + 1}`, ...(text["description"] ? { description: text["description"] } : {}), prompt: text["prompt"] ?? "",
      schedule: routine.schedule, ...(routine.timeoutSeconds ? { timeoutSeconds: routine.timeoutSeconds } : {}),
    };
  });
  const triggers = meta.triggers.map((trigger, index) => {
    const id = `triggers/${index}`;
    const text = fields(id);
    const original = parts.get(id)?.fields.find((field) => field.key === "match")?.text;
    const { match, ...filter } = trigger.filter;
    // A value the cleanup or a removed or asked passage touched would never match: its owner sets a new one.
    const touched = match !== undefined && (text["match"] !== original || review.cleanup.some((hit) => hit.part === id && hit.field === "match"));
    if (touched) {
      open.push({ kind: "ask", where: where(id), question: `Which ${match.field || "event"} should wake it? Its filter matched a value of the previous owner's: set yours in the Routines tab.`, operator: true });
    }
    return {
      name: text["name"] || `Trigger ${index + 1}`,
      filter: match && !touched ? { ...filter, match: { ...match, value: text["match"] ?? match.value } } : filter,
      ...(text["prompt"] ? { prompt: text["prompt"] } : {}),
      cooldownSeconds: trigger.cooldownSeconds,
    };
  });
  const manifest: BotExportManifest = {
    format: BOT_EXPORT_FORMAT,
    version: BOT_EXPORT_VERSION,
    bot: {
      name,
      ...(profile["title"] ? { title: profile["title"] } : {}),
      ...(profile["description"] ? { description: profile["description"] } : {}),
      ...(meta.avatar ? { avatar: meta.avatar } : {}),
      ...(meta.model ? { model: meta.model } : {}),
      ...(meta.thinking ? { thinking: meta.thinking } : {}),
      ...(meta.memoryModel ? { memoryModel: meta.memoryModel } : {}),
      ...(meta.memoryThinking ? { memoryThinking: meta.memoryThinking } : {}),
      ...(meta.voice ? { voice: meta.voice } : {}),
    },
    routines,
    triggers,
    disabledTools: meta.disabledTools,
    disabledSkills: meta.disabledSkills,
    skills: meta.skills,
    open,
    needs: review.needs.filter((need) => group(need.id, "keep") !== "remove").map((need) => need.text),
  };

  const ending = (text: string) => text.endsWith("\n") ? text : `${text}\n`;
  const files: BotExportBuild["files"] = [{ path: BOT_EXPORT_FILES.manifest, text: ending(JSON.stringify(manifest, null, 2)) }];
  for (const part of review.parts) {
    if (part.id !== BOT_EXPORT_FILES.soul && !part.id.startsWith(`${BOT_EXPORT_FILES.skills}/`)) continue;
    const change = review.files.find((file) => file.part === part.id);
    if (change && group(change.id, change.group) === "remove") continue;
    files.push({ path: part.id, text: ending(fields(part.id)["text"] ?? "") });
  }
  return { name, fileName: botExportFileName(name), files, open };
}
