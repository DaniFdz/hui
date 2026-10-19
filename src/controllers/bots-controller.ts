/**
 * `BotsController` keeps the bot roster outside `hui-app.ts`: the list, its loading and error state, and the gateway's
 * bot stream that pushes it while Settings → Labs → Bots is on, with reads by GET as the fallback for a gateway without
 * the stream. A top-level app only: an embedded pane never reads bots.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadBots, subscribeBots } from "../api/bots.ts";
import { applyBotsUpdate, isNewBotsFrame, type BotView } from "../lib/bots/bots.ts";
import { botsEnabled } from "../lib/settings.ts";
import { refreshSettings, settingsWritten } from "../lib/settings/settings-store.ts";
import type { SettingsController } from "./settings-controller.ts";

type BotsHost = ReactiveControllerHost & { embeddedPane: boolean };

type BotsDeps = {
  control: Pick<SettingsController, "settings" | "adoptSettings">;
  /** The list with each bot's chat status, unread mark and presence as the shell knows them. */
  live: (bots: readonly BotView[]) => BotView[];
  /** Every bots frame: a bot loaded after a panel page opened, or woken. */
  onFrame: () => void;
};

export class BotsController implements ReactiveController {
  list: readonly BotView[] = [];
  loading = false;
  loaded = false;
  error = "";
  streamLive = false;
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
}
