/**
 * `BotsController` keeps the bot roster outside `hui-app.ts`: the list, its loading and error state, and the gateway's
 * bot stream that pushes it while Settings → Labs → Bots is on, with reads by GET as the fallback for a gateway without
 * the stream. It also owns the sidebar's Agents | Bots choice, the bot panel's state with the browser-remembered open
 * state and width, and the Settings page's saves. A top-level app only: an embedded pane never reads bots.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadBots, subscribeBots, updateBot } from "../api/bots.ts";
import { applyBotsUpdate, botChangePatch, botSettingChange, isNewBotsFrame, upsertBot, type BotView } from "../lib/bots/bots.ts";
import { readBotPanel, readSidebarTab, writeBotPanel, writeSidebarTab, type BotPanelState, type BotPanelView, type SidebarTab } from "../lib/bots/roster.ts";
import { botsEnabled } from "../lib/settings.ts";
import { refreshSettings, settingsWritten } from "../lib/settings/settings-store.ts";
import { NO_BOT_SETTINGS_SAVES, type BotSettingKey, type BotSettingsSaves, type BotSettingValue } from "../views/bot-settings.ts";
import type { SettingsController } from "./settings-controller.ts";

type BotsHost = ReactiveControllerHost & { embeddedPane: boolean };

type BotsDeps = {
  control: Pick<SettingsController, "settings" | "adoptSettings">;
  /** The list with each bot's chat status, unread mark and presence as the shell knows them. */
  live: (bots: readonly BotView[]) => BotView[];
  /** Every bots frame: a bot loaded after a panel page opened, or woken. */
  onFrame: () => void;
};

/** A bot's Settings page: a row's saves or refusals without that row's. */
function withoutSetting<Value>(record: Partial<Record<BotSettingKey, Value>>, key: BotSettingKey): Partial<Record<BotSettingKey, Value>> {
  const next = { ...record };
  delete next[key];
  return next;
}

export class BotsController implements ReactiveController {
  list: readonly BotView[] = [];
  loading = false;
  loaded = false;
  error = "";
  streamLive = false;
  /** The sidebar's Agents | Bots choice, remembered by the browser. */
  tab: SidebarTab = readSidebarTab();
  panel: BotPanelState = readBotPanel();
  /** The page the panel shows: the bot's overview, or one its rows opened. Each bot opens on its overview. */
  panelView: BotPanelView = "overview";
  /** The overview row that opened the page showing (its `data-panel-link`): going back puts the focus on it again. */
  panelOpenedFrom = "";
  /** Wide screens: the panel fills the bot's view, its chat hidden underneath. Never remembered. */
  panelExpanded = false;
  /** Narrow layouts open the panel as a sheet only on request; never remembered. */
  sheetOpen = false;
  /** The Settings page's saves, per bot: each change is one PATCH, sent in order, and a newer change to the same row
   * replaces a value still waiting. Kept per bot, so leaving a bot never drops a change on its way. */
  #saves: ReadonlyMap<string, BotSettingsSaves> = new Map();
  #savesQueue: Promise<void> = Promise.resolve();
  readonly #host: BotsHost;
  readonly #deps: BotsDeps;
  #inFlight: Promise<void> | undefined;
  #again = false;
  #streamStop: (() => void) | undefined;
  #streamUnsupported = false;
  /** The stream was asked again after a 409 whose settings still said bots are on; once is enough. */
  #streamRetried = false;
  #revision = 0;

  constructor(host: BotsHost, deps: BotsDeps) {
    this.#host = host;
    this.#deps = deps;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.#streamStop?.();
    this.#streamStop = undefined;
    this.streamLive = false;
  }

  adopt(bots: readonly BotView[]): void {
    this.list = bots;
    this.#host.requestUpdate();
  }

  #set(next: Partial<Pick<BotsController, "list" | "loading" | "loaded" | "error">>): void {
    Object.assign(this, next);
    this.#host.requestUpdate();
  }

  /** The gateway's bot stream while the Bots tab is enabled. It starts with the
   * whole list, then sends what changed; a gateway without it falls back to
   * reading the list whenever a bot's session changes status. */
  sync(): void {
    if (this.#host.embeddedPane) return;
    const wanted = botsEnabled(this.#deps.control.settings) && !this.#streamUnsupported;
    if (wanted && !this.#streamStop) {
      this.#streamStop = subscribeBots({
        onUpdate: (update, first) => {
          if (!isNewBotsFrame(update.revision, first, this.#revision)) return;
          this.#revision = update.revision;
          this.#set({ list: this.#deps.live(applyBotsUpdate(this.list, update)), loaded: true, error: "" });
          this.#deps.onFrame();
        },
        onConnection: (state) => {
          this.streamLive = state === "live";
          if (state === "live") this.#streamRetried = false;
          if (state === "reconnecting" && !this.loaded) this.#set({ error: "Could not reach the gateway for the bot list. Retrying…" });
          if (state === "unsupported") {
            this.#streamUnsupported = true;
            this.#streamStop = undefined;
            void this.refresh();
          }
          // A 409: bots are off on the gateway, turned off on another screen (which ends this stream) or not on there
          // yet. Once this screen's own writes have landed the settings are read again and followed; if they still say
          // bots are on, the stream is asked once more.
          if (state === "off") {
            this.#streamStop = undefined;
            const retry = !this.#streamRetried;
            void settingsWritten().then(refreshSettings).then((settings) => {
              if (!settings) return;
              this.#deps.control.adoptSettings(settings);
              if (retry && botsEnabled(settings)) {
                this.#streamRetried = true;
                this.sync();
              }
            });
          }
        },
      });
    } else if (!wanted && this.#streamStop) {
      this.#streamStop();
      this.#streamStop = undefined;
      this.streamLive = false;
    }
  }

  /** The list is current when the stream runs; otherwise it is read now. */
  ensure(): void {
    if (this.#streamUnsupported) void this.refresh();
    else this.sync();
  }

  /** Retry from an error state: restart a stopped stream or read the list. */
  retry = () => {
    this.#set({ error: "" });
    if (this.#streamUnsupported || this.streamLive) {
      void this.refresh();
      return;
    }
    this.#streamStop?.();
    this.#streamStop = undefined;
    this.sync();
  };

  /** One read at a time; a change that lands meanwhile reads once more after it.
   * Only used without a live stream, whose newer frames a read could overwrite. */
  refresh(): Promise<void> {
    if (this.#host.embeddedPane || this.streamLive) return Promise.resolve();
    if (this.#inFlight) {
      this.#again = true;
      return this.#inFlight;
    }
    this.#set({ loading: true });
    this.#inFlight = (async () => {
      try {
        do {
          this.#again = false;
          try {
            const bots = await loadBots();
            // A stream that went live meanwhile is newer than this read.
            if (!this.streamLive) this.#set({ list: this.#deps.live(bots) });
            this.#set({ loaded: true, error: "" });
          } catch (error) {
            this.#set({ error: error instanceof Error ? error.message : "Could not read bots." });
          }
        } while (this.#again);
      } finally {
        this.#set({ loading: false });
        this.#inFlight = undefined;
      }
    })();
    return this.#inFlight;
  }

  /** False when the tab was already showing. */
  selectTab(tab: SidebarTab): boolean {
    if (this.tab === tab) return false;
    this.tab = tab;
    writeSidebarTab(tab);
    this.#host.requestUpdate();
    return true;
  }

  #setPanel(next: Partial<BotPanelState>): void {
    this.panel = { ...this.panel, ...next };
    writeBotPanel(this.panel);
  }

  /** Another bot opens on its overview, docked. */
  resetPanel(): void {
    this.sheetOpen = false;
    this.panelView = "overview";
    this.panelOpenedFrom = "";
    this.panelExpanded = false;
    this.#host.requestUpdate();
  }

  /** The sheet on narrow layouts; docked, it opens at the width it had. */
  openPanel(sheet: boolean): void {
    if (sheet) this.sheetOpen = true;
    else if (!this.panel.open) this.#setPanel({ open: true });
    this.#host.requestUpdate();
  }

  togglePanel(sheet: boolean): void {
    if (sheet) {
      this.sheetOpen = !this.sheetOpen;
    } else {
      this.#setPanel({ open: !this.panel.open });
      if (!this.panel.open) this.panelExpanded = false;
    }
    this.#host.requestUpdate();
  }

  closePanel(sheet: boolean): void {
    if (sheet) this.sheetOpen = false;
    else this.#setPanel({ open: false });
    this.panelExpanded = false;
    this.#host.requestUpdate();
  }

  closeSheet(): void {
    this.sheetOpen = false;
    this.#host.requestUpdate();
  }

  /** Opens a page from a row of the overview (`from`, the row's `data-panel-link`), or goes back; returns the row the
   * focus goes back to. */
  showPanelView(view: BotPanelView, from = ""): string {
    const returnTo = view === "overview" ? this.panelOpenedFrom : from;
    this.panelOpenedFrom = view === "overview" ? "" : from;
    this.panelView = view;
    this.#host.requestUpdate();
    return returnTo;
  }

  resizePanel(width: number): void {
    this.#setPanel({ width });
    this.#host.requestUpdate();
  }

  expandPanel(expanded: boolean): void {
    this.panelExpanded = expanded;
    this.#host.requestUpdate();
  }

  savesOf(botId: string): BotSettingsSaves {
    return this.#saves.get(botId) ?? NO_BOT_SETTINGS_SAVES;
  }

  #updateSaves(botId: string, update: (saves: BotSettingsSaves) => BotSettingsSaves): void {
    this.#saves = new Map(this.#saves).set(botId, update(this.savesOf(botId)));
    this.#host.requestUpdate();
  }

  /** A Settings page change: shown at once as saving, then sent as its own PATCH after the ones before it. */
  changeSetting(botId: string, key: BotSettingKey, value: BotSettingValue): void {
    if (this.savesOf(botId).pending[key] === value) return;
    this.#updateSaves(botId, (saves) => ({ pending: { ...saves.pending, [key]: value }, errors: withoutSetting(saves.errors, key) }));
    this.#savesQueue = this.#savesQueue.then(() => this.#sendSetting(botId, key));
  }

  /** Sends the newest value a row waits on. The gateway's answer replaces the bot; a refusal stays on the row. A value
   * already sent, or replaced by a newer change meanwhile, is not sent again. */
  async #sendSetting(botId: string, key: BotSettingKey): Promise<void> {
    const value = this.savesOf(botId).pending[key];
    if (value === undefined) return;
    const settle = (error?: string) => this.#updateSaves(botId, (saves) => saves.pending[key] !== value ? saves : {
      pending: withoutSetting(saves.pending, key),
      errors: error ? { ...saves.errors, [key]: error } : withoutSetting(saves.errors, key),
    });
    const bot = this.list.find((candidate) => candidate.id === botId);
    if (!bot) {
      settle("This bot is gone.");
      return;
    }
    const patch = botChangePatch(bot, botSettingChange(key, value));
    if (!patch) {
      settle();
      return;
    }
    try {
      this.adopt(upsertBot(this.list, await updateBot(botId, patch)));
      settle();
    } catch (error) {
      settle(error instanceof Error ? error.message : "Could not save that change.");
    }
  }

  dismissSetting(botId: string, key: BotSettingKey): void {
    if (!this.savesOf(botId).errors[key]) return;
    this.#updateSaves(botId, (saves) => ({ ...saves, errors: withoutSetting(saves.errors, key) }));
  }
}
