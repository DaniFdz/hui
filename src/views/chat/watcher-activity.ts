/** Background watchers as compact rows at the end of the transcript, styled
 * like background-agent activity: one line per watcher (icon, purpose, latest
 * output, state), several collapsed into one summary line. Opening a row shows
 * its details, a log tail and the stop/restart/dismiss controls. */
import { html, nothing } from "lit";
import { relativeTime } from "../../lib/browser-view.ts";
import { icons } from "../../lib/icons.ts";
import { watcherStateLabel, watcherStateNote, type Watcher } from "../../api/watchers.ts";
import type { WatcherEvent, WatcherState } from "../../lib/watchers.ts";

export type WatcherLogView = {
  id: string;
  lines: readonly string[];
  truncated: boolean;
  loading: boolean;
};

export type WatcherActivityProps = {
  watchers: readonly Watcher[];
  /** Id of the watcher whose stop/restart/dismiss request is in flight. */
  pendingId: string;
  /** The fetched log tail of the opened watcher, when there is one. */
  log: WatcherLogView | null;
  /** Open disclosures: `watchers` for the group, `watcher:<id>` for a row. */
  expanded: ReadonlySet<string>;
  onGroupToggle: (open: boolean) => void;
  onToggle: (watcher: Watcher, open: boolean) => void;
  onStop: (watcher: Watcher) => void;
  onRestart: (watcher: Watcher) => void;
  onDismiss: (watcher: Watcher) => void;
};

const orbitIcon = html`<span class="hui-orbit" aria-hidden="true"><i></i><i></i><i></i></span>`;

function stateIcon(state: Watcher["state"]) {
  if (state === "running") return orbitIcon;
  if (state === "done") return html`<span class="hui-subagent-status hui-subagent-status--completed">${icons.check}</span>`;
  if (state === "stopped") return html`<span class="hui-subagent-status hui-subagent-status--cancelled">${icons.circle}</span>`;
  return html`<span class="hui-subagent-status hui-subagent-status--${state === "dead" ? "dead" : "failed"}">${icons.alertTriangle}</span>`;
}

/** A watcher's target without the scheme, short enough for one line. */
export function watcherTargetLabel(target: string): string {
  const trimmed = target.replace(/^https?:\/\/(?:www\.)?/u, "").replace(/\/$/u, "");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function stateText(watcher: Watcher): string {
  const at = watcher.state === "running" ? watcher.startedAt : watcher.endedAt;
  const time = at ? relativeTime(at) : "";
  return time ? `${watcherStateLabel(watcher)} · ${time}` : watcherStateLabel(watcher);
}

function renderDetails(props: WatcherActivityProps, watcher: Watcher) {
  // One request at a time, so every row's controls wait for it.
  const busy = Boolean(props.pendingId);
  const log = props.log?.id === watcher.id ? props.log : null;
  const lines = log?.lines.length ? log.lines : watcher.lastLine ? [watcher.lastLine] : [];
  const note = watcherStateNote(watcher);
  return html`<div class="chat-watcher__details">
    <div class="chat-watcher__meta">
      ${watcher.target
        ? html`<a href=${watcher.target} target="_blank" rel="noreferrer noopener">${watcherTargetLabel(watcher.target)}</a>`
        : nothing}
      ${watcher.outcome ? html`<span>Then: ${watcher.outcome}</span>` : nothing}
      <span>Started ${relativeTime(watcher.startedAt) || "just now"}${watcher.endedAt ? ` · ended ${relativeTime(watcher.endedAt)}` : ""}</span>
      ${watcher.keepRunning ? html`<span>Keeps running: HUI starts it again if it dies. Stop ends it.</span>` : nothing}
    </div>
    ${note ? html`<p class="chat-watcher__note">${note}</p>` : nothing}
    <div class="chat-watcher__log" tabindex="0" role="log" aria-label="Watcher log" aria-busy=${String(Boolean(log?.loading))}><pre>${lines.length ? lines.join("\n") : "No output yet."}</pre></div>
    <div class="chat-watcher__actions">
      <span class="chat-watcher__path" title=${watcher.logPath}>${watcher.pid ? `PID ${watcher.pid} · ` : ""}${watcher.logPath}</span>
      ${watcher.state === "running"
        ? html`<button type="button" class="btn btn--sm" ?disabled=${busy} @click=${() => props.onStop(watcher)}>Stop</button>`
        : html`<button type="button" class="btn btn--sm" ?disabled=${busy} @click=${() => props.onRestart(watcher)}>Restart</button>
          <button type="button" class="btn btn--sm" ?disabled=${busy} @click=${() => props.onDismiss(watcher)}>Dismiss</button>`}
    </div>
  </div>`;
}

function renderRow(props: WatcherActivityProps, watcher: Watcher) {
  const open = props.expanded.has(`watcher:${watcher.id}`);
  return html`<details class="chat-watcher" data-watcher-id=${watcher.id} aria-busy=${String(props.pendingId === watcher.id)} .open=${open}
    @toggle=${(event: Event) => {
      const next = (event.currentTarget as HTMLDetailsElement).open;
      if (next !== open) props.onToggle(watcher, next);
    }}>
    <summary class="chat-subagents__summary" title=${watcher.command}>
      <span class="chat-subagents__icon">${stateIcon(watcher.state)}</span>
      <span class="chat-subagents__label">${watcher.purpose}</span>
      <span class="chat-subagents__snippet">${watcher.lastLine}</span>
      <span class="chat-subagents__time">${stateText(watcher)}</span>
    </summary>
    ${open ? renderDetails(props, watcher) : nothing}
  </details>`;
}

const STATE_VERBS: Record<WatcherState, string> = { running: "running", done: "finished", failed: "failed", stopped: "stopped", dead: "died" };

/** The event a settled watcher wrote into its conversation, where it woke the agent: a system note, never the
 * operator's bubble. The wait and how it ended sit on the row; what the command printed, its exit status, times and log
 * wait folded under it, since the watcher keeps its own row below. */
export function renderWatcherEvent(event: WatcherEvent) {
  const { state } = event;
  const label = state ? `Watcher ${STATE_VERBS[state]}${event.purpose ? `: ${event.purpose}` : ""}` : "Watcher event";
  const ended = event.endedAt ? relativeTime(event.endedAt) : "";
  const started = event.startedAt ? relativeTime(event.startedAt) : "";
  const facts = state ? `${watcherStateLabel({ state })}${ended ? ` · ${ended}` : ""}` : "Automated event · delivered to pi";
  const details = Boolean(event.target || event.outcome || event.exitCode !== undefined || started || event.lastOutput || event.note || event.log);
  return html`<div class="chat-group system chat-group--watcher-event" role="note" aria-label=${label}>
    <div class="chat-group-messages">
      <div class="chat-subagents chat-subagents--event">
        <details class="chat-watcher-event">
          <summary class="chat-subagents__event-title chat-watcher-event__summary">
            <span class="chat-subagents__icon">${state ? stateIcon(state) : nothing}</span>
            <span class="chat-subagents__label" title=${event.purpose}>${label}</span>
            <span class="chat-subagents__snippet">${facts}</span>
            ${details ? html`<span class="chat-subagents__chevron" aria-hidden="true">${icons.chevronDown}</span>` : nothing}
          </summary>
          ${details ? html`<div class="chat-watcher__details">
            <div class="chat-watcher__meta">
              ${event.target ? html`<a href=${event.target} target="_blank" rel="noreferrer noopener">${watcherTargetLabel(event.target)}</a>` : nothing}
              ${event.outcome ? html`<span>Then: ${event.outcome}</span>` : nothing}
              ${event.exitCode === undefined ? nothing : html`<span>Exit ${event.exitCode}</span>`}
              ${started ? html`<span>Started ${started}${ended ? ` · ended ${ended}` : ""}</span>` : nothing}
              ${event.log ? html`<span class="chat-watcher__log-path" title=${event.log}>${event.log}</span>` : nothing}
            </div>
            ${event.note ? html`<p class="chat-watcher__note">${event.note}</p>` : nothing}
            ${event.lastOutput ? html`<pre class="chat-watcher__output">${event.lastOutput}</pre>` : nothing}
          </div>` : nothing}
        </details>
      </div>
    </div>
  </div>`;
}

export function renderWatcherActivity(props: WatcherActivityProps) {
  const { watchers } = props;
  if (!watchers.length) return nothing;
  if (watchers.length === 1) {
    return html`<div class="chat-subagents chat-watchers" aria-label="Background watchers">${renderRow(props, watchers[0]!)}</div>`;
  }
  const running = watchers.filter((watcher) => watcher.state === "running");
  const current = running[0] ?? watchers[0]!;
  const open = props.expanded.has("watchers");
  return html`<details class="chat-subagents chat-subagents--group chat-watchers" aria-label="Background watchers" .open=${open}
    @toggle=${(event: Event) => {
      const next = (event.currentTarget as HTMLDetailsElement).open;
      if (next !== open) props.onGroupToggle(next);
    }}>
    <summary class="chat-subagents__summary">
      <span class="chat-subagents__icon">${stateIcon(running.length ? "running" : current.state)}</span>
      <span class="chat-subagents__label">${watchers.length} watchers</span>
      <span class="chat-subagents__snippet">${running.length ? `${running.length} running · ${current.purpose}` : "None running"}</span>
      <span class="chat-subagents__chevron" aria-hidden="true">${icons.chevronDown}</span>
    </summary>
    <div class="chat-subagents__list">${watchers.map((watcher) => renderRow(props, watcher))}</div>
  </details>`;
}
