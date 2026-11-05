/** Owns the Usage page's requested range, its last successful report, the read it may cancel, browser-only display controls and the investigation it starts. */
import type { ReactiveControllerHost } from "lit";
import { investigateUsage, loadUsageReport, type UsageInvestigationTarget, type UsageQuery } from "../api/usage.ts";
import type { UsageReport } from "../api/schema/diagnostics.ts";
import type { UsageSort } from "../lib/usage.ts";

type Preset = "today" | "7d" | "30d" | "90d" | "1y" | "all" | "custom";

/** A read that has not answered by then says so and offers Cancel instead of looking stuck. */
const SLOW_READ_MS = 6_000;

function today(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export class UsageController {
  report: UsageReport | undefined;
  loading = false;
  slow = false;
  stopped = false;
  error = "";
  preset: Preset = "30d";
  zone: "local" | "utc" = "local";
  from = "";
  to = "";
  query = "";
  sort: UsageSort = "recent";
  metric: "tokens" | "cost" = "tokens";
  chart: "total" | "types" = "types";
  limit = 50;
  /** The target whose investigation is starting, so its button says so and cannot be pressed twice. */
  investigating = "";
  investigationError = "";
  #request = 0;
  #target: UsageQuery | undefined;
  #cancel: AbortController | undefined;
  #slow: ReturnType<typeof setTimeout> | undefined;
  #host: Pick<ReactiveControllerHost, "requestUpdate">;
  #read: (query: UsageQuery, refresh?: boolean, signal?: AbortSignal) => Promise<UsageReport>;
  #investigate: (target: UsageInvestigationTarget, range: UsageQuery) => Promise<string>;

  constructor(
    host: Pick<ReactiveControllerHost, "requestUpdate">,
    read = loadUsageReport,
    start = async (target: UsageInvestigationTarget, range: UsageQuery) => (await investigateUsage(target, range)).id,
  ) {
    this.#host = host;
    this.#read = read;
    this.#investigate = start;
    this.#presetDates();
  }

  get timeZone() { return this.zone === "utc" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone; }

  #presetDates() {
    const to = today(this.timeZone);
    const end = new Date(`${to}T00:00:00Z`);
    const days = this.preset === "today" ? 1 : this.preset === "7d" ? 7 : this.preset === "90d" ? 90 : this.preset === "1y" ? 366 : 30;
    end.setUTCDate(end.getUTCDate() - days + 1);
    this.from = end.toISOString().slice(0, 10);
    this.to = to;
  }

  async load(query: UsageQuery = this.#target ?? { from: this.from, to: this.to, timeZone: this.timeZone }, options: { refresh?: boolean } = {}) {
    const request = ++this.#request;
    this.#target = query;
    this.#cancel?.abort();
    const cancel = this.#cancel = new AbortController();
    this.loading = true;
    this.slow = false;
    this.stopped = false;
    this.error = "";
    clearTimeout(this.#slow);
    const slow = this.#slow = setTimeout(() => {
      if (request !== this.#request) return;
      this.slow = true;
      this.#host.requestUpdate();
    }, SLOW_READ_MS);
    this.#host.requestUpdate();
    try {
      const report = await this.#read(query, options.refresh === true, cancel.signal);
      if (request !== this.#request) return;
      this.report = report;
      this.from = report.range.from;
      this.to = report.range.to;
      this.limit = 50;
    } catch (error) {
      if (request === this.#request && !cancel.signal.aborted) {
        const range = query.from && query.to ? `${query.from} to ${query.to}` : "all history";
        this.error = `Could not load ${range} in ${query.timeZone}. ${error instanceof Error ? error.message : "Could not read usage."}`;
      }
    } finally {
      clearTimeout(slow);
      if (request === this.#request) {
        this.loading = false;
        this.slow = false;
        this.#host.requestUpdate();
      }
    }
  }

  #reload() {
    if (this.preset !== "custom" && this.preset !== "all") this.#presetDates();
    void this.load(this.preset === "all" ? { timeZone: this.timeZone } : { from: this.from, to: this.to, timeZone: this.timeZone });
  }

  /** Refresh reads every history again instead of the gateway's recent scan. */
  refresh() { void this.load(undefined, { refresh: true }); }

  selectPreset(preset: Exclude<Preset, "custom">) { this.preset = preset; this.#reload(); }
  setZone(zone: "local" | "utc") { this.zone = zone; this.#reload(); }

  applyRange(from = this.from, to = this.to) {
    this.preset = "custom";
    this.from = from;
    this.to = to;
    void this.load({ from, to, timeZone: this.timeZone });
  }

  search(query: string) { this.query = query; this.limit = 50; this.#host.requestUpdate(); }

  /** The report's own range, so the explanation covers exactly what the page showed. */
  get range(): UsageQuery {
    return this.report ? { from: this.report.range.from, to: this.report.range.to, timeZone: this.report.range.timeZone } : { from: this.from, to: this.to, timeZone: this.timeZone };
  }

  /**
   * Starts the session that explains one expensive history, then reports its id
   * so the page can open it. The gateway builds it from the same report the page
   * holds; a failure is stated here and changes nothing.
   */
  async investigate(target: UsageInvestigationTarget): Promise<string | undefined> {
    if (this.investigating) return undefined;
    this.investigating = target.kind === "session" ? `session:${target.id}` : `pullRequest:${target.repository}#${target.number}`;
    this.investigationError = "";
    this.#host.requestUpdate();
    try {
      return await this.#investigate(target, this.range);
    } catch (error) {
      this.investigationError = `Could not start the investigation. ${error instanceof Error ? error.message : "Try again."}`;
      return undefined;
    } finally {
      this.investigating = "";
      this.#host.requestUpdate();
    }
  }

  /** Leaves a read the user no longer wants to wait for; the last report stays on screen. */
  cancel() {
    this.#request++;
    this.#cancel?.abort();
    this.#cancel = undefined;
    clearTimeout(this.#slow);
    this.loading = false;
    this.slow = false;
    this.stopped = this.report === undefined;
    this.#host.requestUpdate();
  }

  disconnect() { this.#request++; this.#cancel?.abort(); clearTimeout(this.#slow); }
}
