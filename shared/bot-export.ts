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
  routines: { name: string; description?: string; prompt: string; schedule: BotExportSchedule }[];
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
  routines: { schedule: BotExportSchedule }[];
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

/** What `buildExport` makes: the bot's final name, the zip's file name, its files in order, its open points, and what each
 * change picked comes to in them (what a passage becomes, what it asks), for the dialog to say. */
export type BotExportBuild = {
  name: string;
  fileName: string;
  files: { path: string; text: string }[];
  open: BotOpenPoint[];
  outcomes: Record<string, { replacement?: string; question?: string }>;
};

/** The mark an asked passage becomes. */
export const askMark = (label: string): string => `[ask: ${label}]`;

/** What a change asks the new owner in the group picked: the reviewer's question in its own group, else one that fits,
 * from its label and its excerpt as they travel (an asked passage is never quoted: it is the owner's). */
export function changeQuestion(change: Pick<BotExportChange, "group" | "question">, picked: "ask" | "confirm", words: { label: string; excerpt: string }): string {
  if (picked === change.group && change.question) return change.question;
  return picked === "ask" ? `What should stand for ${askMark(words.label)}?` : `Keep this as it is: “${words.excerpt}”?`;
}

/**
 * `text` with each quote replaced, every time it appears, in one pass over the text as it was, so a replacement is never
 * matched again. Quotes that overlap become one span, all of it replaced by the longer one's replacement: no part of
 * either is left behind.
 */
export function applyChanges(text: string, changes: readonly { quote: string; replacement: string }[]): string {
  const ranges: { start: number; end: number; replacement: string }[] = [];
  for (const { quote, replacement } of changes) {
    if (!quote) continue;
    for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + quote.length)) ranges.push({ start: at, end: at + quote.length, replacement });
  }
  const spans: { start: number; end: number; replacement: string; longest: number }[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = spans.at(-1);
    if (!last || range.start >= last.end) {
      spans.push({ ...range, longest: range.end - range.start });
      continue;
    }
    if (range.end - range.start > last.longest) Object.assign(last, { replacement: range.replacement, longest: range.end - range.start });
    last.end = Math.max(last.end, range.end);
  }
  let result = "";
  let at = 0;
  for (const span of spans) {
    result += text.slice(at, span.start) + span.replacement;
    at = span.end;
  }
  return result + text.slice(at);
}

/** The zip's name, from the bot's final name: `{{user}}` (and its `'s`) left out. */
export function botExportFileName(name: string): string {
  return `${handleFromName(name.replace(/\{\{\s*user\s*\}\}(?:['’]s)?/giu, ""))}.hui-bot.zip`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

/** A review and the operator's picks as the files of the zip, in the order a person opening it reads them. */
export function buildExport(review: BotExportReview, picks: Readonly<Record<string, BotExportGroup>> = {}): BotExportBuild {
  const group = (id: string, fallback: BotExportGroup): BotExportGroup => picks[id] ?? fallback;
  // What the reviewer wrote travels too (replacements, labels, questions, needs): none of it may repeat a passage the
  // picks remove or ask, in any case. A label or replacement that would gives way to a plain one; other text is scrubbed.
  const hidden = review.changes.filter((change) => ["remove", "ask"].includes(group(change.id, change.group))).map((change) => change.quote);
  // Any case and any spacing: a reviewer writes "Pat Doe" for a passage that wraps a line.
  const hiddenPattern = hidden.length ? new RegExp([...hidden].sort((a, b) => b.length - a.length).map((quote) => escape(quote.trim()).replace(/\s+/gu, "\\s+")).join("|"), "giu") : undefined;
  const leaks = (text: string) => hiddenPattern !== undefined && text.search(hiddenPattern) !== -1;
  const scrub = (text: string) => hiddenPattern ? text.replace(hiddenPattern, "[removed]") : text;
  // A label that would repeat a passage gives way to a numbered plain one, so the new owner can tell them apart.
  let plain = 0;
  const labels = new Map(review.changes.map((change) => [change.id, leaks(change.label) ? `your own value${(plain += 1) > 1 ? ` ${plain}` : ""}` : change.label]));
  const label = (change: BotExportChange) => labels.get(change.id) ?? change.label;
  const replacements = review.changes.flatMap((change) => {
    const picked = group(change.id, change.group);
    return picked === "remove" ? [{ quote: change.quote, replacement: leaks(change.replacement) ? "" : change.replacement }]
      : picked === "ask" ? [{ quote: change.quote, replacement: askMark(label(change)) }]
      : [];
  });
  /** Text the reviewer wrote, as it travels: the picks' replacements (a passage taken out shows as `[removed]`), then a scrub
   * of what they missed (another case). */
  const marks = replacements.map((pair) => ({ quote: pair.quote, replacement: pair.replacement || "[removed]" }));
  const tidy = (text: string) => scrub(applyChanges(text, marks));
  const parts = new Map(review.parts.map((part) => [part.id, part]));
  const fields = (id: string): Record<string, string> => {
    const part = parts.get(id);
    return Object.fromEntries((part?.fields ?? []).map((field) => [field.key, part!.kind === "text" ? applyChanges(field.text, replacements) : field.text]));
  };
  // Where an open point is: a routine or a trigger by its name as it travels, so a removed passage never names it.
  const where = (id: string) => id.startsWith("routines/") ? `Routine “${fields(id)["name"] ?? ""}”` : id.startsWith("triggers/") ? `Trigger “${fields(id)["name"] ?? ""}”` : parts.get(id)?.label ?? id;
  const onlyOperator = (id: string) => id.startsWith("triggers/") ? { operator: true as const } : {};

  // A passage cut short or squeezed onto one line could slip past the scrub: it is tidied first, then shortened. Where
  // two quotes overlap the longer's replacement takes the span, so the other's open point may name a mark that isn't there.
  const open: BotOpenPoint[] = [];
  const outcomes: BotExportBuild["outcomes"] = {};
  for (const change of review.changes) {
    const picked = group(change.id, change.group);
    const replacement = replacements.find((pair) => pair.quote === change.quote)?.replacement;
    if (picked === "remove") outcomes[change.id] = { replacement: replacement ?? "" };
    if (picked !== "ask" && picked !== "confirm") continue;
    const excerpt = oneLine(tidy(change.quote), 160);
    const question = tidy(changeQuestion(change, picked, { label: label(change), excerpt: oneLine(excerpt, 80) }));
    outcomes[change.id] = { ...(picked === "ask" ? { replacement: replacement ?? askMark(label(change)) } : {}), question };
    open.push({ kind: picked, where: tidy(where(change.part)), question, ...(picked === "confirm" ? { excerpt } : {}), ...onlyOperator(change.part) });
  }
  for (const file of review.files) {
    if (group(file.id, file.group) === "confirm") open.push({ kind: "confirm", where: tidy(where(file.part)), question: tidy(file.question) });
  }

  const { meta } = review;
  const profile = fields("profile");
  // Never the name as it was: a name the picks removed whole becomes a plain one.
  const name = profile["name"]?.trim() || "Bot";
  const routines = meta.routines.map((routine, index) => {
    const text = fields(`routines/${index}`);
    return { name: text["name"] || `Routine ${index + 1}`, ...(text["description"] ? { description: text["description"] } : {}), prompt: text["prompt"] ?? "", schedule: routine.schedule };
  });
  const triggers = meta.triggers.map((trigger, index) => {
    const id = `triggers/${index}`;
    const text = fields(id);
    const original = parts.get(id)?.fields.find((field) => field.key === "match")?.text;
    const { match, ...filter } = trigger.filter;
    // A value the cleanup or a removed or asked passage touched would never match: its owner sets a new one.
    const touched = match !== undefined && (text["match"] !== original || review.cleanup.some((hit) => hit.part === id && hit.field === "match"));
    if (touched) {
      open.push({ kind: "ask", where: tidy(where(id)), question: `Which ${match.field || "event"} should wake it? Its filter matched a value of the previous owner's: set yours in the Routines tab.`, operator: true });
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
    needs: review.needs.filter((need) => group(need.id, "keep") !== "remove").map((need) => tidy(need.text)),
  };

  const ending = (text: string) => text.endsWith("\n") ? text : `${text}\n`;
  const files: BotExportBuild["files"] = [{ path: BOT_EXPORT_FILES.manifest, text: ending(JSON.stringify(manifest, null, 2)) }];
  for (const part of review.parts) {
    if (part.id !== BOT_EXPORT_FILES.soul && !part.id.startsWith(`${BOT_EXPORT_FILES.skills}/`)) continue;
    const change = review.files.find((file) => file.part === part.id);
    if (change && group(change.id, change.group) === "remove") continue;
    files.push({ path: part.id, text: ending(fields(part.id)["text"] ?? "") });
  }
  return { name, fileName: botExportFileName(name), files, open, outcomes };
}
