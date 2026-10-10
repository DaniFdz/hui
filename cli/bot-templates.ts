/**
 * `hui bot import` and `hui bot export`: bots from other platforms' templates, and HUI's own export, through the
 * running gateway like every `hui bot` command. Import sends the source (a file, a folder, a Grok Bot link or stdin) to
 * the gateway's preview, prints all of it (imported text is untrusted), asks before creating (`--yes` skips that) and
 * creates exactly what the preview showed. Export saves the bot's `.hui-bot.zip`.
 */
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { BOT_TEMPLATE_FORMATS, BOT_TEMPLATE_LIMITS, botExportFileName, type BotImportPreview, type BotImportResult, type BotImportSource } from "../shared/bot-templates.ts";
import type { BotView } from "../shared/bots.ts";
import { formatSchedule, GatewayError, request, type BotFlags, type BotIO } from "./bots.ts";

/** Folders a workspace may hold that never belong to a bot. */
const SKIPPED = new Set([".git", "node_modules", ".DS_Store", "__MACOSX"]);
const PREVIEW_TIMEOUT_MS = 90_000;
const IMPORT_TIMEOUT_MS = 120_000;

/** A folder's files for an import, by their paths below the folder's own name; bounded like the gateway's limits. */
export async function folderSource(dir: string): Promise<BotImportSource> {
  const files: { path: string; data: string }[] = [];
  let total = 0;
  const walk = async (folder: string): Promise<void> => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const data = await readFile(path);
        total += data.length;
        if (files.length >= BOT_TEMPLATE_LIMITS.files) throw new Error(`${dir} holds more than ${BOT_TEMPLATE_LIMITS.files} files; HUI imports at most that.`);
        if (total > BOT_TEMPLATE_LIMITS.totalBytes) throw new Error(`${dir} holds more than ${BOT_TEMPLATE_LIMITS.totalBytes / 1024 / 1024} MB; HUI imports at most that.`);
        files.push({ path: `${basename(dir)}/${relative(dir, path).split("\\").join("/")}`, data: data.toString("base64") });
      }
    }
  };
  await walk(dir);
  if (!files.length) throw new Error(`${dir} is empty.`);
  return { kind: "files", files };
}

/** What `hui bot import` was given: stdin (`-`), a link, a folder or a file. */
export async function importSource(operand: string, io: BotIO): Promise<BotImportSource> {
  if (operand === "-") return { kind: "text", text: await io.readStdin() };
  if (/^https?:\/\//iu.test(operand)) return { kind: "url", url: operand };
  const path = resolve(io.cwd, operand);
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new Error(`No such file or folder: ${operand}`);
  if (info.isDirectory()) return folderSource(path);
  if (!info.isFile()) throw new Error(`${operand} is not a file or a folder.`);
  if (info.size > BOT_TEMPLATE_LIMITS.fileBytes) throw new Error(`${operand} is larger than ${BOT_TEMPLATE_LIMITS.fileBytes / 1024 / 1024} MB.`);
  return { kind: "file", name: basename(path), data: (await readFile(path)).toString("base64") };
}

const indent = (text: string, prefix = "  ") => text.split("\n").map((line) => line ? `${prefix}${line}` : "").join("\n");
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The whole preview, as text: every imported text in full, since it is untrusted. */
export function formatImportPreview(preview: BotImportPreview): string {
  const { bot, template } = preview;
  const from = [BOT_TEMPLATE_FORMATS[template.format], template.author ? `by ${template.author}` : "", template.origin ?? ""].filter(Boolean).join(" ");
  const lines = [
    `Import ${bot.emoji ? `${bot.emoji} ` : ""}${bot.name} (@${bot.handle})${bot.title ? `, ${bot.title}` : ""} from ${from}${bot.worker ? `, on ${bot.worker.name}` : ""}.`,
    ...(bot.description ? [`Description: ${bot.description}`] : []),
    `Model: ${preview.model ?? "the gateway's default"}${preview.thinking ? ` · thinking ${preview.thinking}` : ""}${preview.utilityModel ? ` · utility model ${preview.utilityModel}` : ""}`,
    "",
    preview.soul
      ? `SOUL.md (${preview.soul.length.toLocaleString("en-US")} characters${preview.memories.total ? `, with ${preview.memories.included} of ${plural(preview.memories.total, "memory", "memories")}` : ""}):\n${indent(preview.soul)}`
      : "No persona: it starts with its first conversation and writes its own SOUL.md.",
  ];
  if (preview.opener) lines.push("", `First message (it sends this in a first turn HUI starts):\n${indent(preview.opener)}`);
  if (preview.skills.length) {
    lines.push("", `Skills, its own and on (only this bot loads them; turn any off with hui bot skills):`);
    for (const skill of preview.skills) lines.push(`  ${skill.name}${skill.original !== skill.name ? ` (from ${skill.original})` : ""}: ${skill.description}`, indent(skill.content, "    "));
  }
  if (preview.routines.length) {
    lines.push("", `Routines, created disabled:`);
    for (const routine of preview.routines) {
      lines.push(`  ${routine.name} · ${formatSchedule(routine.schedule)}${routine.guessed ? ` (assumed${routine.scheduleText ? ` from "${routine.scheduleText}"` : ""}: check it)` : ""}`, indent(routine.prompt, "    "));
    }
  }
  if (preview.integrations.length) {
    lines.push("", "Integrations:", ...preview.integrations.map((integration) => integration.tool ? `  ${integration.name} → ${integration.tool.name}` : `  ${integration.name}: missing, HUI has no tool for it`));
  }
  if (preview.disabledTools.length) lines.push("", `Tools turned off: ${preview.disabledTools.join(", ")}.`);
  if (preview.disabledSkills.length) lines.push(`Skills turned off: ${preview.disabledSkills.join(", ")}.`);
  if (preview.dropped.length) lines.push("", "Left out:", ...preview.dropped.map((line) => `  - ${line}`));
  if (preview.notes.length) lines.push("", "Notes:", ...preview.notes.map((line) => `  - ${line}`));
  lines.push("", "Imported text is untrusted: read it before you create the bot. An import turns nothing on beyond a new bot's defaults.");
  return lines.join("\n");
}

type PreviewRequest = { source: BotImportSource; pick?: string; worker?: string };

/** `hui bot import <file|folder|url|->`: exit 0 once created, 1 when declined. */
export async function importCommand(base: string, operand: string, flags: BotFlags, io: BotIO): Promise<number> {
  const asked: PreviewRequest = { source: await importSource(operand, io), ...(flags.worker !== undefined ? { worker: flags.worker.trim() } : {}) };
  const preview = (body: PreviewRequest) => request<BotImportPreview>(base, "/__hui/bots/import/preview", { method: "POST", body, timeoutMs: PREVIEW_TIMEOUT_MS });
  let shown = await preview(asked);
  if (shown.candidates && shown.candidates.length > 1) {
    const list = shown.candidates.map((candidate, index) => `  ${index + 1}. ${candidate.name}${candidate.title ? `, ${candidate.title}` : ""} (--agent ${candidate.key})`).join("\n");
    let key = flags.agent === undefined ? undefined
      : shown.candidates.find((candidate) => candidate.key === flags.agent || candidate.name.toLowerCase() === flags.agent!.toLowerCase())?.key;
    if (flags.agent !== undefined && key === undefined) throw new Error(`No agent ${flags.agent} in ${operand}. Its agents:\n${list}`);
    if (key === undefined) {
      if (!io.interactive || flags.yes) throw new Error(`${operand} holds ${shown.candidates.length} agents; choose one with --agent:\n${list}`);
      const answer = (await io.ask(`${operand} holds ${shown.candidates.length} agents:\n${list}\nWhich one? [1-${shown.candidates.length}] `)).trim();
      key = shown.candidates[Number(answer) - 1]?.key;
      if (key === undefined) {
        io.out("Nothing was imported.\n");
        return 1;
      }
    }
    if (key !== shown.pick) shown = await preview({ ...asked, pick: key });
  } else if (flags.agent !== undefined) {
    throw new Error(`${operand} holds one bot; --agent only picks among several.`);
  }
  if (!flags.json) io.out(`${formatImportPreview(shown)}\n`);
  if (!flags.yes) {
    if (!io.interactive) throw new Error(`hui bot import cannot ask here (no terminal): add --yes to create @${shown.bot.handle}.`);
    if (!/^\s*(y|yes)\s*$/iu.test(await io.ask(`Create @${shown.bot.handle}? [y/N] `))) {
      io.out("Nothing was imported.\n");
      return 1;
    }
  }
  const result = await request<BotImportResult>(base, "/__hui/bots/import", {
    method: "POST", body: { template: shown.template, ...(asked.worker ? { worker: asked.worker } : {}) }, timeoutMs: IMPORT_TIMEOUT_MS,
  });
  if (flags.json) {
    io.out(`${JSON.stringify({ preview: shown, ...result })}\n`);
    return 0;
  }
  const bot = result.bot;
  const parts = [
    ...(result.skills.length ? [plural(result.skills.length, "skill")] : []),
    ...(result.routines ? [`${plural(result.routines, "routine")} (disabled: turn them on with hui bot routine list ${bot.handle} and Automations)`] : []),
  ];
  io.out(`Imported @${bot.handle} (${bot.name})${bot.worker ? ` on ${bot.worker.name}` : ""}${parts.length ? ` with ${parts.join(" and ")}` : ""}. ${result.opener ? "It is sending its first message: " : "Talk to it with "}hui bot chat ${bot.handle}.\n`);
  for (const warning of result.warnings) io.err(`warning: ${warning}\n`);
  return 0;
}

/** `hui bot export <bot>`: saves its zip; refuses to replace a file unless `--yes`. */
export async function exportCommand(base: string, bot: BotView, flags: BotFlags, io: BotIO): Promise<number> {
  const response = await fetch(new URL(`/__hui/bots/${encodeURIComponent(bot.id)}/export${flags.memory ? "?memory=1" : ""}`, base), {
    headers: { "x-hui": "1" }, signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS), redirect: "error",
  });
  if (!response.ok) {
    const text = await response.text();
    let message: string | undefined;
    try { message = (JSON.parse(text) as { error?: string }).error; } catch { message = text.trim() || undefined; }
    throw new GatewayError(message ?? `HUI returned HTTP ${response.status}.`, response.status);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const file = resolve(io.cwd, flags.out ?? botExportFileName(bot.handle));
  if (!flags.yes && await lstat(file).then(() => true, () => false)) throw new Error(`${file} exists: choose another --out, or add --yes to replace it.`);
  await writeFile(file, data, { mode: 0o600 });
  const size = data.length < 1024 ? `${data.length} B` : `${Math.round(data.length / 1024)} KB`;
  io.out(`${flags.json ? JSON.stringify({ id: bot.id, handle: bot.handle, file, bytes: data.length, memory: flags.memory === true }) : `Exported @${bot.handle} to ${file} (${size})${flags.memory ? ", with its memory" : ""}. Import it with hui bot import ${basename(file)}.`}\n`);
  return 0;
}
