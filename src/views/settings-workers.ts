import { LitElement, html, nothing } from "lit";
import { createBot, createWorker, deleteBot, loadWorkers, removeWorker, runBot, updateBot, updateWorker, workerAction, type BotInput, type WorkerBot, type WorkerView } from "../lib/workers.ts";
import { describeSchedule, localTimezone } from "./settings-automation.ts";

const POLL_FAST_MS = 1_500;
const POLL_MS = 10_000;

const STATUS: Record<WorkerView["state"], { kind: string; label: string }> = {
  connected: { kind: "ok", label: "Connected" },
  connecting: { kind: "warn", label: "Connecting" },
  error: { kind: "danger", label: "Not connected" },
  disconnected: { kind: "", label: "Disconnected" },
};

function lastRun(bot: WorkerBot): string {
  const run = bot.runs[0];
  if (!run) return "Not run yet";
  const when = new Date(run.finishedAt ?? run.startedAt).toLocaleString();
  return `${run.status === "running" ? "Running since" : run.status[0]!.toUpperCase() + run.status.slice(1)} ${when}${run.error ? ` · ${run.error}` : run.summary ? ` · ${run.summary.slice(0, 140)}` : ""}`;
}

/** Settings → Workers: machines HUI runs PI on, and the bots they host. */
export class HuiWorkersSettings extends LitElement {
  #workers: WorkerView[] = [];
  #loading = true;
  #error = "";
  #notice = "";
  #busy = new Set<string>();
  #editingBot: { worker: string; bot: WorkerBot } | undefined;
  /** Editing keeps the worker's sessions; only the next connection changes. */
  #editingWorker: WorkerView | undefined;
  #poll?: ReturnType<typeof setTimeout>;
  #request = 0;

  override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); void this.#refresh(); }
  override disconnectedCallback() { super.disconnectedCallback(); this.#request++; if (this.#poll) clearTimeout(this.#poll); }

  async #refresh() {
    const request = ++this.#request;
    if (this.#poll) clearTimeout(this.#poll);
    try {
      const workers = await loadWorkers();
      if (request !== this.#request) return;
      this.#workers = workers;
      this.#error = "";
    } catch (error) {
      if (request !== this.#request) return;
      this.#error = error instanceof Error ? error.message : "Workers could not be loaded.";
    }
    this.#loading = false;
    this.requestUpdate();
    const fast = this.#workers.some((worker) => worker.state === "connecting");
    this.#poll = setTimeout(() => void this.#refresh(), fast ? POLL_FAST_MS : POLL_MS);
  }

  async #act(key: string, action: () => Promise<unknown>, notice = "") {
    this.#busy.add(key);
    this.#error = "";
    this.#notice = "";
    this.requestUpdate();
    try {
      await action();
      this.#notice = notice;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "That did not work.";
    } finally {
      this.#busy.delete(key);
      await this.#refresh();
    }
  }

  #saveWorker(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const input = {
      name: String(data.get("name") ?? ""), command: String(data.get("command") ?? ""),
      extraPaths: String(data.get("extraPaths") ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    };
    const editing = this.#editingWorker;
    void this.#act("add", async () => {
      if (editing) await updateWorker(editing.id, input);
      else await workerAction((await createWorker(input)).id, "connect");
      this.#editingWorker = undefined;
      form.reset();
    }, editing ? "Worker saved. Connect again to use the new command." : "Worker added. HUI is setting it up now.");
  }

  #saveBot(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const minutes = Number(text("everyMinutes"));
    const cron = text("cron");
    const input: BotInput = {
      name: text("name"), cwd: text("cwd"), instructions: text("instructions"), prompt: text("prompt"),
      schedule: cron ? { kind: "cron", expression: cron, timezone: localTimezone() }
        : minutes > 0 ? { kind: "every", everyMs: Math.round(minutes * 60_000) } : null,
      enabled: data.get("enabled") !== null,
    };
    const editing = this.#editingBot;
    const worker = editing?.worker ?? text("worker");
    void this.#act("bot", async () => {
      if (editing) await updateBot(worker, editing.bot.key, input);
      else await createBot(worker, input);
      this.#editingBot = undefined;
      form.reset();
    }, editing ? "Bot updated." : "Bot created. It appears in the sidebar under Bots.");
  }

  #openSession(id: string) {
    this.dispatchEvent(new CustomEvent("hui-open-session", { detail: { id }, bubbles: true, composed: true }));
  }

  #renderWorker(worker: WorkerView) {
    const status = STATUS[worker.state];
    const busy = this.#busy.has(worker.id);
    return html`<div class="settings-group" data-worker=${worker.id}>
      <div class="settings-row">
        <div class="settings-row__text">
          <span class="settings-row__title">${worker.name}
            <span class="settings-status ${status.kind ? `settings-status--${status.kind}` : ""}" data-worker-state=${worker.state}><span class="settings-status__dot" aria-hidden="true"></span>${status.label}</span></span>
          <span class="settings-row__desc"><code>${worker.command}</code></span>
          ${worker.host ? html`<span class="settings-row__desc" data-worker-host>${worker.host.hostname} · ${worker.host.platform}/${worker.host.arch} · Node ${worker.host.node} · home ${worker.host.home}</span>` : nothing}
        </div>
        <div class="settings-row__control jira-settings__actions">
          ${worker.state === "connected"
            ? html`<button type="button" class="btn btn--sm" ?disabled=${busy} @click=${() => void this.#act(worker.id, () => workerAction(worker.id, "sync"), "Sync started.")}>Sync now</button>
              <button type="button" class="btn btn--sm" ?disabled=${busy} @click=${() => void this.#act(worker.id, () => workerAction(worker.id, "disconnect"))}>Disconnect</button>`
            : html`<button type="button" class="btn btn--sm primary" ?disabled=${busy || worker.state === "connecting"} @click=${() => void this.#act(worker.id, () => workerAction(worker.id, "connect"))}>Connect</button>`}
          <button type="button" class="btn btn--sm" @click=${() => { this.#editingWorker = worker; this.requestUpdate(); }}>Edit</button>
          <button type="button" class="btn btn--sm" ?disabled=${busy} @click=${() => {
            if (confirm(`Remove ${worker.name}? Sessions on it must be deleted first; nothing on the remote is deleted.`)) void this.#act(worker.id, () => removeWorker(worker.id));
          }}>Remove</button>
        </div>
      </div>
      ${worker.state === "connecting" ? html`<div class="settings-row"><div class="settings-row__text"><span class="settings-row__desc" role="status">${worker.phase ?? "Connecting"}…</span></div></div>` : nothing}
      ${worker.state === "error" && worker.error ? html`<div class="settings-row"><div class="settings-row__text"><span class="settings-row__desc" role="alert" data-worker-error>${worker.error}</span></div></div>` : nothing}
      ${worker.sync ? html`<div class="settings-row"><div class="settings-row__text">
        <span class="settings-row__title">Configuration</span>
        <span class="settings-row__desc" data-worker-sync>Synced ${worker.sync.files} files (${worker.sync.uploaded} sent${worker.sync.deleted ? `, ${worker.sync.deleted} removed` : ""}) at ${new Date(worker.sync.at).toLocaleTimeString()}${worker.sync.installed.length ? ` · installed ${worker.sync.installed.join(", ")}` : ""}${worker.sync.skipped.length ? ` · skipped ${worker.sync.skipped.join("; ")}` : ""}${worker.sync.errors.length ? ` · ${worker.sync.errors.join("; ")}` : ""}</span>
      </div></div>` : nothing}
      ${worker.extraPaths.length ? html`<div class="settings-row"><div class="settings-row__text"><span class="settings-row__title">Extra paths</span><span class="settings-row__desc">${worker.extraPaths.join(", ")}</span></div></div>` : nothing}
    </div>`;
  }

  #renderBots() {
    const connected = this.#workers.filter((worker) => worker.state === "connected");
    const bots = this.#workers.flatMap((worker) => (worker.bots ?? []).map((bot) => ({ worker, bot })));
    const editing = this.#editingBot;
    const field = (label: string, control: unknown, stacked = false) => html`<label class="settings-row ${stacked ? "settings-row--stacked" : ""}"><span class="settings-row__text"><span class="settings-row__title">${label}</span></span><span class="settings-row__control"><span class="cron-control">${control}</span></span></label>`;
    return html`<section class="settings-section" data-settings-bots>
      <div class="settings-section__header"><div class="settings-section__copy">
        <h2 class="settings-section__heading">Bots</h2>
        <p class="settings-section__desc">A bot is an agent that lives on a worker: standing instructions, a check-in prompt and an optional schedule. The worker runs it even while HUI is closed; each bot is also a session you can talk to.</p>
      </div></div>
      ${bots.length ? html`<div class="settings-group">${bots.map(({ worker, bot }) => html`<div class="settings-row" data-bot=${bot.key}>
        <div class="settings-row__text">
          <span class="settings-row__title">${bot.name} <span class="settings-row__muted">on ${worker.name}</span></span>
          <span class="settings-row__desc">${bot.schedule ? describeSchedule(bot.schedule) : "Runs when you ask"}${bot.enabled ? "" : " · paused"} · ${lastRun(bot)}</span>
        </div>
        <div class="settings-row__control jira-settings__actions">
          <button type="button" class="btn btn--sm" @click=${() => this.#openSession(bot.key)}>Open chat</button>
          <button type="button" class="btn btn--sm" ?disabled=${this.#busy.has(bot.key) || bot.runs[0]?.status === "running"} @click=${() => void this.#act(bot.key, () => runBot(worker.id, bot.key), `${bot.name} is running.`)}>Run now</button>
          <button type="button" class="btn btn--sm" @click=${() => { this.#editingBot = { worker: worker.id, bot }; this.requestUpdate(); }}>Edit</button>
          <button type="button" class="btn btn--sm" ?disabled=${this.#busy.has(bot.key)} @click=${() => {
            if (confirm(`Delete ${bot.name} and its conversation row? Its transcript stays on ${worker.name}.`)) void this.#act(bot.key, () => deleteBot(worker.id, bot.key));
          }}>Delete</button>
        </div>
      </div>`)}</div>` : nothing}
      ${connected.length || editing ? html`<form class="settings-group" data-bot-form @submit=${(event: SubmitEvent) => this.#saveBot(event)}>
        <div class="settings-row"><div class="settings-row__text"><span class="settings-row__title">${editing ? `Edit ${editing.bot.name}` : "New bot"}</span></div></div>
        ${editing ? nothing : field("Worker", html`<select class="settings-input" name="worker" required>${connected.map((worker) => html`<option value=${worker.id}>${worker.name}</option>`)}</select>`)}
        ${field("Name", html`<input class="settings-input" name="name" required maxlength="80" placeholder="Release watcher" .value=${editing?.bot.name ?? ""} />`)}
        ${field("Directory on the worker", html`<input class="settings-input" name="cwd" required spellcheck="false" placeholder="~/src/project" .value=${editing?.bot.cwd ?? ""} />`)}
        ${field("Instructions", html`<textarea class="settings-input" name="instructions" maxlength="20000" placeholder="Who this bot is and how it works, kept in its system prompt." .value=${editing?.bot.instructions ?? ""}></textarea>`, true)}
        ${field("Check-in prompt", html`<textarea class="settings-input" name="prompt" required maxlength="20000" placeholder="Check the open pull requests and report anything that needs me." .value=${editing?.bot.prompt ?? ""}></textarea>`, true)}
        ${field("Check in every (minutes)", html`<input class="settings-input" name="everyMinutes" type="number" min="1" step="1" placeholder="Only when asked" .value=${editing?.bot.schedule?.kind === "every" ? String(Math.round(editing.bot.schedule.everyMs / 60_000)) : ""} />`)}
        ${field("Or a cron expression", html`<input class="settings-input" name="cron" spellcheck="false" placeholder="0 9 * * 1-5" .value=${editing?.bot.schedule?.kind === "cron" ? editing.bot.schedule.expression : ""} />`)}
        <label class="settings-row"><span class="settings-row__text"><span class="settings-row__title">Enabled</span></span><span class="settings-row__control"><input type="checkbox" name="enabled" ?checked=${editing ? editing.bot.enabled : true} /></span></label>
        <div class="automation-actions cron-editor-actions">
          <button type="submit" class="btn primary" ?disabled=${this.#busy.has("bot")}>${editing ? "Save bot" : "Create bot"}</button>
          ${editing ? html`<button type="button" class="btn" @click=${() => { this.#editingBot = undefined; this.requestUpdate(); }}>Cancel</button>` : nothing}
        </div>
      </form>` : html`<p class="settings-section__desc">Connect a worker to create bots on it.</p>`}
    </section>`;
  }

  override render() {
    const editing = this.#editingWorker;
    return html`
      <section class="settings-section" data-settings-workers>
        <div class="settings-section__header"><div class="settings-section__copy">
          <h2 class="settings-section__heading">Remote workers</h2>
          <p class="settings-section__desc">Run sessions on another machine. A worker is any command that opens a shell there — <code>ssh devbox</code>, <code>docker exec -i box</code>, <code>kubectl exec -i pod --</code>. HUI installs what it needs under <code>~/.local/share/hui-worker</code>, mirrors your PI settings, skills and extensions, and lends credentials only while connected. Sessions keep running there when HUI disconnects.</p>
        </div></div>
        ${this.#error ? html`<p class="jira-settings__error" role="alert">${this.#error}</p>` : nothing}
        ${this.#notice ? html`<p class="jira-settings__notice" role="status">${this.#notice}</p>` : nothing}
        ${this.#loading ? nothing : this.#workers.map((worker) => this.#renderWorker(worker))}
        <form class="settings-group" data-worker-form @submit=${(event: SubmitEvent) => this.#saveWorker(event)}>
          <div class="settings-row"><div class="settings-row__text"><span class="settings-row__title">${editing ? `Edit ${editing.name}` : "Add a worker"}</span></div></div>
          <label class="settings-row"><span class="settings-row__text"><span class="settings-row__title">Name</span></span><span class="settings-row__control"><span class="cron-control">
            <input class="settings-input" name="name" required maxlength="60" placeholder="devbox" .value=${editing?.name ?? ""} /></span></span></label>
          <label class="settings-row"><span class="settings-row__text"><span class="settings-row__title">Connect command</span><span class="settings-row__desc">Must work without a password prompt.</span></span><span class="settings-row__control"><span class="cron-control">
            <input class="settings-input" name="command" required spellcheck="false" placeholder="ssh devbox" .value=${editing?.command ?? ""} /></span></span></label>
          <label class="settings-row settings-row--stacked"><span class="settings-row__text"><span class="settings-row__title">Extra paths to mirror</span><span class="settings-row__desc">Optional, one per line: files your extensions read, such as <code>~/.pi/agent/mcp.json</code>.</span></span><span class="settings-row__control"><span class="cron-control">
            <textarea class="settings-input" name="extraPaths" spellcheck="false" .value=${editing?.extraPaths.join("\n") ?? ""}></textarea></span></span></label>
          <div class="automation-actions cron-editor-actions">
            <button type="submit" class="btn primary" ?disabled=${this.#busy.has("add")}>${editing ? "Save worker" : "Add worker"}</button>
            ${editing ? html`<button type="button" class="btn" @click=${() => { this.#editingWorker = undefined; this.requestUpdate(); }}>Cancel</button>` : nothing}
          </div>
        </form>
      </section>
      ${this.#renderBots()}`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-workers-settings")) customElements.define("hui-workers-settings", HuiWorkersSettings);
