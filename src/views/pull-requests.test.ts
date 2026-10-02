import assert from "node:assert/strict";
import test from "node:test";

import type { TemplateResult } from "lit";

import type { MyPullRequest, MyPullRequests } from "../../shared/pull-requests.ts";
import { normalizePullRequestRepos } from "../lib/my-pull-requests.ts";
import {
  approveConfirmation,
  createdActions,
  filteredCreated,
  matchingPullRequests,
  renderPullRequestsPage,
  renderVerdictDrawer,
  repositoryChips,
  riskPill,
  toggledAccounts,
  triageBucket,
  type PullRequestsPageProps,
} from "./pull-requests.ts";

function pr(number: number, patch: Partial<MyPullRequest> = {}): MyPullRequest {
  return {
    repository: "acme/web", number, url: `https://github.com/acme/web/pull/${number}`, title: `PR ${number}`, state: "open",
    headRefName: "main", baseRefName: "main", updatedAt: "2026-09-30T00:00:00Z", sessions: [], accounts: ["me"], ...patch,
  };
}

test("pull request filter matches repository, number, title and branch", () => {
  const rows = [pr(12, { title: "Fix drawer" }), pr(7, { repository: "acme/api", headRefName: "feat/login" })];
  assert.deepEqual(matchingPullRequests(rows, "").map((row) => row.number), [12, 7]);
  assert.deepEqual(matchingPullRequests(rows, "DRAWER").map((row) => row.number), [12]);
  assert.deepEqual(matchingPullRequests(rows, "acme/api").map((row) => row.number), [7]);
  assert.deepEqual(matchingPullRequests(rows, "#12").map((row) => row.number), [12]);
  assert.deepEqual(matchingPullRequests(rows, "web#7").map((row) => row.number), []);
  assert.deepEqual(matchingPullRequests(rows, "feat/login").map((row) => row.number), [7]);
});

test("Created actions are only the usable ones: comments, start session, Fix CI", () => {
  const sessions = [{ id: "a", title: "A", archived: false, newComments: 2 }, { id: "b", title: "B", archived: false, newComments: 0, ciFixSent: true }];
  const kinds = (row: MyPullRequest, picked?: string) => createdActions(row, picked).actions.map((action) => action.label);
  assert.deepEqual(kinds(pr(1, { sessions, newComments: 3 })), ["Review comments (2)"]);
  assert.equal(createdActions(pr(1, { sessions }), undefined).target?.id, "a");
  assert.deepEqual(kinds(pr(1, { sessions, newComments: 3 }), "b"), [], "nothing new for B and green checks: no buttons");
  assert.equal(createdActions(pr(1, { sessions }), "gone").target?.id, "a", "a stale pick falls back to the default");
  assert.deepEqual(kinds(pr(1, { newComments: 3, localCheckout: true })), ["Start session with comments"]);
  assert.deepEqual(kinds(pr(1, { newComments: 3, localCheckout: false })), [], "no known checkout: nothing to start");
  assert.deepEqual(kinds(pr(1, { newComments: 0, localCheckout: true })), []);
  const failing = { checks: "failure" as const, failingChecks: [{ name: "unit", state: "failure" }] };
  assert.deepEqual(kinds(pr(1, { ...failing, sessions, newComments: 3 })), ["Review comments (2)", "Fix CI"]);
  assert.deepEqual(kinds(pr(1, { ...failing, sessions }), "b"), ["Fix CI (sent)"], "sent for this head");
  assert.match(createdActions(pr(1, { ...failing, sessions }), "a").actions[1]?.tooltip ?? "", /Send 1 failing check to A/u);
  assert.deepEqual(kinds(pr(1, { checks: "error", localCheckout: true })), ["Fix CI"]);
  assert.match(createdActions(pr(1, { checks: "error", localCheckout: true }), undefined).actions[0]?.tooltip ?? "", /Start a session on main to fix the failing checks/u);
  assert.deepEqual(kinds(pr(1, { checks: "failure" })), [], "no session and no checkout");
  assert.deepEqual(kinds(pr(1, { checks: "pending", sessions })), ["Review comments (2)"]);
});

test("every Created row falls in exactly one triage bucket", () => {
  const session = (newComments: number) => ({ id: `s${newComments}`, title: "S", archived: false, newComments });
  assert.equal(triageBucket(pr(1, { state: "draft", checks: "failure", reviewDecision: "changes_requested" })), "drafts", "drafts are only drafts");
  assert.equal(triageBucket(pr(1, { checks: "failure", reviewDecision: "approved" })), "needsYou");
  assert.equal(triageBucket(pr(1, { checks: "error" })), "needsYou");
  assert.equal(triageBucket(pr(1, { reviewDecision: "changes_requested", checks: "success" })), "needsYou");
  assert.equal(triageBucket(pr(1, { newComments: 2 })), "needsYou", "comments no session received");
  assert.equal(triageBucket(pr(1, { newComments: 2, sessions: [session(0)] })), "waiting", "already sent to a linked session");
  assert.equal(triageBucket(pr(1, { newComments: 2, sessions: [session(2)] })), "needsYou");
  assert.equal(triageBucket(pr(1, { newComments: 2, reviewDecision: "approved", checks: "success" })), "needsYou", "needs you wins");
  assert.equal(triageBucket(pr(1, { reviewDecision: "approved", checks: "success" })), "ready");
  assert.equal(triageBucket(pr(1, { reviewDecision: "approved" })), "ready", "approved without checks");
  assert.equal(triageBucket(pr(1, { reviewDecision: "approved", checks: "pending" })), "waiting", "approved but checks still running");
  assert.equal(triageBucket(pr(1, { reviewDecision: "review_required", checks: "success" })), "waiting");
  assert.equal(triageBucket(pr(1, { checks: "expected" })), "waiting");
  assert.equal(triageBucket(pr(1)), "waiting");
});

test("repository chips count rows, most first, short names unless owners collide", () => {
  const rows = [
    pr(1, { repository: "acme/web" }), pr(2, { repository: "acme/web" }), pr(3, { repository: "acme/billing" }),
    pr(4, { repository: "acme/api" }), pr(5, { repository: "fork/api" }),
  ];
  assert.deepEqual(repositoryChips(rows), [
    { repository: "acme/web", count: 2, label: "web" },
    { repository: "acme/api", count: 1, label: "acme/api" },
    { repository: "acme/billing", count: 1, label: "billing" },
    { repository: "fork/api", count: 1, label: "fork/api" },
  ]);
});

test("Created filters combine triage, repositories and search; unknown repositories are ignored", () => {
  const rows = [
    pr(1, { repository: "acme/web", checks: "failure", updatedAt: "2026-09-01T00:00:00Z" }),
    pr(2, { repository: "acme/web", state: "draft", updatedAt: "2026-09-03T00:00:00Z" }),
    pr(3, { repository: "acme/api", reviewDecision: "approved", checks: "success", updatedAt: "2026-09-02T00:00:00Z", title: "Ship login" }),
    pr(4, { repository: "acme/api", updatedAt: "2026-09-04T00:00:00Z" }),
  ];
  const all = filteredCreated(rows, { triage: "all", repos: [], query: "" });
  assert.deepEqual(all.rows.map((row) => row.number), [4, 2, 3, 1], "newest update first");
  assert.deepEqual(all.counts, { all: 4, needsYou: 1, waiting: 1, ready: 1, drafts: 1 });
  const api = filteredCreated(rows, { triage: "all", repos: ["acme/api", "gone/repo"], query: "" });
  assert.deepEqual(api.rows.map((row) => row.number), [4, 3]);
  assert.deepEqual(api.repos, ["acme/api"], "a persisted repository no longer listed is ignored");
  assert.deepEqual(api.counts, { all: 2, needsYou: 0, waiting: 1, ready: 1, drafts: 0 });
  assert.deepEqual(filteredCreated(rows, { triage: "ready", repos: ["acme/api"], query: "" }).rows.map((row) => row.number), [3]);
  assert.deepEqual(filteredCreated(rows, { triage: "waiting", repos: ["acme/api"], query: "login" }).rows, []);
  assert.deepEqual(filteredCreated(rows, { triage: "all", repos: ["gone/repo"], query: "" }).rows.length, 4, "none left means all");
  assert.deepEqual(normalizePullRequestRepos(["acme/web", "acme/web", 7, "not a repo", "a/b/c"]), ["acme/web"]);
  assert.deepEqual(normalizePullRequestRepos(null), []);
});

test("the approval dialog names the pull request and the verdict it rests on", () => {
  const verdict = { risk: "high" as const, summary: "Rewrites auth.", reasons: [] };
  const copy = approveConfirmation(pr(3, { title: "Token refresh", assessment: { sessionId: "s", state: "verdict", verdict } }));
  assert.equal(copy.title, "Approve acme/web#3?");
  assert.match(copy.detail, /“Token refresh”/u);
  assert.match(copy.detail, /rated it high risk: Rewrites auth\./u);
});

/** The markup a template would render, with its values inlined (no DOM). */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value) {
    const template = value as TemplateResult;
    return template.strings.map((part, index) => part + (index < template.values.length ? markup(template.values[index]) : "")).join("");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const verdict = {
  risk: "medium" as const, summary: "Touches token refresh.", reasons: ["No test for expiry"],
  focusAreas: [{ path: "src/auth/refresh.ts", note: "retry loop" }],
};

function page(rows: MyPullRequest[], patch: Partial<PullRequestsPageProps> = {}): PullRequestsPageProps {
  const noop = () => {};
  const data: MyPullRequests = { created: [], reviewRequested: rows, pending: false, accounts: ["me", "alt"], selectedAccounts: ["me"], autoApproved: [] };
  return {
    data, loading: false, error: "", query: "", tab: "reviewRequested", onQuery: noop, onTab: noop, onRefresh: noop, onOpenSession: noop,
    onOpenSettings: noop, targets: {}, sending: "", onTarget: noop, onSendComments: noop, reviewing: "", approveConfirm: "",
    fixing: "", onFixCi: noop, triage: "all", onTriage: noop, repos: [], onRepos: noop,
    onAssess: noop, onAskApprove: noop, onCancelApprove: noop, onApprove: noop, onDismiss: noop, onKeep: noop,
    drawer: "", onOpenDrawer: noop, onCloseDrawer: noop, autoApprove: false, onAutoApprove: noop, selectedAccounts: ["me"], onAccounts: noop,
    ...patch,
  };
}

test("the actions cell shows only a risk pill; the verdict lives in the drawer", () => {
  assert.equal(riskPill(pr(1)), undefined);
  assert.deepEqual(riskPill(pr(1, { assessment: { sessionId: "s", state: "assessing" } })), { label: "Assessing…", tone: "warn" });
  assert.deepEqual(riskPill(pr(1, { assessment: { sessionId: "s", state: "no_verdict" } })), { label: "No verdict", tone: "muted" });
  assert.deepEqual(riskPill(pr(1, { assessment: { sessionId: "s", state: "verdict", verdict: { ...verdict, risk: "low" } } })), { label: "Low risk", tone: "ok" });
  const row = pr(3, { title: "Token refresh", assessment: { sessionId: "s", state: "verdict", verdict } });
  const closed = markup(renderPullRequestsPage(page([row])));
  assert.match(closed, /data-risk-pill=https:\/\/github.com\/acme\/web\/pull\/3/u);
  assert.match(closed, /Medium risk/u);
  assert.doesNotMatch(closed, /Touches token refresh|pull-request-drawer"/u, "no inline verdict card");
  assert.equal(markup(renderVerdictDrawer(page([row]))), "", "the drawer is closed");
});

test("the drawer shows the pull request, the verdict and its actions", () => {
  const row = pr(3, { title: "Token refresh", assessment: { sessionId: "s", state: "verdict", verdict, autoApproveBlocked: "Not auto-approved: PR changed since it was assessed — assess again." } });
  const drawer = markup(renderVerdictDrawer(page([row], { drawer: row.url })));
  assert.match(drawer, /<dialog class="pull-request-drawer"/u);
  assert.match(drawer, /acme\/web#3/u);
  assert.match(drawer, /href=https:\/\/github.com\/acme\/web\/pull\/3[^>]*>Token refresh</u);
  for (const text of ["Medium risk", "Touches token refresh.", "No test for expiry", "src/auth/refresh.ts", "retry loop", ">Approve<", ">Dismiss<", ">Keep<", "Open session", "Close the risk review", "PR changed since it was assessed"]) {
    assert.ok(drawer.includes(text), text);
  }
  const none = markup(renderVerdictDrawer(page([pr(4, { assessment: { sessionId: "s", state: "no_verdict" } })], { drawer: pr(4).url })));
  for (const text of ["No verdict", ">Dismiss<", ">Keep<", "Open session"]) assert.ok(none.includes(text), text);
  assert.doesNotMatch(none, />Approve</u);
  const assessing = markup(renderVerdictDrawer(page([pr(5, { assessment: { sessionId: "s", state: "assessing" } })], { drawer: pr(5).url })));
  assert.match(assessing, /Assessing…/u);
  assert.doesNotMatch(assessing, />Approve<|>Dismiss<|>Keep</u);
});

test("the accounts control keeps signed-in order and at least one account", () => {
  assert.deepEqual(toggledAccounts(["me", "alt", "third"], ["me"], "third", true), ["me", "third"]);
  assert.deepEqual(toggledAccounts(["me", "alt"], ["alt", "me"], "me", false), ["alt"]);
  assert.deepEqual(toggledAccounts(["me", "alt"], ["me"], "me", false), ["me"], "the last one stays");
  const rows = [pr(1, { accounts: ["me", "alt"] }), pr(2, { accounts: ["alt"] })];
  const header = markup(renderPullRequestsPage(page(rows, { selectedAccounts: ["me", "alt"], data: { ...page([]).data!, reviewRequested: rows, selectedAccounts: ["me", "alt"] } })));
  assert.match(header, /<legend>Accounts<\/legend>/u);
  assert.equal(header.match(/data-account=/gu)?.length, 1, "only rows the first account did not find carry a badge");
  assert.match(header, /data-account=alt>alt</u);
  assert.doesNotMatch(header, /As <|Requested of\s*<bdi/u, "no account line");
  assert.match(header, /Auto-approve low risk/u);
  assert.doesNotMatch(markup(renderPullRequestsPage(page([pr(1, { accounts: ["alt"] })]))), /data-account=/u, "one account: no badge");
});

test("Created rows render chips, one-line titles and no disabled actions", () => {
  const rows = [
    pr(1, { title: "A very long title", checks: "failure", localCheckout: true, repository: "acme/web", url: "https://github.com/acme/web/pull/1" }),
    pr(2, { repository: "acme/api", url: "https://github.com/acme/api/pull/2", newComments: 1 }),
  ];
  const html = markup(renderPullRequestsPage(page([], { tab: "created", data: { ...page([]).data!, created: rows, reviewRequested: [] } })));
  assert.match(html, /aria-label="Triage"/u);
  assert.match(html, /aria-label="Repositories"/u);
  assert.match(html, /title=A very long title>A very long title</u);
  assert.match(html, /data-created-action=fixCi/u);
  assert.equal(html.match(/data-created-action=/gu)?.length, 1, "acme/api has comments but no checkout or session: no button");
});
