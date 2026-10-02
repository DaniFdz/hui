/** Background watcher card: HUI's live list of the long-running processes it
 * runs for this conversation. The card shows what each watcher waits for, its
 * state and latest output, and offers stop, restart, log and dismiss controls.
 * Watching is HUI-owned state, so the operator can see a watcher die instead of
 * discovering an orphaned nohup process later. */
import { html, nothing } from "lit";
import { relativeTime } from "../../lib/browser-view.ts";
import { watcherStateLabel, type Watcher } from "../../lib/watchers.ts";

export type WatcherLogView = {
  id: string;
  lines: readonly string[];
  truncated: boolean;
  loading: boolean;
};

export type WatcherCardProps = {
  watchers: readonly Watcher[];
  /** Id of the watcher whose stop/restart/dismiss request is in flight. */
  pendingId: string;
  /** The log tail the operator expanded, when one is open. */
  log: WatcherLogView | null;
  onStop: (watcher: Watcher) => void;
  onRestart: (watcher: Watcher) => void;
  onDismiss: (watcher: Watcher) => void;
  onViewLog: (watcher: Watcher) => void;
  onHideLog: () => void;
};

/** A watcher's target without the scheme, short enough for the card. */
export function watcherTargetLabel(target: string): string {
  const trimmed = target.replace(/^https?:\/\/(?:www\.)?/u, "").replace(/\/$/u, "");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function renderWatcher(props: WatcherCardProps, watcher: Watcher) {
  const busy = props.pendingId === watcher.id;
  const running = watcher.state === "running";
  const logOpen = props.log?.id === watcher.id;
  const state = watcherStateLabel(watcher);
  return html`<article class="watcher watcher--${watcher.state}" data-watcher-id=${watcher.id} aria-busy=${String(busy)}>
    <div class="watcher__header">
      <span class="watcher__eyebrow"><span class="watcher__dot" aria-hidden="true"></span>Background watcher</span>
      <span class="watcher__state">${state}</span>
    </div>
    <div class="watcher__purpose">${watcher.purpose}</div>
    <div class="watcher__meta">
      ${watcher.target
        ? html`<a class="watcher__target" href=${watcher.target} target="_blank" rel="noreferrer noopener">${watcherTargetLabel(watcher.target)}</a>`
        : nothing}
      ${watcher.outcome ? html`<span class="watcher__outcome">Then: ${watcher.outcome}</span>` : nothing}
      <span class="watcher__time">Started ${relativeTime(watcher.startedAt) || "just now"}${watcher.endedAt ? ` · ended ${relativeTime(watcher.endedAt)}` : ""}</span>
    </div>
    <div class="watcher__line" title=${watcher.lastLine}>${watcher.lastLine || (running ? "Waiting for output…" : "No output recorded.")}</div>
    <details class="watcher__details">
      <summary>Command and log path</summary>
      <code class="watcher__path">${watcher.command}</code>
      <code class="watcher__path">${watcher.logPath}</code>
    </details>
    <div class="watcher__actions">
      <button type="button" class="watcher__action" @click=${() => (logOpen ? props.onHideLog() : props.onViewLog(watcher))}>
        ${logOpen ? "Hide log" : "View log"}
      </button>
      ${running
        ? html`<button type="button" class="watcher__action" ?disabled=${busy} @click=${() => props.onStop(watcher)}>Stop</button>`
        : html`<button type="button" class="watcher__action" ?disabled=${busy} @click=${() => props.onRestart(watcher)}>Restart</button>
            <button type="button" class="watcher__action watcher__action--dismiss" ?disabled=${busy} @click=${() => props.onDismiss(watcher)}>Dismiss</button>`}
    </div>
    ${logOpen && props.log ? html`<div class="watcher__log">
      <div class="watcher__log-header">
        <span>${props.log.lines.length ? `${props.log.lines.length} line${props.log.lines.length === 1 ? "" : "s"}${props.log.truncated ? " · earlier lines hidden" : ""}` : "No output yet"}</span>
        <span class="watcher__log-actions">
          <button type="button" class="watcher__action" ?disabled=${props.log.loading} @click=${() => props.onViewLog(watcher)}>${props.log.loading ? "Loading…" : "Refresh"}</button>
          <button type="button" class="watcher__action" @click=${() => props.onHideLog()}>Close</button>
        </span>
      </div>
      <pre class="watcher__log-body" tabindex="0" aria-label="Watcher log">${props.log.lines.join("\n")}</pre>
    </div>` : nothing}
  </article>`;
}

export function renderWatcherCard(props: WatcherCardProps) {
  if (!props.watchers.length) return nothing;
  return html`<div class="watchers" aria-label="Background watchers">${props.watchers.map((watcher) => renderWatcher(props, watcher))}</div>`;
}
