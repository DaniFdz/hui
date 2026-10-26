/**
 * `hui doctor`: bots from before the prompt split (HUI-18). A bot's persona used to be one SOUL.md, with what it knew
 * under "What you already know"; it now has SOUL.md (who it is), USER.md (what it knows about the operator), MEMORY.md
 * (what it chose to keep) and an optional BOOTSTRAP.md.
 *
 * The check reads each local bot's home. A recognized memory section is an issue that `--fix` moves to MEMORY.md; the
 * rest of a single-file soul needs judgement (a preference is not a rule), so the check names the command that asks the
 * bot to sort it itself, `hui bot split`, and fails until bots.json marks the bot `split` (every bot created since, and
 * each one `hui bot split` asked): a USER.md or MEMORY.md proves nothing, since `--fix` writes MEMORY.md itself. A bot
 * on a worker keeps its home there, and doctor runs offline: it names the command until the bot is marked and leaves the
 * files to that host. An archived bot is never asked, since it takes no messages.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { BOT_FILE_LIMITS, BOT_FILE_NAMES } from "../server/bots-format.ts";
import { BOTS_DIR, BOTS_FILE } from "../server/bots/bots.ts";
import { readHomeFile, writeHomeFile } from "../server/bots/durable.ts";
import { splitKnownSection } from "../server/bots/templates/mapping.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

type StoredBot = { id: string; handle: string; name: string; worker?: string; archived?: true; split?: true };

export type BotsDoctorOptions = {
  /** `bots.json`: the registry the gateway writes. */
  file?: string;
  /** The folder holding each bot's home, `<dir>/<id>`. */
  dir?: string;
};

/** The registry, as the check reads it: a broken file is reported, never thrown. */
async function readBots(file: string): Promise<{ bots: StoredBot[]; problem?: string }> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return { bots: [] };
    return { bots: [], problem: `bots.json could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const parsed = JSON.parse(source) as { bots?: unknown };
    const bots = (Array.isArray(parsed.bots) ? parsed.bots : []).flatMap((raw): StoredBot[] => {
      if (typeof raw !== "object" || raw === null) return [];
      const { id, handle, name, worker, archived, split } = raw as Record<string, unknown>;
      if (typeof id !== "string" || typeof handle !== "string" || typeof name !== "string") return [];
      return [{
        id, handle, name,
        ...(typeof worker === "string" && worker ? { worker } : {}),
        ...(archived === true ? { archived: true as const } : {}),
        ...(split === true ? { split: true as const } : {}),
      }];
    });
    return { bots };
  } catch {
    return { bots: [], problem: "bots.json is not valid JSON: fix or move it, then run hui doctor again." };
  }
}

export function createBotsCheck(options: BotsDoctorOptions = {}): DoctorCheck {
  const file = options.file ?? BOTS_FILE;
  const dir = options.dir ?? BOTS_DIR;

  async function inspect(): Promise<DoctorResult> {
    const { bots, problem } = await readBots(file);
    if (problem) {
      return { id: "bots", title: "Bot files", status: "issue", summary: "bots.json could not be read", items: [], notes: [problem] };
    }
    const items: DoctorItem[] = [];
    for (const bot of bots) {
      const exempt = bot.split || bot.archived;
      if (bot.worker) {
        if (!exempt) items.push({ id: bot.id, label: `@${bot.handle}`, status: "blocked", detail: `its home is on ${bot.worker}: run hui bot split ${bot.handle} once it is connected, so it sorts its own files` });
        continue;
      }
      const soul = await readHomeFile(join(dir, bot.id, BOT_FILE_NAMES.soul));
      // A bot still in its first conversation has nothing to split yet.
      if (soul === undefined) continue;
      if (splitKnownSection(soul).known) {
        items.push({ id: bot.id, label: `@${bot.handle}`, status: "issue", detail: `SOUL.md still holds a "What you already know" section: --fix moves it to MEMORY.md` });
      } else if (!exempt) {
        items.push({ id: bot.id, label: `@${bot.handle}`, status: "blocked", detail: `its SOUL.md is from before the split: run hui bot split ${bot.handle} to have it sort its own files` });
      }
    }
    const issues = items.filter((item) => item.status === "issue").length;
    const splits = items.length - issues;
    const count = (bots: number, verb: string) => `${bots} bot${bots === 1 ? "" : "s"} ${verb}${bots === 1 ? "s" : ""}`;
    return {
      id: "bots",
      title: "Bot files",
      status: items.length ? "issue" : "ok",
      summary: [
        ...(issues ? [`${count(issues, "keep")} a memory section in SOUL.md`] : []),
        ...(splits ? [`${count(splits, "need")} hui bot split`] : []),
      ].join("; ") || "No bot keeps a memory section in SOUL.md or needs hui bot split",
      items,
      notes: ["A bot's split needs judgement: hui bot split <bot> sends it the three files, what belongs in each, and asks it to sort its own."],
    };
  }

  async function fix(): Promise<DoctorResult> {
    const before = await inspect();
    const { bots } = await readBots(file);
    const done: DoctorItem[] = [];
    for (const item of before.items.filter((each) => each.status === "issue")) {
      const bot = bots.find((each) => each.id === item.id);
      if (!bot) continue;
      try {
        const soulFile = join(dir, bot.id, BOT_FILE_NAMES.soul);
        const memoryFile = join(dir, bot.id, BOT_FILE_NAMES.memory);
        const { soul, known } = splitKnownSection(await readFile(soulFile, "utf8"));
        const memory = await readHomeFile(memoryFile);
        // Checked before anything is written: a failed move leaves the bot as it was.
        const next = [memory, known].map((part) => part?.trim()).filter(Boolean).join("\n\n");
        if (next.length > BOT_FILE_LIMITS.memory) {
          throw new Error(`its memory section and MEMORY.md together have ${next.length.toLocaleString("en-US")} characters, more than MEMORY.md's ${BOT_FILE_LIMITS.memory.toLocaleString("en-US")}: shorten it first, then run --fix again`);
        }
        // An empty remainder is no persona: the bot has its first conversation again.
        if (soul) await writeHomeFile(soulFile, soul);
        else await rm(soulFile, { force: true });
        if (next) await writeHomeFile(memoryFile, next);
        done.push({ ...item, status: "fixed", detail: "moved its \"What you already know\" section to MEMORY.md" });
      } catch (error) {
        done.push({ ...item, status: "failed", detail: error instanceof Error ? error.message : String(error) });
      }
    }
    const after = await inspect();
    if (!done.length) return after;
    const failed = done.some((item) => item.status === "failed");
    return {
      ...after,
      status: after.status === "issue" ? "issue" : "fixed",
      summary: failed ? "Something could not be moved: see the failed items" : after.summary,
      items: [...done, ...after.items.filter((item) => item.status === "blocked" || !done.some((each) => each.id === item.id))],
      notes: [...after.notes, ...(done.some((item) => item.status === "fixed") ? ["Start the gateway, then run hui bot split <bot> for each bot listed, so each sorts what is left itself."] : [])],
    };
  }

  return { id: "bots", title: "Bot files", inspect, fix };
}

export const botsCheck = createBotsCheck();
