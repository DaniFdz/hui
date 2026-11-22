/**
 * The drawn cost of a surface against the history it is given. Each PR that fixed a surface whose drawing grew with
 * its conversation (#22, #23, #52, #53, #94, #104, #152, #194) got a one-off test; this file measures the growth
 * itself, so removing a cap or a laziness fails here and names the surface with both numbers. What a custom directive
 * draws itself, such as the position rail, is not in this template tree and is not counted here.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { HUI_PAGES } from "../lib/pages.ts";
import { DEFAULT_SIDEBAR_SESSION_OPTIONS } from "../lib/session/sidebar-sessions.ts";
import { TRANSCRIPT_WINDOW_ROWS } from "../lib/chat-projection.ts";
import { renderSidebar } from "./shell.ts";
import type { SessionView } from "../api/sessions.ts";

/**
 * What a surface draws, not what it holds. This suite has no DOM, so the count is the elements a view authored in its
 * template tree (`markup`), never `querySelectorAll` results: a row absent from the tree is not drawn.
 */
const elements = (text: string): number => text.match(/<[a-z][\w-]*/gu)?.length ?? 0;

/** Ten times the history may draw this much more: a surface draws what the page shows, never the conversation. */
const DRAWN_ELEMENT_GROWTH = 1.25;

/** A Lit template's markup, with bound values written out. */
function markup(value: unknown): string {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && typeof value === "object" && "strings" in value && "values" in value) {
    const template = value as { strings: readonly string[]; values: unknown[] };
    return template.strings.map((part, i) => part + markup(template.values[i])).join("");
  }
  // A directive's arguments, such as the HTML `unsafeHTML` renders, or each item `repeat` renders.
  if (value && typeof value === "object" && "_$litDirective$" in value && "values" in value) {
    const values = (value as { values: unknown[] }).values;
    const [items, , template] = values;
    if (Array.isArray(items) && typeof template === "function") return markup(items.map((item, index) => (template as (item: unknown, index: number) => unknown)(item, index)));
    return markup(values);
  }
  return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
}

/** A surface whose drawn element count grew with the history it was given, naming both sizes it drew. */
function assertFlat(surface: string, small: { label: string; drawn: number }, large: { label: string; drawn: number }): void {
  assert.ok(large.drawn <= small.drawn * DRAWN_ELEMENT_GROWTH,
    `${surface} grew: ${small.label} drew ${small.drawn} elements, ${large.label} drew ${large.drawn} (bound ${DRAWN_ELEMENT_GROWTH}×; a surface draws what the page shows, never the conversation)`);
}

/** A conversation's markup, rendered with the chat props an idle session gets and `overrides` for a caller that
 * brings its own transcript or expanded groups. */
async function renderChat(transcript: readonly unknown[], overrides: Record<string, unknown> = {}): Promise<string> {
  const { renderHome } = await import("./home.ts");
  const props: Record<string, unknown> = {
    session: { id: "s", title: "Build", group: "", cwd: "/repo", displayCwd: "devbox:/repo", tool: "durable", status: "idle", worker: { id: "w", name: "devbox" } },
    transcript, subagents: [], draft: "", attachments: [],
    connection: "live", connectionNote: "", queue: { steering: [], followUp: [] }, models: [], expandedActivityIds: new Set(),
    goalPanel: { expanded: false, editing: false, error: "" },
    chatPreferences: { collapseTaskProgress: false, sendShortcut: "enter", githubEmbeds: false, datadogEmbeds: false, toolMarks: {}, toolIcons: {} },
    commandMenu: { open: false, commands: [], activeIndex: 0, paths: [] }, localPathMenu: { open: false, paths: [], activeIndex: 0 },
    findSession: () => undefined,
    ...overrides,
  };
  const inert = new Proxy(props, { get: (target, key) => key in target ? target[key as string] : typeof key === "string" && key.startsWith("on") ? () => {} : undefined });
  return markup(renderHome(inert as unknown as import("./home.ts").HomeProps)).replace(/\s+/gu, " ");
}

/** A durable conversation of whole turns. A turn holds four entries, so a caller passes a multiple of four and the
 * fixture holds exactly the entry count it names. */
async function renderConversation(entries: number): Promise<string> {
  const turns = entries / 4;
  const transcript = Array.from({ length: turns }, (_, turn) => [
    { kind: "message", id: `u${turn}`, role: "user", text: `Step ${turn}` },
    ...Array.from({ length: 2 }, (_, call) => ({ kind: "tool", id: `t${turn}-${call}`, name: "bash", status: "succeeded", args: { command: `echo step-${turn}-${call}` }, output: `step-${turn}-${call}` })),
    { kind: "message", id: `a${turn}`, role: "assistant", text: `Done ${turn}` },
  ]).flat();
  return renderChat(transcript);
}

function session(id: string, title: string, group: string): SessionView {
  return {
    id,
    title,
    group,
    cwd: `/work/${group}`,
    tool: "pi",
    status: "idle",
    displayCwd: "",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  } as SessionView;
}

/** `shell.ts` remembers each row whose menu was ever drawn, so every render gets ids of its own. */
let renders = 0;

/** The groups sidebar: one group of `count` rows, the row at `openRow` (when named) showing its actions menu. */
function sidebarHtml(count: number, openRow?: number): string {
  const tag = `r${renders++}-`;
  const sessions = Array.from({ length: count }, (_, index) => session(`${tag}${index}`, `Session ${index}`, "Work"));
  const data = {
    view: "home", pages: HUI_PAGES, selectedSessionId: "", splitSessionId: "", groups: [{ label: "Work", sessions }],
    draftSessionIds: new Set(), collapsed: new Set(), toggledSessionTrees: new Set(), loading: false, error: "",
    importNote: "", importFailed: false, search: "", sessionOptions: DEFAULT_SIDEBAR_SESSION_OPTIONS,
    menuFor: openRow === undefined ? "" : `${tag}${openRow}`,
    groupMenuFor: "", draggingSessionId: "", sessionDropTarget: "", sessionMovePendingId: "", draggingGroup: "",
    groupDropTarget: undefined, groupReorderPending: false,
    bots: { tab: "agents", search: "", workers: [], creating: false, unread: false, roster: { bots: [] } },
  };
  return markup(renderSidebar(data as unknown as Parameters<typeof renderSidebar>[0]));
}

test("a conversation draws the same elements at 200, 400 and 2,000 entries", async () => {
  const small = await renderConversation(200);
  const medium = await renderConversation(400);
  const large = await renderConversation(2_000);
  assertFlat("the transcript", { label: "200 entries", drawn: elements(small) }, { label: "400 entries", drawn: elements(medium) });
  assertFlat("the transcript", { label: "200 entries", drawn: elements(small) }, { label: "2,000 entries", drawn: elements(large) });
  // The window is what caps the drawing: letting the cap drift must show up here, not silently make this vacuous.
  for (const [label, html] of [["200 entries", small], ["400 entries", medium], ["2,000 entries", large]] as const) {
    assert.equal(html.split("data-chat-row-key=").length - 1, TRANSCRIPT_WINDOW_ROWS, `${label}: the transcript window, not the history, decides how many rows are drawn`);
  }
});

test("a closed tool group draws its header however many calls it holds", async () => {
  const group = async (calls: number, expanded: ReadonlySet<string> = new Set()) => {
    const transcript = [
      { kind: "message", id: "u", role: "user", text: "go" },
      ...Array.from({ length: calls }, (_, index) => ({ kind: "tool", id: `t${index}`, name: "bash", status: "succeeded", args: { command: `echo step-${index}` }, output: `step-${index}` })),
      { kind: "message", id: "a", role: "assistant", text: "Done" },
    ];
    return renderChat(transcript, { expandedActivityIds: expanded });
  };
  const four = await group(4);
  const sixtyFour = await group(64);
  assertFlat("a closed activity group", { label: "4 calls", drawn: elements(four) }, { label: "64 calls", drawn: elements(sixtyFour) });
  // The header is the whole drawing, so the flat count above cannot pass on rows that were never there.
  assert.doesNotMatch(four, /tool-call-row/u, "a closed group draws none of its calls");
  assert.doesNotMatch(sixtyFour, /tool-call-row/u, "a closed group draws none of its calls");
  // Closed is flat; opening pays for what the reader asked for. The call list is the row's own class: each drawn row
  // also repeats `tool-call-row` in its toggle, icon, title, status and chevron classes.
  const open = await group(64, new Set(["s:t0"]));
  assert.equal(open.split('class="tool-call-row"').length - 1, 64, "opening the group draws every call it holds");
});

test("a session row draws the same elements however long the list is, and only its open row draws the menu", () => {
  const drawn = (count: number) => elements(sidebarHtml(count));
  const perRow = (from: number, to: number) => (drawn(to) - drawn(from)) / (to - from);
  const near = perRow(100, 200);
  const far = perRow(200, 400);
  assert.ok(far <= near * DRAWN_ELEMENT_GROWTH,
    `the session list grew: 100→200 rows cost ${near} elements per row, 200→400 rows cost ${far} (bound ${DRAWN_ELEMENT_GROWTH}×; a surface draws what the page shows, never the conversation)`);
  // What one row's open menu adds, measured against the same list closed.
  const openCost = (count: number) => elements(sidebarHtml(count, 0)) - elements(sidebarHtml(count));
  const open100 = openCost(100);
  const open200 = openCost(200);
  assert.ok(open200 <= open100 * DRAWN_ELEMENT_GROWTH,
    `a session row's menu grew: 100 rows cost ${open100} elements to open one, 200 rows cost ${open200} (bound ${DRAWN_ELEMENT_GROWTH}×; a surface draws what the page shows, never the conversation)`);
  // The menu measurement is anchored to real menu content: none closed, one row's items once it opens.
  assert.doesNotMatch(sidebarHtml(100), /value="pin"/u, "a closed row draws no menu items");
  assert.equal(sidebarHtml(100, 0).split('value="pin"').length - 1, 1, "exactly the open row draws its menu");
});
