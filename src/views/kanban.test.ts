import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_KANBAN_OPTIONS } from "../lib/kanban.ts";
import type { KanbanPageProps } from "./kanban.ts";

/** A Lit template's markup, with bound values written out. */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + markup(template.values[i])).join("");
  }
  if (value && typeof value === "object" && "_$litDirective$" in value && "values" in value) {
    const values = (value as { values: unknown[] }).values;
    const [items, , template] = values;
    if (Array.isArray(items) && typeof template === "function") return markup(items.map((item, index) => (template as (item: unknown, index: number) => unknown)(item, index)));
    return markup(values);
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
}

/** The board with one session card; handlers are inert and unlisted props absent. */
async function renderBoard(pullRequests: KanbanPageProps["groups"][number]["sessions"][number]["pullRequests"]): Promise<string> {
  const { renderKanbanPage } = await import("./kanban.ts");
  const now = new Date().toISOString();
  const props = {
    groups: [{ label: "Group", sessions: [{
      id: "session-1", title: "Ship the checkout", group: "", cwd: "/repo", displayCwd: "/repo",
      tool: "durable", status: "idle", stage: "implementation", stageOrigin: "agent", createdAt: now, updatedAt: now,
      pullRequests,
    }] }],
    loading: false, error: "", query: "", options: DEFAULT_KANBAN_OPTIONS, movePendingId: "", draggingId: "", dropTarget: "",
    backlog: [], backlogLoading: false, backlogError: "", backlogJira: { status: "unconfigured" }, backlogPendingId: "",
  } as unknown as KanbanPageProps;
  return markup(renderKanbanPage(props)).replace(/\s+/gu, " ");
}

test("a card draws one state-colored chip per pull request instead of a count", async () => {
  const html = await renderBoard([
    { repository: "acme/web", number: 12, url: "https://github.com/acme/web/pull/12", state: "open", title: "Ship the checkout" },
    { repository: "acme/web", number: 13, url: "https://github.com/acme/web/pull/13", state: "merged" },
  ]);
  assert.match(html, /aria-label=2 pull requests/u);
  assert.match(html, /class="session-pr-badge kanban-card__pr" data-state=open href=https:\/\/github.com\/acme\/web\/pull\/12/u);
  assert.match(html, /aria-label=Pull request acme\/web#12, open: Ship the checkout/u);
  assert.match(html, /<span class="kanban-card__pr-number">#12<\/span>/u);
  assert.match(html, /class="session-pr-badge kanban-card__pr" data-state=merged href=https:\/\/github.com\/acme\/web\/pull\/13/u);
  assert.match(html, /<span class="kanban-card__pr-number">#13<\/span>/u);
  assert.doesNotMatch(html, /PRs ·|1 PR/u, "the count label is gone");

  const none = await renderBoard(undefined);
  assert.doesNotMatch(none, /kanban-card__prs/u);
});

test("every checkbox menu item hides the native checkmark so only one tick shows", () => {
  const source = readFileSync(new URL("./kanban.ts", import.meta.url), "utf8");
  const items = source.match(/<wa-dropdown-item[^>]*type="checkbox"[^>]*>/gu) ?? [];
  assert.ok(items.length >= 2);
  for (const item of items) assert.match(item, /sidebar-session-sort-menu__item/u, item);
});
