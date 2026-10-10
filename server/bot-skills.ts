/**
 * A bot's own skills (HUI-18): `skills/<name>/SKILL.md` in its home folder, `BOTS_DIR/<id>` on the host that runs its chat.
 * Only that bot's chat loads them (`DurableHost.skillDirsFor`), beside the skills of its directory; its Tools tab lists
 * them with the rest, so each can be turned off like any other. Imports write them and exports read them, through this
 * port (a bot on a worker goes through its host: `worker/host-bots.ts`).
 *
 * Writes never follow a link: a `skills` folder or a skill folder that is a link is refused, and SKILL.md is replaced
 * atomically, owner-only, like SOUL.md.
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BOTS_DIR } from "./bots.ts";

/** The folder of a bot's own skills, inside its home. */
export const BOT_SKILLS_DIR = "skills";
/** A skill's folder name as PI's loader wants a skill's name. */
export const BOT_SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
/** The largest SKILL.md read back. */
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_SKILLS = 200;

/** One of a bot's own skills: its folder's name and its SKILL.md. */
export type BotOwnSkill = { name: string; text: string };

export type BotSkillFiles = {
  /** Writes each skill's SKILL.md, making the folders it needs (owner-only). */
  write(botId: string, skills: readonly BotOwnSkill[]): Promise<void>;
  /** The bot's own skills, by name; none without the folder. */
  read(botId: string): Promise<BotOwnSkill[]>;
};

/** Where a bot's own skills are, below its home folder. */
export function botSkillsDir(home: string): string {
  return join(home, BOT_SKILLS_DIR);
}

/** A folder that must be a real directory when it exists: a link (or a file) in its place is refused. */
async function realFolder(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Refusing to write skills through ${path}: it is not a folder.`);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

export function localBotSkills(botsDir: string = BOTS_DIR): BotSkillFiles {
  const home = (botId: string) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/u.test(botId)) throw new Error("Not a bot id.");
    return join(botsDir, botId);
  };
  return {
    async write(botId, skills) {
      const folder = botSkillsDir(home(botId));
      for (const skill of skills) if (!BOT_SKILL_NAME.test(skill.name)) throw new Error(`Not a skill name: ${JSON.stringify(skill.name)}.`);
      if (!skills.length) return;
      if (!await realFolder(home(botId))) await mkdir(home(botId), { recursive: true, mode: 0o700 });
      if (!await realFolder(folder)) await mkdir(folder, { mode: 0o700 });
      for (const skill of skills) {
        const directory = join(folder, skill.name);
        if (!await realFolder(directory)) await mkdir(directory, { mode: 0o700 });
        const file = join(directory, "SKILL.md");
        const temporary = `${file}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
        try {
          await writeFile(temporary, skill.text, { encoding: "utf8", mode: 0o600 });
          await rename(temporary, file);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => {});
          throw error;
        }
      }
    },

    async read(botId) {
      const folder = botSkillsDir(home(botId));
      if (!await realFolder(folder).catch(() => false)) return [];
      const skills: BotOwnSkill[] = [];
      for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_SKILLS)) {
        if (!entry.isDirectory() || !BOT_SKILL_NAME.test(entry.name)) continue;
        const file = join(folder, entry.name, "SKILL.md");
        const info = await lstat(file).catch(() => undefined);
        if (!info?.isFile() || info.size > MAX_SKILL_BYTES) continue;
        skills.push({ name: entry.name, text: await readFile(file, "utf8") });
      }
      return skills;
    },
  };
}
