/**
 * The chat's changes card: the operator's answer to a `propose_changes` call.
 * Like a question, it shows only while the session's agent waits in that call,
 * at the end of the transcript (T3 Code's "ready" card, Hermes' changed-files
 * card), with the files, their diffs and one-click Commit, Commit & push, Open
 * draft PR or Open stacked PR, plus Keep iterating. HUI runs Git itself and
 * returns the outcome to the agent; a step Git or GitHub refuses is returned
 * with instructions, so the agent finishes it.
 */
import { LitElement, html, nothing, svg } from "lit";
import {
  changesReady,
  COLLAPSED_FILE_ROWS,
  defaultShipSelection,
  iterateSessionChanges,
  loadFileDiff,
  loadSessionChanges,
  orderChangedFiles,
  proposedShipAction,
  parseDiffLines,
  shipSessionChanges,
  SPLIT_DIFF_MIN_WIDTH,
  splitDiffRows,
  shipSummary,
  type ChangedFile,
  type FileDiff,
  type ReadyChanges,
  type SessionChanges,
  type ShipAction,
  type SplitSide,
} from "../lib/session-changes.ts";
import { icons } from "./openclaw/icons.ts";
import { icons as uiIcons } from "../lib/icons.ts";

/** Octicons mark-github (MIT). A filled glyph: `.btn svg` strokes icons and
 * clears their fill, so the card restores both (see `.changes-card__github`). */
const githubMark = html`<svg class="changes-card__github" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${svg`<path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>`}</svg>`;
/** Lucide git-commit-horizontal (ISC). */
const commitIcon = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M3 12h6M15 12h6"></path></svg>`;

type Notice = { kind: "ok" | "delegated" | "error"; text: string; url?: string };

const STATUS_LETTER: Record<ChangedFile["status"], string> = { added: "A", modified: "M", deleted: "D" };

function canPr(changes: ReadyChanges, canCommit: boolean): boolean {
  return Boolean(changes.remote) && (canCommit || changes.commits > 0 || changes.isDefaultBranch && changes.unpushed > 0);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export class HuiChangesCard extends LitElement {
  static override properties = {
    sessionId: { type: String },
    status: { type: String },
  };
  declare sessionId: string;
  /** Session status; the card refreshes whenever a turn settles. */
  declare status: string;

  #changes?: SessionChanges;
  #selected = new Set<string>();
  #selectionFor = "";
  #open = new Map<string, FileDiff | "loading" | { error: string }>();
  #expanded = false;
  /** Long file lists start clipped to COLLAPSED_FILE_ROWS rows. */
  #listExpanded = false;
  #busy?: ShipAction | "iterate";
  #notice?: Notice;
  /** Editable text, prefilled from the agent's `propose_changes` call. */
  #message = "";
  #prTitle = "";
  #prBody = "";
  /** Proposal the fields were last filled from; a newer one replaces only
   * fields the operator has not edited since. */
  #prefill = { key: "", message: "", prTitle: "", prBody: "" };
  #request = 0;
  #loadedFor = "";
  /** Wide cards (large screens, unsplit panes) show diffs side by side. */
  #split = false;
  readonly #resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    const split = width >= SPLIT_DIFF_MIN_WIDTH;
    if (split !== this.#split) { this.#split = split; this.requestUpdate(); }
  });

  constructor() {
    super();
    this.sessionId = "";
    this.status = "";
  }

  override createRenderRoot() { return this; }

  override connectedCallback() {
    super.connectedCallback();
    this.#resize?.observe(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#resize?.disconnect();
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has("sessionId") && this.sessionId !== this.#loadedFor) {
      this.#loadedFor = this.sessionId;
      this.#changes = undefined;
      this.#open.clear();
      this.#expanded = false;
      this.#listExpanded = false;
      this.#notice = undefined;
      this.#message = "";
      this.#prTitle = "";
      this.#prBody = "";
      this.#prefill = { key: "", message: "", prTitle: "", prBody: "" };
      this.#selectionFor = "";
      void this.refresh();
      return;
    }
    // A propose_changes call turns the session "waiting", like a question;
    // re-read when that starts and when the turn settles.
    const previous = changed.get("status") as string | undefined;
    if (changed.has("status") && previous !== undefined && (this.status === "waiting" || this.status === "idle") && previous !== this.status) void this.refresh();
  }

  /** Re-reads the checkout; a response for another session is dropped. */
  async refresh() {
    const id = this.sessionId;
    if (!id) return;
    const request = ++this.#request;
    try {
      const changes = await loadSessionChanges(id);
      if (request !== this.#request || id !== this.sessionId) return;
      this.#apply(changes);
    } catch {
      // A transient read failure keeps whatever the card last knew.
    }
    this.requestUpdate();
  }

  #apply(changes: SessionChanges) {
    this.#changes = changes;
    if (changes.proposal && changes.proposal.key !== this.#prefill.key) this.#notice = undefined;
    if (!changes.available) return;
    this.#applyProposal(changes);
    const uncommitted = new Set(changes.files.filter((file) => file.uncommitted).map((file) => file.path));
    if (this.#selectionFor !== changes.signature) {
      // Keep the operator's picks that still exist; preselect for a new state.
      const kept = [...this.#selected].filter((path) => uncommitted.has(path));
      this.#selected = new Set(this.#selectionFor && kept.length ? kept : defaultShipSelection(changes));
      this.#selectionFor = changes.signature;
    }
    for (const path of this.#open.keys()) if (!changes.files.some((file) => file.path === path)) this.#open.delete(path);
  }

  #applyProposal(changes: ReadyChanges) {
    const proposal = changes.proposal;
    if (!proposal || proposal.key === this.#prefill.key) return;
    const next = { key: proposal.key, message: proposal.commitMessage, prTitle: proposal.prTitle ?? "", prBody: proposal.prBody ?? "" };
    if (this.#message === this.#prefill.message) this.#message = next.message;
    if (this.#prTitle === this.#prefill.prTitle) this.#prTitle = next.prTitle;
    if (this.#prBody === this.#prefill.prBody) this.#prBody = next.prBody;
    this.#prefill = next;
  }

  #toggleFile(path: string, checked: boolean) {
    if (checked) this.#selected.add(path);
    else this.#selected.delete(path);
    this.requestUpdate();
  }

  async #toggleDiff(path: string) {
    if (this.#open.has(path)) {
      this.#open.delete(path);
      this.requestUpdate();
      return;
    }
    this.#open.set(path, "loading");
    this.#listExpanded = true;
    this.requestUpdate();
    const id = this.sessionId;
    try {
      const diff = await loadFileDiff(id, path);
      if (id === this.sessionId && this.#open.has(path)) this.#open.set(path, diff);
    } catch (error) {
      if (id === this.sessionId && this.#open.has(path)) this.#open.set(path, { error: error instanceof Error ? error.message : "Could not load the diff." });
    }
    this.requestUpdate();
  }

  #toggleAll(changes: ReadyChanges) {
    this.#expanded = !this.#expanded;
    if (this.#expanded) this.#listExpanded = true;
    if (!this.#expanded) {
      this.#open.clear();
      this.requestUpdate();
      return;
    }
    for (const file of changes.files.slice(0, 20)) if (!this.#open.has(file.path)) void this.#toggleDiff(file.path);
    this.requestUpdate();
  }

  async #ship(action: ShipAction) {
    if (this.#busy) return;
    const id = this.sessionId;
    this.#busy = action;
    this.#notice = undefined;
    this.requestUpdate();
    try {
      const text = (value: string) => value.trim() || undefined;
      const message = text(this.#message);
      const opensPr = action === "draft_pr" || action === "stacked_pr";
      const prTitle = opensPr ? text(this.#prTitle) : undefined;
      const prBody = opensPr ? text(this.#prBody) : undefined;
      const response = await shipSessionChanges(id, {
        action,
        files: [...this.#selected],
        ...(message ? { message } : {}),
        ...(prTitle ? { prTitle } : {}),
        ...(prBody ? { prBody } : {}),
      });
      if (id !== this.sessionId) return;
      this.#selectionFor = "";
      this.#apply(response.changes);
      const url = response.result.pullRequest?.url;
      this.#notice = response.outcome === "completed"
        ? { kind: "ok", text: shipSummary(response.result), ...(url ? { url } : {}) }
        : { kind: "delegated", text: `HUI stopped: ${/[.!?]$/u.test(response.error) ? response.error : `${response.error}.`} The session's agent is finishing it.` };
    } catch (error) {
      if (id === this.sessionId) this.#notice = { kind: "error", text: error instanceof Error ? error.message : "Could not ship these changes." };
    } finally {
      if (id === this.sessionId) this.#busy = undefined;
      this.requestUpdate();
    }
  }

  /** Answers the waiting call without shipping; the agent stops and waits. */
  async #iterate() {
    if (this.#busy) return;
    const id = this.sessionId;
    this.#busy = "iterate";
    this.#notice = undefined;
    this.requestUpdate();
    try {
      const changes = await iterateSessionChanges(id);
      if (id === this.sessionId) this.#apply(changes);
    } catch (error) {
      if (id === this.sessionId) this.#notice = { kind: "error", text: error instanceof Error ? error.message : "Could not answer the session's agent." };
    } finally {
      if (id === this.sessionId) this.#busy = undefined;
      this.requestUpdate();
    }
  }

  #renderIterate(label = "Keep iterating") {
    return html`<button type="button" class="btn btn--ghost changes-card__iterate" ?disabled=${Boolean(this.#busy)} @click=${() => { void this.#iterate(); }}>${this.#busy === "iterate" ? "Sending…" : label}</button>`;
  }

  #renderDiff(path: string) {
    const state = this.#open.get(path);
    if (!state) return nothing;
    if (state === "loading") return html`<div class="changes-card__diff changes-card__diff--status" role="status">Loading diff…</div>`;
    if ("error" in state) return html`<div class="changes-card__diff changes-card__diff--status" role="alert">${state.error}</div>`;
    const lines = parseDiffLines(state.diff).filter((line) => line.kind !== "meta");
    const side = (value: SplitSide | undefined) => value
      ? html`<td class="changes-card__num" data-kind=${value.kind}>${value.number}</td><td class="changes-card__code" data-kind=${value.kind}>${value.text || " "}</td>`
      : html`<td class="changes-card__num" data-kind="empty"></td><td class="changes-card__code" data-kind="empty"></td>`;
    const body = !lines.length
      ? html`<p class="changes-card__diff--status">No textual changes (binary or mode change).</p>`
      : this.#split
        ? html`<table class="changes-card__split"><colgroup><col class="changes-card__num-col"><col><col class="changes-card__num-col"><col></colgroup><tbody>
            ${splitDiffRows(lines).map((row) => row.kind === "hunk"
              ? html`<tr class="changes-card__split-hunk"><td colspan="4">${row.text}</td></tr>`
              : html`<tr>${side(row.left)}${side(row.right)}</tr>`)}
          </tbody></table>`
        : html`<pre>${lines.map((line) => html`<span class="changes-card__line" data-kind=${line.kind}>${line.text || " "}</span>`)}</pre>`;
    return html`<div class="changes-card__diff" data-layout=${this.#split ? "split" : "unified"} role="region" aria-label=${`Diff of ${path}`} tabindex="0">
      ${body}
      ${state.truncated ? html`<p class="changes-card__diff--status">Diff truncated.</p>` : nothing}
    </div>`;
  }

  #renderFiles(changes: ReadyChanges) {
    const files = orderChangedFiles(changes.files);
    const collapsible = files.length > Math.ceil(COLLAPSED_FILE_ROWS);
    const collapsed = collapsible && !this.#listExpanded;
    // Collapsed, only the rows that can show are rendered; the half row is
    // inert so hidden checkboxes never take keyboard focus.
    const visible = collapsed ? files.slice(0, Math.ceil(COLLAPSED_FILE_ROWS)) : files;
    const hidden = changes.totalFiles - Math.floor(COLLAPSED_FILE_ROWS);
    const showAll = changes.totalFiles > files.length ? `Show first ${files.length}` : `Show all ${files.length} files`;
    return html`<div class="changes-card__file-list" data-collapsible=${String(collapsible)} data-collapsed=${String(collapsed)}>
      <ul class="changes-card__files" aria-label=${`Changed files, ${changes.totalFiles} total`}>
        ${visible.map((file, index) => this.#renderFile(file, collapsed && index >= Math.floor(COLLAPSED_FILE_ROWS)))}
      </ul>
      ${collapsible ? html`<button type="button" class="changes-card__list-toggle" aria-expanded=${String(!collapsed)}
          @click=${() => { this.#listExpanded = collapsed; this.requestUpdate(); }}>
          ${collapsed
            ? html`<span>+${hidden} more</span><span class="changes-card__list-toggle-action">${showAll}</span>`
            : html`<span class="changes-card__list-toggle-action">Show fewer files</span>`}
          <span class="changes-card__list-chevron" aria-hidden="true">${uiIcons.chevronDown}</span>
        </button>` : nothing}
    </div>
    ${changes.totalFiles > files.length ? html`<p class="changes-card__more">Showing the first ${files.length} of ${changes.totalFiles} changed files.</p>` : nothing}`;
  }

  #renderFile(file: ChangedFile, clipped = false) {
    const open = this.#open.has(file.path);
    const busy = Boolean(this.#busy);
    return html`<li class="changes-card__file" data-status=${file.status} data-open=${String(open)} ?inert=${clipped} aria-hidden=${clipped ? "true" : nothing}>
      <div class="changes-card__file-row">
        ${file.uncommitted
          ? html`<input type="checkbox" class="changes-card__check" aria-label=${`Include ${file.path}`} .checked=${this.#selected.has(file.path)} ?disabled=${busy}
              @change=${(event: Event) => this.#toggleFile(file.path, (event.currentTarget as HTMLInputElement).checked)}>`
          : html`<span class="changes-card__committed" title="Already committed on this branch" aria-label="Committed">${commitIcon}</span>`}
        <button type="button" class="changes-card__file-button" aria-expanded=${String(open)} @click=${() => { void this.#toggleDiff(file.path); }}>
          <span class="changes-card__status" title=${file.status}>${STATUS_LETTER[file.status]}</span>
          <span class="changes-card__path" title=${file.path}>${file.path}</span>
          ${file.session ? html`<span class="changes-card__tag" title="Edited in this session">session</span>` : nothing}
          <span class="changes-card__stat">${file.binary ? html`<span>binary</span>` : html`<span class="changes-card__add">+${file.additions}</span> <span class="changes-card__del">-${file.deletions}</span>`}</span>
        </button>
      </div>
      ${this.#renderDiff(file.path)}
    </li>`;
  }

  /** Marks a field still holding the agent's proposed text. */
  #prefillHint(field: "message" | "prTitle" | "prBody", value: string) {
    return value && value === this.#prefill[field]
      ? html`<span class="changes-card__field-source" title="Proposed by the session's agent; edit freely">from agent</span>`
      : nothing;
  }

  #renderNotice() {
    const notice = this.#notice;
    if (!notice) return nothing;
    return html`<p class="changes-card__notice" data-kind=${notice.kind} role=${notice.kind === "error" ? "alert" : "status"}>
      ${notice.text}
      ${notice.url ? html` <a href=${notice.url} target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : nothing}
    </p>`;
  }

  override render() {
    const changes = this.#changes;
    if (changes && !changes.available && changes.proposal) {
      // Still a pending question: nothing to ship here, but the agent waits.
      return html`<article class="changes-card" aria-label="Nothing to ship">
        <header class="changes-card__header">
          <span class="changes-card__icon" aria-hidden="true">${icons.gitPullRequest}</span>
          <h3 class="changes-card__title">Nothing to ship here</h3>
        </header>
        <p class="changes-card__meta">This session is not in a Git checkout.</p>
        ${this.#renderNotice()}
        <footer class="changes-card__actions">${this.#renderIterate("Continue")}</footer>
      </article>`;
    }
    if (!changes?.available || !changesReady(changes)) {
      // Keep the outcome of the last action visible after the decision.
      return this.#notice ? html`<div class="changes-card changes-card--notice">${this.#renderNotice()}</div>` : nothing;
    }
    const selected = [...this.#selected];
    const uncommitted = changes.files.filter((file) => file.uncommitted).length;
    const busy = this.#busy;
    const pr = changes.pullRequest;
    const canCommit = selected.length > 0;
    const primary = proposedShipAction(changes);
    const stack = primary === "stacked_pr";
    const title = stack ? `Stack on #${pr!.number}` : pr ? pr.title || `Pull request #${pr.number}` : uncommitted ? "Changes ready to commit" : "Branch ready for review";
    const prFields = stack || (!pr && canPr(changes, canCommit));
    const canPush = Boolean(changes.remote) && Boolean(changes.branch) && (canCommit || changes.unpushed > 0);
    const pushLabel = pr && canCommit ? `Commit to #${pr.number}` : canCommit ? "Commit & push" : "Push";
    const pushPrimary = primary === "commit_push" && canPush;
    const titleId = `changes-card-title-${this.sessionId}`;
    return html`<article class="changes-card" aria-labelledby=${titleId} aria-busy=${String(Boolean(busy))}>
      <header class="changes-card__header">
        <span class="changes-card__icon" aria-hidden="true">${icons.gitPullRequest}</span>
        <h3 class="changes-card__title" id=${titleId}>${title}</h3>
        <span class="changes-card__pill" data-state=${stack ? "ready" : pr ? (pr.draft ? "draft" : "open") : "ready"}>${stack ? "Stack" : pr ? (pr.draft ? "Draft PR" : "Open PR") : "Ready"}</span>
        <button type="button" class="changes-card__dismiss btn btn--ghost btn--icon" aria-label="Keep iterating" title="Keep iterating: tell the agent not to ship yet" ?disabled=${Boolean(busy)} @click=${() => { void this.#iterate(); }}>${uiIcons.close}</button>
      </header>
      <p class="changes-card__meta">
        <span class="changes-card__branch" aria-hidden="true">${icons.gitBranch}</span>
        <span class="changes-card__refs">${changes.branch || "detached HEAD"}${changes.isDefaultBranch ? nothing : html` → ${changes.base}`}</span>
        <span class="changes-card__add">+${changes.additions}</span><span class="changes-card__del">-${changes.deletions}</span>
        ${changes.commits ? html`<span>${plural(changes.commits, "commit")}</span>` : nothing}
        ${changes.remote && changes.unpushed ? html`<span>${changes.unpushed} unpushed</span>` : nothing}
        ${changes.behind ? html`<span class="changes-card__warn">${changes.behind} behind</span>` : nothing}
      </p>
      ${this.#renderFiles(changes)}
      ${stack ? html`<p class="changes-card__stack-hint">New branch from <code>${changes.branch}</code>; its draft PR targets <a href=${pr!.url} target="_blank" rel="noopener noreferrer">#${pr!.number}</a>.</p>` : nothing}
      ${canCommit || prFields ? html`<div class="changes-card__fields">
        ${canCommit ? html`<label class="changes-card__field">
          <span class="changes-card__field-label">Commit message ${this.#prefillHint("message", this.#message)}</span>
          <textarea rows="2" placeholder="Generated when empty" .value=${this.#message} ?disabled=${Boolean(busy)} maxlength="4000"
            @input=${(event: Event) => { this.#message = (event.currentTarget as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea>
        </label>` : nothing}
        ${prFields ? html`<label class="changes-card__field">
          <span class="changes-card__field-label">Pull request title ${this.#prefillHint("prTitle", this.#prTitle)}</span>
          <input type="text" placeholder="Generated when empty" .value=${this.#prTitle} ?disabled=${Boolean(busy)} maxlength="200"
            @input=${(event: Event) => { this.#prTitle = (event.currentTarget as HTMLInputElement).value; this.requestUpdate(); }}>
        </label>
        <label class="changes-card__field">
          <span class="changes-card__field-label">Pull request description ${this.#prefillHint("prBody", this.#prBody)}</span>
          <textarea rows="3" placeholder="Generated when empty (Markdown)" .value=${this.#prBody} ?disabled=${Boolean(busy)} maxlength="20000"
            @input=${(event: Event) => { this.#prBody = (event.currentTarget as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea>
        </label>` : nothing}
      </div>` : nothing}
      ${this.#renderNotice()}
      <footer class="changes-card__actions">
        <span class="changes-card__selection">${uncommitted ? `${selected.length}/${uncommitted} files selected` : ""}</span>
        ${this.#renderIterate()}
        <button type="button" class="btn changes-card__view" ?disabled=${Boolean(busy)} @click=${() => this.#toggleAll(changes)}>${this.#expanded ? "Hide diff" : "View diff"}</button>
        ${changes.remote ? nothing : html`<button type="button" class="btn primary changes-card__commit" ?disabled=${!canCommit || Boolean(busy)} @click=${() => { void this.#ship("commit"); }}>
          ${busy === "commit" ? "Committing…" : html`${commitIcon}Commit`}</button>`}
        ${changes.remote ? html`<button type="button" class="btn ${pushPrimary ? "primary " : ""}changes-card__push" ?disabled=${!canPush || Boolean(busy)} @click=${() => { void this.#ship("commit_push"); }}>
          ${busy === "commit_push" ? "Pushing…" : html`${commitIcon}${pushLabel}`}</button>` : nothing}
        ${stack
          ? html`<button type="button" class="btn primary changes-card__pr" ?disabled=${!canCommit || Boolean(busy)} @click=${() => { void this.#ship("stacked_pr"); }}>
              ${busy === "stacked_pr" ? "Opening…" : html`${githubMark}Open stacked PR`}</button>`
          : pr
          ? html`<a class="btn ${pushPrimary ? "" : "primary "}changes-card__pr" href=${pr.url} target="_blank" rel="noopener noreferrer">${githubMark}View pull request</a>`
          : changes.remote ? html`<button type="button" class="btn ${pushPrimary ? "" : "primary "}changes-card__pr" ?disabled=${!canPr(changes, canCommit) || Boolean(busy)} @click=${() => { void this.#ship("draft_pr"); }}>
              ${busy === "draft_pr" ? "Opening…" : html`${githubMark}Open draft PR`}</button>` : nothing}
      </footer>
    </article>`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("hui-changes-card")) customElements.define("hui-changes-card", HuiChangesCard);
