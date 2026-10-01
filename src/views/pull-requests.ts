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
  type PullRequestChecks,
  type PullRequestReviewDecision,
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
};

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

function emptyRow(message: string, description: TemplateResult | string, kind: "status" | "alert") {
  return html`<tr>
    <td colspan="4" class="data-table-empty-cell">
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

function body(props: PullRequestsPageProps, rows: readonly MyPullRequest[]): TemplateResult {
  if (props.loading && !props.data) return emptyRow("Loading pull requests…", "Asking GitHub for your open pull requests.", "status");
  if (props.error && !props.data) return emptyRow(props.error, "The pull requests could not be loaded.", "alert");
  const signedOut = props.data?.error ? SIGNED_OUT[props.data.error] : undefined;
  if (signedOut && rows.length === 0) {
    return emptyRow(signedOut, html`${settingsLink(props, "Connect GitHub in Settings → Integrations")} to list your pull requests.`, "alert");
  }
  const matching = matchingPullRequests(rows, props.query);
  if (matching.length === 0) {
    return props.query.trim()
      ? emptyRow("No matching pull requests", "Try another repository, number, title or branch.", "status")
      : emptyRow(
        props.tab === "created" ? "No open pull requests" : "No reviews requested",
        html`Nothing is open for this GitHub account. Check the account in ${settingsLink(props, "Settings → Integrations")}.`,
        "status",
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
    </tr>
  `)}`;
}

function notice(props: PullRequestsPageProps) {
  const data = props.data;
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
                    </tr>
                  </thead>
                  <tbody>${body(props, rows)}</tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;
}
