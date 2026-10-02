/*
 * Presentation adapted from the OpenClaw Control UI v2026.9.5 sessions table.
 * Copyright (c) 2026 OpenClaw Foundation, used under the MIT License.
 * GitHub facts come from the gateway's `gh` login; HUI links sessions.
 */
import { html, nothing, type TemplateResult } from "lit";

import {
  pullRequestReference,
  type MyPullRequest,
  type MyPullRequests,
  type MyPullRequestSession,
  type PullRequestChecks,
  type PullRequestReviewDecision,
  type PullRequestRisk,
} from "../../shared/pull-requests.ts";
import { pullRequestStateIcon } from "../components/pull-request-hovercard.ts";
import { icons } from "../lib/icons.ts";
import { navigationPath } from "../lib/navigation.ts";
import { formatUpdated } from "./sessions.ts";
import { renderSettingsToggle } from "./settings-toggle.ts";

if (typeof document !== "undefined") {
  await import("../styles/openclaw-workspaces.css");
}

export type PullRequestsTab = "created" | "reviewRequested";

export type PullRequestsPageProps = {
  data: MyPullRequests | undefined;
  loading: boolean;
  error: string;
  query: string;
  tab: PullRequestsTab;
  onQuery: (value: string) => void;
  onTab: (tab: PullRequestsTab) => void;
  onRefresh: () => void;
  onOpenSession: (id: string) => void;
  onOpenSettings: () => void;
  /** Picked target session per pull request URL (default: the first linked one). */
  targets: Readonly<Record<string, string>>;
  /** URL whose review comments are being sent. */
  sending: string;
  /** Outcome of the last send. */
  sendNotice?: { tone: "ok" | "danger"; text: string };
  onTarget: (url: string, sessionId: string) => void;
  /** `sessionId` absent: start a session on the head branch. */
  onSendComments: (pr: MyPullRequest, sessionId?: string) => void;
  /** URL whose failing checks are being sent (Fix CI). */
  fixing: string;
  /** `sessionId` absent: start a session on the head branch. */
  onFixCi: (pr: MyPullRequest, sessionId?: string) => void;
  /** Created tab: the triage chip (not persisted). */
  triage: TriageFilter;
  onTriage: (triage: TriageFilter) => void;
  /** Created tab: selected repository chips (persisted in the browser; unknown ones are ignored). */
  repos: readonly string[];
  onRepos: (repos: string[]) => void;
  /** URL whose risk-review action (assess, approve, dismiss, keep) is running. */
  reviewing: string;
  /** URL whose approval waits in the confirmation dialog. */
  approveConfirm: string;
  /** URL whose risk review is open in the side drawer. */
  drawer: string;
  onOpenDrawer: (pr: MyPullRequest) => void;
  onCloseDrawer: () => void;
  /** Settings → `pullRequestAutoApproveLowRisk`. */
  autoApprove: boolean;
  onAutoApprove: (enabled: boolean) => void;
  /** Checked accounts: the saved selection, else the accounts last listed. */
  selectedAccounts: readonly string[];
  /** Saves the selected accounts (Settings → `pullRequestAccounts`). */
  onAccounts: (accounts: string[]) => void;
  onAssess: (pr: MyPullRequest) => void;
  onAskApprove: (pr: MyPullRequest) => void;
  onCancelApprove: () => void;
  onApprove: (pr: MyPullRequest) => void;
  onDismiss: (pr: MyPullRequest) => void;
  onKeep: (pr: MyPullRequest) => void;
};

const RISKS: Record<PullRequestRisk, { label: string; tone: string }> = {
  low: { label: "Low risk", tone: "ok" },
  medium: { label: "Medium risk", tone: "warn" },
  high: { label: "High risk", tone: "danger" },
};

/** What the approval dialog says: the pull request and the verdict it rests on. */
export function approveConfirmation(pr: MyPullRequest): { title: string; detail: string } {
  const verdict = pr.assessment?.verdict;
  return {
    title: `Approve ${pullRequestReference(pr)}?`,
    detail: `${pr.title ? `“${pr.title}”. ` : ""}${verdict ? `The risk review rated it ${RISKS[verdict.risk].label.toLocaleLowerCase()}: ${verdict.summary}` : "There is no risk verdict."} This submits an approving review on GitHub as your account.`,
  };
}

export type CreatedAction = {
  kind: "comments" | "start" | "fixCi";
  label: string;
  tooltip: string;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const checksFailed = (pr: MyPullRequest) => pr.checks === "failure" || pr.checks === "error";

/** The Created row's usable actions for the picked session (default: the
 * first linked one), or, without a linked session, those that start one in a
 * known checkout. Unusable actions are left out rather than disabled. */
export function createdActions(pr: MyPullRequest, picked: string | undefined): { target?: MyPullRequestSession; actions: CreatedAction[] } {
  const target = pr.sessions.find((session) => session.id === picked) ?? pr.sessions[0];
  const actions: CreatedAction[] = [];
  const comments = target ? target.newComments ?? 0 : pr.newComments ?? 0;
  if (comments && target) {
    actions.push({ kind: "comments", label: `Review comments (${comments})`, tooltip: `Send ${plural(comments, "new review comment")} to ${target.title}` });
  } else if (comments && pr.localCheckout) {
    actions.push({ kind: "start", label: "Start session with comments", tooltip: `Start a session on ${pr.headRefName} with ${plural(comments, "review comment")}` });
  }
  if (checksFailed(pr) && (target || pr.localCheckout)) {
    const failing = pr.failingChecks?.length ? plural(pr.failingChecks.length, "failing check") : "the failing checks";
    actions.push({
      kind: "fixCi",
      label: target?.ciFixSent ? "Fix CI (sent)" : "Fix CI",
      tooltip: target
        ? `${target.ciFixSent ? "Already sent for this head commit. Send again: " : "Send "}${failing} to ${target.title}`
        : `Start a session on ${pr.headRefName} to fix ${failing}`,
    });
  }
  return { ...(target ? { target } : {}), actions };
}

export type TriageBucket = "needsYou" | "waiting" | "ready" | "drafts";
export type TriageFilter = TriageBucket | "all";

export const TRIAGE: readonly { bucket: TriageFilter; label: string }[] = [
  { bucket: "all", label: "All" },
  { bucket: "needsYou", label: "Needs you" },
  { bucket: "waiting", label: "Waiting on review" },
  { bucket: "ready", label: "Ready to merge" },
  { bucket: "drafts", label: "Drafts" },
];

/** Review comments no linked session has received yet (without a session: all of them). */
function unsentComments(pr: MyPullRequest): number {
  return pr.sessions.length ? Math.min(...pr.sessions.map((session) => session.newComments ?? 0)) : pr.newComments ?? 0;
}

/** Exactly one bucket per Created row: drafts are only Drafts; failed checks,
 * requested changes or unsent comments need you; approved with passing (or
 * no) checks is ready; everything else waits (on review or on running checks). */
export function triageBucket(pr: MyPullRequest): TriageBucket {
  if (pr.state === "draft") return "drafts";
  if (checksFailed(pr) || pr.reviewDecision === "changes_requested" || unsentComments(pr) > 0) return "needsYou";
  if (pr.reviewDecision === "approved" && (!pr.checks || pr.checks === "success")) return "ready";
  return "waiting";
}

export type RepositoryChip = { repository: string; label: string; count: number };

/** One chip per repository in `rows`, most pull requests first, then by name;
 * the short name unless another owner has a repository of that name. */
export function repositoryChips(rows: readonly MyPullRequest[]): RepositoryChip[] {
  const counts = new Map<string, number>();
  for (const pr of rows) counts.set(pr.repository, (counts.get(pr.repository) ?? 0) + 1);
  const short = (repository: string) => repository.slice(repository.indexOf("/") + 1);
  const names = new Map<string, number>();
  for (const repository of counts.keys()) names.set(short(repository).toLowerCase(), (names.get(short(repository).toLowerCase()) ?? 0) + 1);
  return [...counts]
    .map(([repository, count]) => ({ repository, count, label: names.get(short(repository).toLowerCase())! > 1 ? repository : short(repository) }))
    .toSorted((a, b) => b.count - a.count || a.repository.localeCompare(b.repository));
}

/** Created rows for the chips and the search box, newest update first. Selected
 * repositories no longer in the list are ignored; none left means all. */
export function filteredCreated(rows: readonly MyPullRequest[], filter: { triage: TriageFilter; repos: readonly string[]; query: string }): {
  rows: MyPullRequest[]; counts: Record<TriageFilter, number>; repos: string[];
} {
  const present = new Set(rows.map((pr) => pr.repository));
  const repos = filter.repos.filter((repository) => present.has(repository));
  const scoped = matchingPullRequests(rows, filter.query)
    .filter((pr) => !repos.length || repos.includes(pr.repository))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts: Record<TriageFilter, number> = { all: scoped.length, needsYou: 0, waiting: 0, ready: 0, drafts: 0 };
  for (const pr of scoped) counts[triageBucket(pr)] += 1;
  return { rows: filter.triage === "all" ? scoped : scoped.filter((pr) => triageBucket(pr) === filter.triage), counts, repos };
}

/** The compact state the Review requested actions cell shows. */
export function riskPill(pr: MyPullRequest): { label: string; tone: string } | undefined {
  const assessment = pr.assessment;
  if (!assessment) return undefined;
  if (assessment.state === "assessing") return { label: "Assessing…", tone: "warn" };
  return assessment.verdict ? RISKS[assessment.verdict.risk] : { label: "No verdict", tone: "muted" };
}

/** The account list after toggling `login`, in signed-in order. The last
 * selected account cannot be cleared (none would mean the active one anyway). */
export function toggledAccounts(accounts: readonly string[], selected: readonly string[], login: string, checked: boolean): string[] {
  const next = accounts.filter((account) => account === login ? checked : selected.includes(account));
  return next.length ? next : [...selected];
}

/** Free-text filter over repository, number, title and branch. */
export function matchingPullRequests(rows: readonly MyPullRequest[], query: string): MyPullRequest[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...rows];
  return rows.filter((pr) =>
    `${pullRequestReference(pr)} #${pr.number} ${pr.title} ${pr.headRefName}`.toLocaleLowerCase().includes(needle));
}

const CHECKS: Record<PullRequestChecks, { label: string; tone: string }> = {
  success: { label: "Checks passed", tone: "ok" },
  failure: { label: "Checks failed", tone: "danger" },
  error: { label: "Checks errored", tone: "danger" },
  pending: { label: "Checks running", tone: "warn" },
  expected: { label: "Checks expected", tone: "warn" },
};

const DECISIONS: Record<PullRequestReviewDecision, { label: string; tone: string }> = {
  approved: { label: "Approved", tone: "ok" },
  changes_requested: { label: "Changes requested", tone: "danger" },
  review_required: { label: "Review required", tone: "warn" },
};

const SIGNED_OUT: Record<string, string> = {
  signed_out: "GitHub is not connected",
  cli_missing: "GitHub CLI is not installed",
};

function status(label: string, tone: string) {
  return html`<span class="settings-status settings-status--${tone}">
    <span class="settings-status__dot" aria-hidden="true"></span><span>${label}</span>
  </span>`;
}

function settingsLink(props: PullRequestsPageProps, label: string) {
  return html`<a href="/settings/integrations" @click=${(event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onOpenSettings();
  }}>${label}</a>`;
}

function emptyRow(message: string, description: TemplateResult | string, kind: "status" | "alert", columns = 4) {
  return html`<tr>
    <td colspan=${columns} class="data-table-empty-cell">
      <div class="data-table-empty-state" role=${kind}>
        <div class="data-table-empty-state__message">${pullRequestStateIcon("open")}<span>${message}</span></div>
        <p>${description}</p>
      </div>
    </td>
  </tr>`;
}

function renderSessions(props: PullRequestsPageProps, pr: MyPullRequest) {
  if (pr.sessions.length === 0) return html`<span class="muted">No session</span>`;
  return html`<span class="worktree-sessions">${pr.sessions.map((session) => html`<a
    href=${navigationPath({ kind: "session", id: session.id })}
    class="session-link worktree-session-link"
    data-hui-tooltip=${session.title}
    @click=${(event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      props.onOpenSession(session.id);
    }}
  >${session.title}${session.archived ? html` <span class="session-label-chip">Archived</span>` : nothing}</a>`)}</span>`;
}

function renderCreatedActions(props: PullRequestsPageProps, pr: MyPullRequest) {
  const { target, actions } = createdActions(pr, props.targets[pr.url]);
  if (!actions.length) return nothing;
  const busy = Boolean(props.sending || props.fixing);
  const labels: Record<CreatedAction["kind"], string> = { comments: "Sending…", start: "Starting…", fixCi: "Sending…" };
  const running = (action: CreatedAction) => action.kind === "fixCi" ? props.fixing === pr.url : props.sending === pr.url;
  return html`<span class="worktree-actions pull-request-actions">
    ${pr.sessions.length > 1 ? html`<select class="pull-request-target" aria-label=${`Session for ${pullRequestReference(pr)}`}
      .value=${target?.id ?? ""} ?disabled=${busy}
      @change=${(event: Event) => props.onTarget(pr.url, (event.target as HTMLSelectElement).value)}>
      ${pr.sessions.map((session) => html`<option value=${session.id} ?selected=${session.id === target?.id}>${session.title}${session.archived ? " (archived)" : ""}</option>`)}
    </select>` : nothing}
    ${actions.map((action) => html`<span class="worktree-tooltip-wrap" data-hui-tooltip=${action.tooltip}>
      <button type="button" class="btn btn--sm" data-created-action=${action.kind} ?disabled=${busy}
        @click=${() => action.kind === "fixCi" ? props.onFixCi(pr, target?.id) : props.onSendComments(pr, target?.id)}>${running(action) ? labels[action.kind] : action.label}</button>
    </span>`)}
  </span>`;
}

function openSessionLink(props: PullRequestsPageProps, id: string) {
  return html`<a class="pull-request-open-session" href=${navigationPath({ kind: "session", id })} @click=${(event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    props.onOpenSession(id);
  }}>Open session</a>`;
}

function renderAssessAction(props: PullRequestsPageProps, pr: MyPullRequest) {
  const assessment = pr.assessment;
  const busy = props.reviewing === pr.url;
  if (!assessment) {
    return html`<span class="worktree-actions pull-request-actions">
      <span class="worktree-tooltip-wrap" data-hui-tooltip=${`Start a temporary read-only session that reviews ${pullRequestReference(pr)} and reports a risk verdict`}>
        <button type="button" class="btn btn--sm" data-assess-risk ?disabled=${Boolean(props.reviewing)} @click=${() => props.onAssess(pr)}>${busy ? "Starting…" : "Assess risk"}</button>
      </span>
    </span>`;
  }
  const pill = riskPill(pr)!;
  return html`<span class="worktree-actions pull-request-actions">
    <button type="button" class="btn btn--sm pull-request-risk-pill" data-risk-pill=${pr.url} aria-haspopup="dialog"
      aria-label=${`${pill.label}: open the risk review of ${pullRequestReference(pr)}`}
      @click=${() => props.onOpenDrawer(pr)}>${status(pill.label, pill.tone)}</button>
  </span>`;
}

/** The risk review of one Review requested pull request, in a right-side
 * drawer (a native modal dialog: Escape closes it, focus stays inside). */
export function renderVerdictDrawer(props: PullRequestsPageProps): TemplateResult | typeof nothing {
  const pr = props.data?.reviewRequested.find((item) => item.url === props.drawer);
  const assessment = pr?.assessment;
  if (!pr || !assessment) return nothing;
  const verdict = assessment.verdict;
  const pill = riskPill(pr)!;
  const disabled = Boolean(props.reviewing);
  const busy = props.reviewing === pr.url;
  return html`<dialog class="pull-request-drawer" data-risk=${verdict?.risk ?? "none"} aria-labelledby="pull-request-drawer-title"
    @cancel=${(event: Event) => { event.preventDefault(); props.onCloseDrawer(); }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseDrawer();
    }}>
    <header class="pull-request-drawer__header">
      <div class="pull-request-drawer__heading">
        <span class="muted mono">${pullRequestReference(pr)}</span>
        <a class="pull-request-drawer__title" id="pull-request-drawer-title" href=${pr.url} target="_blank" rel="noopener noreferrer">${pr.title || pullRequestReference(pr)}</a>
      </div>
      <button type="button" class="btn btn--icon pull-request-drawer__close" aria-label="Close the risk review" @click=${props.onCloseDrawer}>${icons.close}</button>
    </header>
    <div class="pull-request-drawer__body">
      ${status(pill.label, pill.tone)}
      ${assessment.state === "assessing"
        ? html`<p class="pull-request-verdict__summary">The temporary review session is reading the pull request. Its verdict appears here when it reports.</p>`
        : verdict ? html`
          <p class="pull-request-verdict__summary">${verdict.summary}</p>
          ${verdict.reasons.length ? html`<section><h3 class="pull-request-drawer__label">Reasons</h3><ul class="pull-request-verdict__reasons">${verdict.reasons.map((reason) => html`<li>${reason}</li>`)}</ul></section>` : nothing}
          ${verdict.focusAreas?.length ? html`<section><h3 class="pull-request-drawer__label">Look closely at</h3>
            <ul class="pull-request-verdict__focus">${verdict.focusAreas.map((area) => html`<li><bdi class="mono">${area.path}</bdi> — ${area.note}</li>`)}</ul></section>` : nothing}
        ` : html`<p class="pull-request-verdict__summary">No verdict. The review session finished without reporting a risk verdict.</p>`}
      ${assessment.autoApproveBlocked ? html`<div class="callout warning" role="status">${assessment.autoApproveBlocked}</div>` : nothing}
    </div>
    <footer class="pull-request-drawer__actions">
      ${verdict ? html`<button type="button" class="btn btn--sm primary" data-approve ?disabled=${disabled} @click=${() => props.onAskApprove(pr)}>Approve</button>` : nothing}
      ${assessment.state === "assessing" ? nothing : html`
        <span class="worktree-tooltip-wrap" data-hui-tooltip="Delete the temporary session and its transcript">
          <button type="button" class="btn btn--sm" data-dismiss ?disabled=${disabled} @click=${() => props.onDismiss(pr)}>Dismiss</button>
        </span>
        <span class="worktree-tooltip-wrap" data-hui-tooltip="Keep the review as a normal session">
          <button type="button" class="btn btn--sm" data-keep ?disabled=${disabled} @click=${() => props.onKeep(pr)}>Keep</button>
        </span>`}
      ${openSessionLink(props, assessment.sessionId)}
      ${busy ? html`<span class="muted" role="status">Working…</span>` : nothing}
    </footer>
    ${props.sendNotice ? html`<div class="callout ${props.sendNotice.tone === "ok" ? "success" : "danger"}" role=${props.sendNotice.tone === "ok" ? "status" : "alert"}>${props.sendNotice.text}</div>` : nothing}
  </dialog>`;
}

function renderAccounts(props: PullRequestsPageProps) {
  const accounts = props.data?.accounts ?? [];
  const selected = props.selectedAccounts;
  if (!accounts.length) return nothing;
  return html`<fieldset class="pull-request-accounts">
    <legend>Accounts</legend>
    ${accounts.map((login) => {
      const checked = selected.includes(login);
      return html`<label class="pull-request-accounts__option">
        <input type="checkbox" .checked=${checked} ?disabled=${props.loading || (checked && selected.length === 1)}
          @change=${(event: Event) => props.onAccounts(toggledAccounts(accounts, selected, login, (event.target as HTMLInputElement).checked))} />
        <span class="mono">${login}</span>
      </label>`;
    })}
  </fieldset>`;
}

function renderAutoApprove(props: PullRequestsPageProps) {
  const approved = props.data?.autoApproved ?? [];
  return html`<div class="pull-request-auto-approve">
    <div class="settings-row settings-row--toggle">
      <span class="settings-row__text"><span class="settings-row__title">Auto-approve low risk</span>
        <span class="settings-row__desc">Only applies to pull requests you assessed; never to medium, high or no verdict.</span></span>
      <span class="settings-row__control">${renderSettingsToggle("Auto-approve low risk", props.autoApprove, props.onAutoApprove)}</span>
    </div>
    ${approved.length ? html`<div class="pull-request-auto-approved" role="status" aria-label="Auto-approved">
      <span class="pull-request-drawer__label">Auto-approved</span>
      <ul>${approved.map((item) => html`<li><a href=${item.url} target="_blank" rel="noopener noreferrer" class="mono">${pullRequestReference(item)}</a>
        ${item.title ? html`<span>${item.title}</span>` : nothing}
        <span class="muted">as ${item.account} · <span title=${item.approvedAt}>${formatUpdated(item.approvedAt)}</span></span></li>`)}</ul>
    </div>` : nothing}
  </div>`;
}

/** Names the pull request and its verdict; the only way to approve. */
export function renderApproveDialog(props: PullRequestsPageProps): TemplateResult | typeof nothing {
  const pr = props.data?.reviewRequested.find((item) => item.url === props.approveConfirm);
  if (!pr) return nothing;
  const copy = approveConfirmation(pr);
  const approving = props.reviewing === pr.url;
  return html`<dialog class="hui-modal-dialog pull-request-approve-dialog" aria-labelledby="pull-request-approve-title"
    @cancel=${(event: Event) => { event.preventDefault(); props.onCancelApprove(); }}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onCancelApprove();
      }
    }}>
    <div class="exec-approval-card">
      <div class="exec-approval-header"><div>
        <div class="exec-approval-title" id="pull-request-approve-title">${copy.title}</div>
        <div class="exec-approval-sub">${copy.detail}</div>
      </div></div>
      <div class="exec-approval-actions">
        <button type="button" class="btn primary" ?disabled=${approving} @click=${() => props.onApprove(pr)}>${approving ? "Approving…" : "Approve on GitHub"}</button>
        <button type="button" class="btn pull-request-approve-cancel" ?disabled=${approving} @click=${props.onCancelApprove}>Cancel</button>
      </div>
    </div>
  </dialog>`;
}

/** The row's accounts, only when several are selected and the first one did not find it. */
function accountBadge(props: PullRequestsPageProps, pr: MyPullRequest) {
  const selected = props.data?.selectedAccounts ?? [];
  if (selected.length < 2 || pr.accounts.includes(selected[0]!)) return nothing;
  return html`<span class="session-label-chip pull-request-account" data-hui-tooltip=${`${props.tab === "reviewRequested" ? "Requested of" : "Authored as"} ${pr.accounts.join(", ")}`}>${pr.accounts.map((login, index) => html`${index ? ", " : ""}<bdi data-account=${login}>${login}</bdi>`)}</span>`;
}

const VISIBLE_REPOSITORY_CHIPS = 8;

/** The "+N more" menu closes on Escape (focus back on its toggle) and when focus leaves it. */
function closeMenuOnEscape(event: KeyboardEvent) {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (event.key !== "Escape" || !menu.open) return;
  event.preventDefault();
  event.stopPropagation();
  menu.open = false;
  menu.querySelector("summary")?.focus();
}

function closeMenuOnFocusOut(event: FocusEvent) {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (!menu.contains(event.relatedTarget as Node | null)) menu.open = false;
}

function chip(label: string, count: number, pressed: boolean, onClick: () => void, attributes: { triage?: string; repository?: string } = {}) {
  return html`<button type="button" class="pull-request-chip" aria-pressed=${String(pressed)} data-triage-chip=${attributes.triage ?? nothing}
    data-repository-chip=${attributes.repository ?? nothing} @click=${onClick}>${label} <span class="pull-request-chip__count">${count}</span></button>`;
}

/** Created tab: triage (single choice) and repository (several) chips over the search box. */
function renderCreatedFilters(props: PullRequestsPageProps, rows: readonly MyPullRequest[]) {
  const { counts, repos } = filteredCreated(rows, props);
  const chips = repositoryChips(rows);
  const toggle = (repository: string) => props.onRepos(repos.includes(repository) ? repos.filter((item) => item !== repository) : [...repos, repository]);
  const repoChip = (item: RepositoryChip) => chip(item.label, item.count, repos.includes(item.repository), () => toggle(item.repository), { repository: item.repository });
  const hidden = chips.slice(VISIBLE_REPOSITORY_CHIPS);
  const hiddenSelected = hidden.filter((item) => repos.includes(item.repository)).length;
  return html`<div class="pull-request-filters">
    <div class="pull-request-chips" role="group" aria-label="Triage">
      ${TRIAGE.map(({ bucket, label }) => chip(label, counts[bucket], props.triage === bucket, () => props.onTriage(bucket), { triage: bucket }))}
    </div>
    ${chips.length > 1 ? html`<div class="pull-request-chips" role="group" aria-label="Repositories">
      ${chip("All repos", rows.length, repos.length === 0, () => props.onRepos([]), { repository: "" })}
      ${chips.slice(0, VISIBLE_REPOSITORY_CHIPS).map(repoChip)}
      ${hidden.length ? html`<details class="pull-request-chip-more" @keydown=${closeMenuOnEscape} @focusout=${closeMenuOnFocusOut}>
        <summary class="pull-request-chip">+${hidden.length} more${hiddenSelected ? ` (${hiddenSelected} selected)` : ""}</summary>
        <div class="pull-request-chip-more__menu" role="group" aria-label="More repositories">${hidden.map(repoChip)}</div>
      </details>` : nothing}
    </div>` : nothing}
  </div>`;
}

function body(props: PullRequestsPageProps, rows: readonly MyPullRequest[]): TemplateResult {
  const columns = 5;
  if (props.loading && !props.data) return emptyRow("Loading pull requests…", "Asking GitHub for your open pull requests.", "status", columns);
  if (props.error && !props.data) return emptyRow(props.error, "The pull requests could not be loaded.", "alert", columns);
  const signedOut = props.data?.error ? SIGNED_OUT[props.data.error] : undefined;
  if (signedOut && rows.length === 0) {
    return emptyRow(signedOut, html`${settingsLink(props, "Connect GitHub in Settings → Integrations")} to list your pull requests.`, "alert", columns);
  }
  const matching = props.tab === "created"
    ? filteredCreated(rows, props).rows
    : matchingPullRequests(rows, props.query).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (matching.length === 0) {
    const filtered = props.tab === "created" && (props.triage !== "all" || filteredCreated(rows, props).repos.length > 0);
    return props.query.trim() || filtered
      ? emptyRow("No matching pull requests", filtered ? "Try another filter, repository, number, title or branch." : "Try another repository, number, title or branch.", "status", columns)
      : emptyRow(
        props.tab === "created" ? "No open pull requests" : "No reviews requested",
        html`Nothing is open for this GitHub account. Check the account in ${settingsLink(props, "Settings → Integrations")}.`,
        "status",
        columns,
      );
  }
  return html`${matching.map((pr) => html`
    <tr class="session-data-row pull-request-row" data-pull-request=${pr.url} data-triage=${props.tab === "created" ? triageBucket(pr) : nothing}>
      <td class="data-table-key-col">
        <div class="session-key-cell">
          <span class="session-avatar session-avatar--direct" aria-hidden="true">${pullRequestStateIcon(pr.state)}</span>
          <span class="session-key-cell__text pull-request-key">
            <a class="pull-request-title" href=${pr.url} target="_blank" rel="noopener noreferrer" title=${pr.title || pullRequestReference(pr)}>${pr.title || pullRequestReference(pr)}</a>
            <span class="muted pull-request-meta" title=${`${pullRequestReference(pr)} · ${pr.headRefName}`}>
              ${accountBadge(props, pr)}<span class="mono">${pullRequestReference(pr)}</span> · <bdi class="mono">${pr.headRefName}</bdi>${pr.author && props.tab === "reviewRequested" ? ` · ${pr.author}` : ""}
            </span>
          </span>
        </div>
      </td>
      <td class="pull-request-status-col">
        <span class="worktree-prs">
          <span class="worktree-pr" data-state=${pr.state}><span aria-hidden="true">${pullRequestStateIcon(pr.state)}</span>${pr.state === "draft" ? "Draft" : "Open"}</span>
          ${pr.checks ? status(CHECKS[pr.checks].label, CHECKS[pr.checks].tone) : nothing}
          ${pr.reviewDecision ? status(DECISIONS[pr.reviewDecision].label, DECISIONS[pr.reviewDecision].tone) : nothing}
        </span>
      </td>
      <td class="worktree-sessions-col">${renderSessions(props, pr)}</td>
      <td class="pull-request-updated-col" title=${pr.updatedAt}>${formatUpdated(pr.updatedAt)}</td>
      <td class="pull-request-actions-col">${props.tab === "created" ? renderCreatedActions(props, pr) : renderAssessAction(props, pr)}</td>
    </tr>
  `)}`;
}

function notice(props: PullRequestsPageProps) {
  const data = props.data;
  const sent = props.sendNotice
    ? html`<div class="callout ${props.sendNotice.tone === "ok" ? "success" : "danger"}" role=${props.sendNotice.tone === "ok" ? "status" : "alert"}>${props.sendNotice.text}</div>`
    : nothing;
  return html`${sent}${loadNotice(props, data)}`;
}

function loadNotice(props: PullRequestsPageProps, data: MyPullRequests | undefined) {
  if (props.error && data) return html`<div class="callout warning" role="alert">${props.error}</div>`;
  if (!data?.error) return nothing;
  const updated = data.fetchedAt ? ` Showing the list from ${formatUpdated(data.fetchedAt)}.` : "";
  const signedOut = SIGNED_OUT[data.error];
  if (signedOut) {
    return html`<div class="callout warning" role="alert">${signedOut}.${updated} ${settingsLink(props, "Open Settings → Integrations")}</div>`;
  }
  return html`<div class="callout warning" role="alert">GitHub could not be reached.${updated}</div>`;
}

export function renderPullRequestsPage(props: PullRequestsPageProps): TemplateResult {
  const created = props.data?.created ?? [];
  const reviewRequested = props.data?.reviewRequested ?? [];
  const rows = props.tab === "created" ? created : reviewRequested;
  const linked = rows.filter((pr) => pr.sessions.length).length;
  return html`
    <section class="settings-workspace hui-workspace-page sessions-workspace worktrees-workspace pull-requests-workspace">
      <header class="content-header content-header--settings content-header--page hub-page-header sessions-hub-header">
        <div class="hub-page-header__title">
          <div class="page-title">Pull Requests</div>
          <div class="page-subtitle">Open and draft pull requests on github.com that you authored or that await your review, with the HUI sessions that created them or are on their branch.</div>
        </div>
        <div class="hub-page-header__tabs">
          <div class="settings-segmented" role="group" aria-label="Pull request lists">
            ${([["created", "Created by me", created.length], ["reviewRequested", "Review requested", reviewRequested.length]] as const).map(([tab, label, count]) => html`
              <button type="button" class="settings-segmented__btn ${props.tab === tab ? "settings-segmented__btn--active" : ""}"
                aria-pressed=${String(props.tab === tab)} aria-controls="pull-requests-panel" @click=${() => props.onTab(tab)}>${label}${props.data ? html` <span class="settings-count">${count}</span>` : nothing}</button>
            `)}
          </div>
        </div>
        <div class="hub-page-header__actions">${renderAccounts(props)}</div>
      </header>
      <div class="settings-workspace__body" id="pull-requests-panel">
        <div class="settings-page settings-page--wide sessions-page">
          <section class="settings-section">
            <div class="settings-section__header">
              <div class="settings-section__copy">
                <h2 class="settings-section__heading">
                  ${props.tab === "created" ? "Created by me" : "Review requested"} <span class="settings-count">${rows.length}</span>
                  <span class="sessions-heading-facts">
                    <span class="sessions-heading-fact"><strong>${linked}</strong> With a session</span>
                    ${props.data?.fetchedAt ? html`<span class="sessions-heading-fact__separator" aria-hidden="true">·</span>
                      <span class="sessions-heading-fact" title=${props.data.fetchedAt}>Updated ${formatUpdated(props.data.fetchedAt)}</span>` : nothing}
                  </span>
                </h2>
              </div>
              <div class="settings-section__actions">
                <button type="button" class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>${icons.refresh} ${props.loading && props.data ? "Refreshing…" : "Refresh"}</button>
              </div>
            </div>
            ${notice(props)}
            ${props.tab === "reviewRequested" ? renderAutoApprove(props) : nothing}
            <div class="settings-group">
              <div class="sessions-toolbar sessions-filter-bar" aria-label="Pull request filters">
                <label class="data-table-search sessions-toolbar__search">
                  ${icons.search}
                  <input type="search" aria-label="Filter pull requests" placeholder="Filter by repository, number, title, branch…"
                    .value=${props.query} @input=${(event: Event) => props.onQuery((event.target as HTMLInputElement).value)} />
                </label>
              </div>
              ${props.tab === "created" && created.length ? renderCreatedFilters(props, created) : nothing}
              <div class="data-table-container">
                <table class="data-table sessions-table worktrees-table pull-requests-table">
                  <thead>
                    <tr>
                      <th class="data-table-key-col">Pull request</th>
                      <th class="pull-request-status-col">Status</th>
                      <th class="worktree-sessions-col">Sessions</th>
                      <th class="pull-request-updated-col">Updated</th>
                      <th class="pull-request-actions-col"><span class="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>${body(props, rows)}</tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
      ${renderVerdictDrawer(props)}
      ${renderApproveDialog(props)}
    </section>
  `;
}
