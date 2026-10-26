/**
 * Owns the Dashboard page's host metrics: the poll that runs while the page shows and the document is visible, the
 * last read or its error, and the recent samples the sparklines draw. The session counts come from the session list
 * the app already holds.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { loadHostMetrics } from "../api/control-surfaces.ts";
import type { HostMetrics } from "../api/schema/host.ts";

export const DASHBOARD_POLL_MS = 5_000;
export const DASHBOARD_HISTORY = 60;

export class DashboardController implements ReactiveController {
  metrics: HostMetrics | undefined;
  history: readonly HostMetrics[] = [];
  error = "";
  readonly #host: Pick<ReactiveControllerHost, "requestUpdate">;
  readonly #load: () => Promise<HostMetrics>;
  #timer: ReturnType<typeof setInterval> | undefined;
  #pending: Promise<void> | undefined;

  constructor(host: Pick<ReactiveControllerHost, "requestUpdate" | "addController">, load = loadHostMetrics) {
    this.#host = host;
    this.#load = load;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.stop();
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.refresh();
    this.#timer = setInterval(() => { if (!document.hidden) this.refresh(); }, DASHBOARD_POLL_MS);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  refresh = (): void => {
    this.#pending ??= this.#read().finally(() => { this.#pending = undefined; });
  };

  async #read(): Promise<void> {
    try {
      const metrics = await this.#load();
      if (!this.error && metrics.sampledAt === this.metrics?.sampledAt) return;
      this.metrics = metrics;
      this.error = "";
      if (this.history.at(-1)?.sampledAt !== metrics.sampledAt) this.history = [...this.history, metrics].slice(-DASHBOARD_HISTORY);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === this.error) return;
      this.error = message;
    }
    this.#host.requestUpdate();
  }
}
