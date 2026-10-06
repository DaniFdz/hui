/**
 * SOUL.md on this gateway (HUI-18): each bot's persona, in the home folder HUI
 * keeps for every bot, `BOTS_DIR/<id>` (owner-only; also the working directory
 * of a bot created without one). A bot with a working directory of its own
 * still has this folder, so SOUL.md never lands in a directory the operator
 * chose. The bot writes SOUL.md itself in its first conversation, with its file
 * tools; the operator replaces it through `PUT /__hui/bots/:id/soul`. Its chat
 * reads it on every request (`renderSoulSection` in `runtimes/durable-bots.ts`).
 *
 * This is the local implementation of the `BotSouls` port: a bot running
 * elsewhere routes the same calls to the host that runs its chat.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BOT_SOUL_FILE } from "../shared/bots.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings.ts";
import type { BotSouls } from "./bot-service.ts";
import { BOTS_DIR } from "./bots.ts";
import { readSoulFile } from "./runtimes/durable-bots.ts";

/** Settings' profile name for a bot's first conversation: undefined while it is empty or still the default. */
export function operatorName(profileName: string): string | undefined {
  const name = profileName.replace(/\s+/gu, " ").trim();
  return name && name !== DEFAULT_SETTINGS.profileName ? name : undefined;
}

/** A bot's home folder in HUI's configuration. */
export function botHome(botId: string, botsDir: string = BOTS_DIR): string {
  return join(botsDir, botId);
}

export function localBotSouls(botsDir: string = BOTS_DIR): BotSouls {
  const home = (botId: string) => botHome(botId, botsDir);
  const file = (botId: string) => join(home(botId), BOT_SOUL_FILE);
  return {
    async prepare(botId) {
      await mkdir(home(botId), { recursive: true, mode: 0o700 });
    },

    read: (botId) => readSoulFile(file(botId)),

    async exists(botId) {
      return (await readSoulFile(file(botId))) !== undefined;
    },

    async write(botId, soul) {
      const target = file(botId);
      if (!soul) {
        await rm(target, { force: true });
        return;
      }
      await mkdir(home(botId), { recursive: true, mode: 0o700 });
      // A temporary file and a rename: the chat never reads half a soul.
      const temporary = `${target}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`;
      try {
        await writeFile(temporary, `${soul}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    },

    async remove(botId) {
      await rm(file(botId), { force: true });
      // Only an empty folder goes: the bot's own files never do.
      await rmdir(home(botId)).catch(() => {});
    },
  };
}
