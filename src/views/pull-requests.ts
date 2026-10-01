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
  /** URL whose risk-review action (assess, approve, dismiss, keep) is running. */
  reviewing: string;
  /** URL whose approval waits in the confirmation dialog. */
  approveConfirm: string;
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

export type ReviewCommentsAction = {
  kind: "send" | "start";
  target?: MyPullRequestSession;
  count: number;
  /** Why the button is disabled. */
  disabled?: string;
};

/** What the Created row's review-comments button does for the picked session. */
export function reviewCommentsAction(pr: MyPullRequest, picked: string | undefined): ReviewCommentsAction {
  const target = pr.sessions.find((session) => session.id === picked) ?? pr.sessions[0];
  if (target) {
    const count = target.newComments ?? 0;
    return { kind: "send", target, count, ...(count ? {} : { disabled: `No new review comments since the last send to ${target.title}.` }) };
  }
  const count = pr.newComments ?? 0;
  const disabled = !pr.localCheckout
    ? `No local checkout of ${pr.repository} is known. Start a session in a checkout of it first.`
    : count ? undefined : "No open review comments by others.";
  return { kind: "start", count, ...(disabled ? { disabled } : {}) };
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

function renderCommentsAction(props: PullRequestsPageProps, pr: MyPullRequest) {
  const action = reviewCommentsAction(pr, props.targets[pr.url]);
  const sending = props.sending === pr.url;
  const tooltip = action.disabled ?? (action.kind === "send"
    ? `Send ${action.count} new review ${action.count === 1 ? "comment" : "comments"} to ${action.target!.title}`
    : `Start a session on ${pr.headRefName} with ${action.count} review ${action.count === 1 ? "comment" : "comments"}`);
  const label = sending ? "Sending…" : action.kind === "send" ? `Review comments (${action.count})` : "Start session with comments";
  return html`<span class="worktree-actions pull-request-actions">
    ${pr.sessions.length > 1 ? html`<select class="pull-request-target" aria-label=${`Session for review comments on ${pullRequestReference(pr)}`}
      .value=${action.target?.id ?? ""} ?disabled=${Boolean(props.sending)}
      @change=${(event: Event) => props.onTarget(pr.url, (event.target as HTMLSelectElement).value)}>
      ${pr.sessions.map((session) => html`<option value=${session.id} ?selected=${session.id === action.target?.id}>${session.title}${session.archived ? " (archived)" : ""}</option>`)}
    </select>` : nothing}
    <span class="worktree-tooltip-wrap" data-hui-tooltip=${tooltip}>
      <button type="button" class="btn btn--sm" data-review-comments=${action.kind}
        ?disabled=${Boolean(action.disabled) || Boolean(props.sending)}
        @click=${() => props.onSendComments(pr, action.target?.id)}>${label}</button>
    </span>
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
  if (assessment.state === "assessing") {
    return html`<span class="worktree-actions pull-request-actions">
      <span class="pull-request-assessing" role="status">${status("Assessing…", "warn")}</span>${openSessionLink(props, assessment.sessionId)}
    </span>`;
  }
  const verdict = assessment.verdict;
  return html`<span class="worktree-actions pull-request-actions">${verdict ? status(RISKS[verdict.risk].label, RISKS[verdict.risk].tone) : status("No verdict", "muted")}</span>`;
}

/** The verdict card (or "No verdict") under a Review requested row. */
function renderVerdictRow(props: PullRequestsPageProps, pr: MyPullRequest, columns: number) {
  const assessment = pr.assessment;
  if (!assessment || assessment.state === "assessing") return nothing;
  const verdict = assessment.verdict;
  const disabled = Boolean(props.reviewing);
  const busy = props.reviewing === pr.url;
  return html`<tr class="pull-request-verdict-row" data-pull-request-verdict=${pr.url}>
    <td colspan=${columns}>
      <div class="pull-request-verdict" data-risk=${verdict?.risk ?? "none"} aria-label=${`Risk review of ${pullRequestReference(pr)}`}>
        ${verdict ? html`
          <div class="pull-request-verdict__head">${status(RISKS[verdict.risk].label, RISKS[verdict.risk].tone)}<p class="pull-request-verdict__summary">${verdict.summary}</p></div>
          ${verdict.reasons.length ? html`<ul class="pull-request-verdict__reasons">${verdict.reasons.map((reason) => html`<li>${reason}</li>`)}</ul>` : nothing}
          ${verdict.focusAreas?.length ? html`<div class="pull-request-verdict__focus"><span class="muted">Look closely at</span>
            <ul>${verdict.focusAreas.map((area) => html`<li><bdi class="mono">${area.path}</bdi> — ${area.note}</li>`)}</ul></div>` : nothing}
        ` : html`<p class="pull-request-verdict__summary">No verdict. The review session finished without reporting a risk verdict.</p>`}
        <div class="pull-request-verdict__actions">
          ${verdict ? html`<button type="button" class="btn btn--sm primary" data-approve ?disabled=${disabled} @click=${() => props.onAskApprove(pr)}>Approve</button>` : nothing}
          <span class="worktree-tooltip-wrap" data-hui-tooltip="Delete the temporary session and its transcript">
            <button type="button" class="btn btn--sm" data-dismiss ?disabled=${disabled} @click=${() => props.onDismiss(pr)}>Dismiss</button>
          </span>
          <span class="worktree-tooltip-wrap" data-hui-tooltip="Keep the review as a normal session">
            <button type="button" class="btn btn--sm" data-keep ?disabled=${disabled} @click=${() => props.onKeep(pr)}>Keep</button>
          </span>
          ${openSessionLink(props, assessment.sessionId)}
          ${busy ? html`<span class="muted" role="status">Working…</span>` : nothing}
        </div>
      </div>
    </td>
  </tr>`;
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

function body(props: PullRequestsPageProps, rows: readonly MyPullRequest[]): TemplateResult {
  const columns = 5;
  if (props.loading && !props.data) return emptyRow("Loading pull requests…", "Asking GitHub for your open pull requests.", "status", columns);
  if (props.error && !props.data) return emptyRow(props.error, "The pull requests could not be loaded.", "alert", columns);
  const signedOut = props.data?.error ? SIGNED_OUT[props.data.error] : undefined;
  if (signedOut && rows.length === 0) {
    return emptyRow(signedOut, html`${settingsLink(props, "Connect GitHub in Settings → Integrations")} to list your pull requests.`, "alert", columns);
  }
  const matching = matchingPullRequests(rows, props.query);
  if (matching.length === 0) {
    return props.query.trim()
      ? emptyRow("No matching pull requests", "Try another repository, number, title or branch.", "status", columns)
      : emptyRow(
        props.tab === "created" ? "No open pull requests" : "No reviews requested",
        html`Nothing is open for this GitHub account. Check the account in ${settingsLink(props, "Settings → Integrations")}.`,
        "status",
        columns,
      );
  }
  return html`${matching.map((pr) => html`
    <tr class="session-data-row pull-request-row" data-pull-request=${pr.url}>
      <td class="data-table-key-col">
        <div class="session-key-cell">
          <span class="session-avatar session-avatar--direct" aria-hidden="true">${pullRequestStateIcon(pr.state)}</span>
          <span class="session-key-cell__text">
            <span class="session-key-cell__primary">
              <a class="worktree-branch pull-request-title" href=${pr.url} target="_blank" rel="noopener noreferrer">${pr.title || pullRequestReference(pr)}</a>
            </span>
            <span class="muted session-key-display-name">
              <span class="mono">${pullRequestReference(pr)}</span> · <bdi class="mono">${pr.headRefName}</bdi>${pr.author && props.tab === "reviewRequested" ? ` · ${pr.author}` : ""}
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
      <td title=${pr.updatedAt}>${formatUpdated(pr.updatedAt)}</td>
      <td class="pull-request-actions-col">${props.tab === "created" ? renderCommentsAction(props, pr) : renderAssessAction(props, pr)}</td>
    </tr>
    ${props.tab === "reviewRequested" ? renderVerdictRow(props, pr, columns) : nothing}
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
        <div class="hub-page-header__actions"></div>
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
            <div class="settings-group">
              <div class="sessions-toolbar sessions-filter-bar" aria-label="Pull request filters">
                <label class="data-table-search sessions-toolbar__search">
                  ${icons.search}
                  <input type="search" aria-label="Filter pull requests" placeholder="Filter by repository, number, title, branch…"
                    .value=${props.query} @input=${(event: Event) => props.onQuery((event.target as HTMLInputElement).value)} />
                </label>
              </div>
              <div class="data-table-container">
                <table class="data-table sessions-table worktrees-table pull-requests-table">
                  <thead>
                    <tr>
                      <th class="data-table-key-col">Pull request</th>
                      <th class="pull-request-status-col">Status</th>
                      <th class="worktree-sessions-col">Sessions</th>
                      <th>Updated</th>
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
      ${renderApproveDialog(props)}
    </section>
  `;
}
