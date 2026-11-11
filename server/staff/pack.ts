/**
 * The staff pack HUI ships in its own package (`staff/`): the versioned source of
 * a Chief of Staff bot's skills and default subagent routes, and the SOUL.md it
 * is seeded with. Reading it validates it once, so an upgrade never writes a
 * malformed pack into a bot's home: `pack.json` names the pack and its bot,
 * `SOUL.md` is the persona a new bot starts with, `routes.json` is the roles the
 * chief routes work to, and everything under `skills/` is copied into the bot's
 * own skill folder, untouched by every other chat. `hashText` is the per-file
 * identity the installer records, which is what lets an upgrade replace a file
 * nobody edited and keep one the operator did.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/** Relative to server/ in source and build/server/ in a packaged install, as `bundledSkillRoot` is. */
export const STAFF_PACK_ROOT = fileURLToPath(new URL("../../staff/", import.meta.url));

/** The PI reasoning levels a route may pin; Ultra stays the session's own choice. */
const ROUTE_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
/** A pack route as staff/routes.json holds it: no model, so it inherits the chief's. */
export type StaffRoute = { name: string; description: string; model: ""; thinking?: (typeof ROUTE_THINKING)[number] };
/** One text file of a skill, its path relative to the skill's folder. */
export type StaffSkillFile = { path: string; text: string };
/** One skill of the pack, by its folder name. */
export type StaffSkill = { name: string; text: string; files: StaffSkillFile[] };
/** The validated pack. */
export type StaffPack = {
  version: number;
  bot: { name: string; title: string; description: string };
  soul: string;
  routes: StaffRoute[];
  skills: StaffSkill[];
};

/** The largest text the reader accepts, so a broken package cannot fill a bot's home. */
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 400;
const MAX_DEPTH = 5;
const SOUL_LIMIT = 20_000;

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`staff/pack.json: ${field} must be a non-empty string.`);
  if (value.length > limit) throw new Error(`staff/pack.json: ${field} is longer than ${limit} characters.`);
  return value;
}

function routeNameIsValid(name: string): boolean {
  return name.length <= 40 && /^[\p{L}\p{N}_.-]+$/u.test(name);
}

function readRoutes(raw: unknown): StaffRoute[] {
  if (!Array.isArray(raw)) throw new Error("staff/routes.json must be an array of routes.");
  const routes = new Map<string, StaffRoute>();
  for (const item of raw) {
    if (!isRecord(item)) throw new Error("staff/routes.json holds an entry that is not an object.");
    const name = typeof item["name"] === "string" ? item["name"].trim() : "";
    const description = typeof item["description"] === "string" ? item["description"].replace(/\s+/gu, " ").trim() : "";
    const thinking = ROUTE_THINKING.find((level) => level === item["thinking"]);
    if (!routeNameIsValid(name)) throw new Error(`staff/routes.json: ${JSON.stringify(name)} is not a route name.`);
    if (routes.has(name)) throw new Error(`staff/routes.json names ${name} twice.`);
    if (description.length > 200) throw new Error(`staff/routes.json: ${name}'s description is longer than 200 characters.`);
    routes.set(name, { name, description, model: "", ...(thinking ? { thinking } : {}) });
  }
  return [...routes.values()];
}

/** The text files below one skill folder, sorted, with hidden files, links and binaries left out. */
async function skillFiles(directory: string, prefix: string, depth: number): Promise<StaffSkillFile[]> {
  if (depth > MAX_DEPTH) throw new Error(`staff/skills: ${prefix || "a skill"} nests deeper than ${MAX_DEPTH} folders.`);
  const files: StaffSkillFile[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await skillFiles(full, path, depth + 1));
      continue;
    }
    if (path === "SKILL.md") continue;
    const info = await stat(full);
    if (info.size > MAX_FILE_BYTES) throw new Error(`staff/skills: ${path} is larger than ${MAX_FILE_BYTES / 1024} KB.`);
    const text = await readFile(full, "utf8");
    if (text.includes("\u0000")) continue;
    files.push({ path, text });
  }
  if (files.length > MAX_FILES) throw new Error(`staff/skills: a skill holds more than ${MAX_FILES} files.`);
  return files;
}

async function readSkills(root: string): Promise<StaffSkill[]> {
  const folder = join(root, "skills");
  const skills: StaffSkill[] = [];
  const entries = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === "ENOENT") throw new Error("staff/skills holds no skills.");
    throw error;
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(entry.name)) throw new Error(`staff/skills: ${entry.name} is not a skill name.`);
    const file = join(folder, entry.name, "SKILL.md");
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`staff/skills/${entry.name} has no SKILL.md.`);
    if (info.size > MAX_FILE_BYTES) throw new Error(`staff/skills/${entry.name}/SKILL.md is larger than ${MAX_FILE_BYTES / 1024} KB.`);
    skills.push({
      name: entry.name,
      text: await readFile(file, "utf8"),
      files: await skillFiles(join(folder, entry.name), "", 0),
    });
  }
  if (!skills.length) throw new Error("staff/skills holds no skills.");
  return skills;
}

/** Every file of these skills that the installer tracks, its path relative to the pack root. */
export function packFilePaths(skills: readonly StaffSkill[]): { path: string; text: string }[] {
  return skills.flatMap((skill) => [
    { path: `skills/${skill.name}/SKILL.md`, text: skill.text },
    ...skill.files.map((file) => ({ path: `skills/${skill.name}/${file.path}`, text: file.text })),
  ]);
}

/** Reads and validates the pack; `root` is only for tests. */
export async function readStaffPack(root: string = STAFF_PACK_ROOT): Promise<StaffPack> {
  const manifest: unknown = JSON.parse(await readFile(join(root, "pack.json"), "utf8"));
  if (!isRecord(manifest)) throw new Error("staff/pack.json must be an object.");
  const version = manifest["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error("staff/pack.json: version must be a positive integer.");
  const bot = manifest["bot"];
  if (!isRecord(bot)) throw new Error("staff/pack.json: bot must be an object.");
  const soul = await readFile(join(root, "SOUL.md"), "utf8");
  if (!soul.trim()) throw new Error("staff/SOUL.md is empty.");
  if (soul.length > SOUL_LIMIT) throw new Error(`staff/SOUL.md is longer than ${SOUL_LIMIT} characters.`);
  const routes: unknown = JSON.parse(await readFile(join(root, "routes.json"), "utf8"));
  return {
    version,
    bot: {
      name: text(bot["name"], "bot.name", 80),
      title: text(bot["title"], "bot.title", 80),
      description: text(bot["description"], "bot.description", 200),
    },
    soul,
    routes: readRoutes(routes),
    skills: await readSkills(root),
  };
}

/** The path of a skill's file inside the pack, which is also how the installer records it. */
export function packSkillPath(skill: string, file = ""): string {
  return posix.join("skills", skill, file);
}
