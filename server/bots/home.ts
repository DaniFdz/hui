/**
 * A bot's home files on the host that runs its chat (HUI-18): the folder HUI
 * keeps for every bot, `BOTS_DIR/<id>` (owner-only; also the working directory
 * of a bot created without one), holding
 *
 *   SOUL.md       its persona, which it writes with `write_soul`
 *   USER.md       what it knows about the operator, which it writes with `update_user`
 *   MEMORY.md     what it chose to keep, which it writes with `update_memory`
 *   BOOTSTRAP.md  the operator's onboarding body, read while SOUL.md does not exist
 *
 * A bot with a working directory of its own still has this folder, so none of
 * them lands in a directory the operator chose. The chat reads them on every
 * request (`durable.ts`); the tools and `PUT …/files/…` go through
 * `writeHomeFile`, which writes atomically. SOUL.md and BOOTSTRAP.md travel in
 * an export; USER.md and MEMORY.md never do. Deleting a bot removes this folder
 * with everything in it, never following a link out of HUI's bots directory.
 *
 * This is the local implementation of the `BotFiles` port: a bot running
 * elsewhere routes the same calls to the host that runs its chat.
 */
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

import { BOT_FILE_NAMES, type BotFile } from "../bots-format.ts";
import { DEFAULT_SETTINGS } from "../hui-settings.ts";
import type { BotFiles } from "./service.ts";
import { BOTS_DIR } from "./bots.ts";
import { readHomeFile, writeHomeFile } from "./durable.ts";

/** Settings' profile name for a bot's first conversation: undefined while it is empty or still the default. */
export function operatorName(profileName: string): string | undefined {
  const name = profileName.replace(/\s+/gu, " ").trim();
  return name && name !== DEFAULT_SETTINGS.profileName ? name : undefined;
}

/** A bot's home folder in HUI's configuration. */
export function botHome(botId: string, botsDir: string = BOTS_DIR): string {
  return join(botsDir, botId);
}

export function localBotFiles(botsDir: string = BOTS_DIR): BotFiles {
  const home = (botId: string) => botHome(botId, botsDir);
  const file = (botId: string, kind: BotFile) => join(home(botId), BOT_FILE_NAMES[kind]);
  return {
    async prepare(botId) {
      await mkdir(home(botId), { recursive: true, mode: 0o700 });
    },

    read: (botId, kind = "soul") => readHomeFile(file(botId, kind)),

    async exists(botId, kind = "soul") {
      return (await readHomeFile(file(botId, kind))) !== undefined;
    },

    async write(botId, text, kind = "soul") {
      if (text) await writeHomeFile(file(botId, kind), text);
      else await rm(file(botId, kind), { force: true });
    },

    async remove(botId) {
      const target = home(botId);
      let info;
      try {
        info = await lstat(target);
      } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return;
        throw error;
      }
      // A link is removed, never followed: nothing outside HUI's bots directory goes.
      if (info.isSymbolicLink() || !info.isDirectory()) {
        await rm(target, { force: true });
        return;
      }
      const [root, real] = await Promise.all([realpath(botsDir), realpath(target)]);
      if (real !== join(root, botId)) throw new Error(`Refusing to delete ${target}: it is not ${botId}'s folder in HUI's bots directory.`);
      // Everything in it goes: the four files and every file HUI or the bot put there (links inside are removed, not followed).
      await rm(target, { recursive: true, force: true });
    },
  };
}
