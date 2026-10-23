/** A bot's cost on its panel's overview, read through src/api/bots.ts each time its chat changes state; a failed read
 * keeps what was shown and is tried again at the next look. */
import type { ReactiveControllerHost } from "lit";
import type { BotView } from "../api/schema/bots.ts";
import type { UsageTotals } from "../api/schema/diagnostics.ts";
import { loadBotUsage } from "../api/bots.ts";

export class BotUsageController {
  state: { botId: string; usage?: UsageTotals; error: string } = { botId: "", error: "" };
  #host: Pick<ReactiveControllerHost, "requestUpdate">;
  #load: (botId: string) => Promise<UsageTotals>;
  #read = "";

  constructor(host: Pick<ReactiveControllerHost, "requestUpdate">, load = loadBotUsage) {
    this.#host = host;
    this.#load = load;
  }

  async show(bot: Pick<BotView, "id" | "status">): Promise<void> {
    const key = `${bot.id}|${bot.status}`;
    if (key === this.#read) return;
    this.#read = key;
    if (this.state.botId !== bot.id) this.state = { botId: bot.id, error: "" };
    try {
      const usage = await this.#load(bot.id);
      if (this.#read === key) this.state = { botId: bot.id, usage, error: "" };
    } catch (error) {
      if (this.#read !== key) return;
      this.#read = "";
      this.state = { ...this.state, error: error instanceof Error ? error.message : "Could not read the bot's cost." };
    }
    this.#host.requestUpdate();
  }
}
