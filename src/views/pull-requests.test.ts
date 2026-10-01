import assert from "node:assert/strict";
import test from "node:test";

import type { TemplateResult } from "lit";

import type { MyPullRequest, MyPullRequests } from "../../shared/pull-requests.ts";
import {
  approveConfirmation,
  matchingPullRequests,
  renderPullRequestsPage,
  renderVerdictDrawer,
  reviewCommentsAction,
  riskPill,
  toggledAccounts,
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

test("the review-comments action targets the picked session, else starts one where a checkout is known", () => {
  const sessions = [{ id: "a", title: "A", archived: false, newComments: 2 }, { id: "b", title: "B", archived: false, newComments: 0 }];
  assert.deepEqual(reviewCommentsAction(pr(1, { sessions, newComments: 3 }), undefined), { kind: "send", target: sessions[0], count: 2 });
  assert.deepEqual(reviewCommentsAction(pr(1, { sessions, newComments: 3 }), "b"), {
    kind: "send", target: sessions[1], count: 0, disabled: "No new review comments since the last send to B.",
  });
  assert.equal(reviewCommentsAction(pr(1, { sessions }), "gone").target?.id, "a", "a stale pick falls back to the default");
  assert.deepEqual(reviewCommentsAction(pr(1, { newComments: 3, localCheckout: true }), undefined), { kind: "start", count: 3 });
  assert.match(reviewCommentsAction(pr(1, { newComments: 3, localCheckout: false }), undefined).disabled ?? "", /No local checkout of acme\/web/);
  assert.match(reviewCommentsAction(pr(1, { newComments: 0, localCheckout: true }), undefined).disabled ?? "", /No open review comments/);
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
  const header = markup(renderPullRequestsPage(page([pr(1, { accounts: ["me", "alt"] })], { selectedAccounts: ["me", "alt"], data: { ...page([]).data!, reviewRequested: [pr(1, { accounts: ["me", "alt"] })], selectedAccounts: ["me", "alt"] } })));
  assert.match(header, /<legend>Accounts<\/legend>/u);
  assert.match(header, /data-account=alt/u, "rows name their accounts when several are listed");
  assert.match(header, /Auto-approve low risk/u);
  assert.doesNotMatch(markup(renderPullRequestsPage(page([pr(1)]))), /data-account=/u, "one account: no account chips");
});
