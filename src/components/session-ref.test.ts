/**
 * `<hui-session-ref>`: what one reference reads in chat, and the rule that decides when a chip is rebuilt, updated where
 * it stands or left alone. The element needs a DOM, so the tests below carry the small one it reads rather than a DOM
 * implementation added to the project's dependencies: a node's children, its text and a class selector.
 */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { publishSessionReferences } from "../lib/session/session-reference-store.ts";
import type { SessionGroup } from "../api/sessions.ts";

const ID = "195c3659-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "195c3659-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class FakeText {
  readonly nodeType = 3;
  constructor(readonly textContent: string) {}
}

type FakeChild = FakeNode | FakeText;

/** The test DOM: exactly the surface `components/session-ref.ts` reads — text, children, attributes, a class selector
 * and a node factory — plus a count of the times a child was replaced, which is how "left alone" is proved. */
class FakeNode {
  readonly nodeType = 1;
  readonly attributes = new Map<string, string>();
  readonly children: FakeChild[] = [];
  dataset: Record<string, string> = {};
  className = "";
  replacements = 0;
  constructor(readonly tagName = "hui-session-ref") {}
  get ownerDocument() { return fakeDocument; }
  get textContent(): string { return this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.children.length = 0; this.children.push(new FakeText(value)); }
  replaceChildren(...nodes: FakeChild[]): void {
    this.replacements += 1;
    this.children.length = 0;
    this.children.push(...nodes);
  }
  append(...nodes: FakeChild[]): void { this.children.push(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  querySelector(selector: string): FakeNode | null {
    const wanted = selector.startsWith(".") ? selector.slice(1) : "";
    const find = (node: FakeNode): FakeNode | undefined => {
      for (const child of node.children) {
        if (!(child instanceof FakeNode)) continue;
        if (wanted && child.className.split(/\s+/u).includes(wanted)) return child;
        const deeper = find(child);
        if (deeper) return deeper;
      }
      return undefined;
    };
    return find(this) ?? null;
  }
  connectedCallback(): void {}
}

const fakeDocument = {
  createElement: (tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => new FakeText(text),
};

/** The module, loaded once with the test DOM in place of the browser's `HTMLElement`. */
async function sessionRefModule() {
  vi.stubGlobal("HTMLElement", FakeNode);
  return await import("./session-ref.ts");
}

/** An element as the chip line draws one: its query in `data-query` and no child at all. */
async function emptyChip(query: string) {
  const { HuiSessionRef } = await sessionRefModule();
  const element = new HuiSessionRef() as unknown as FakeNode;
  element.dataset["query"] = query;
  element.connectedCallback();
  return element;
}

/** An element as the Markdown parser draws one: the typed text, which is what it reads until it resolves. */
async function typedChip(query: string) {
  const { HuiSessionRef } = await sessionRefModule();
  const element = new HuiSessionRef() as unknown as FakeNode;
  element.textContent = `session:${query}`;
  element.dataset["query"] = query;
  element.connectedCallback();
  return element;
}

const registry = (sessions: { id: string; title: string; status: string }[] = []) =>
  [{ label: "Sessions", sessions }] as unknown as SessionGroup[];

test("a chip with nothing drawn yet, or one naming another session, is rebuilt", async () => {
  const { sessionRefUpdate } = await sessionRefModule();
  const shown = { id: ID, title: "Fix the drawer", status: "Running" };
  assert.equal(sessionRefUpdate(undefined, shown), "rebuild", "the first resolve draws the chip");
  assert.equal(sessionRefUpdate(shown, { ...shown, id: OTHER }), "rebuild", "another session is another chip");
});

test("a title or status change is written into the chip already drawn", async () => {
  const { sessionRefUpdate } = await sessionRefModule();
  const shown = { id: ID, title: "Fix the drawer", status: "Running" };
  assert.equal(sessionRefUpdate(shown, { ...shown, title: "Fix the zipper" }), "in-place");
  assert.equal(sessionRefUpdate(shown, { ...shown, status: "Idle" }), "in-place", "a status flip keeps the focused anchor");
  assert.equal(sessionRefUpdate(shown, { ...shown, title: "Fix the zipper", status: "Idle" }), "in-place");
});

test("a chip that already says what the registry says is left alone", async () => {
  const { sessionRefUpdate } = await sessionRefModule();
  assert.equal(sessionRefUpdate({ id: ID, title: "Fix the drawer", status: "Running" }, { id: ID, title: "Fix the drawer", status: "Running" }), "none");
});

test("an unresolved reference reads exactly the text that was typed", async () => {
  const { sessionRefFallbackText } = await sessionRefModule();
  assert.equal(sessionRefFallbackText(ID), `session:${ID}`);
});

test("an element drawn from its query alone still reads the reference until it resolves", async () => {
  publishSessionReferences(registry());
  const element = await emptyChip(ID);
  assert.equal(element.textContent, `session:${ID}`, "an empty chip writes the words a reference reads");
  // A registry that still does not name it writes nothing again.
  const replacements = element.replacements;
  publishSessionReferences(registry());
  assert.equal(element.replacements, replacements, "the same words are not written twice");

  // The registry arrives: the text becomes the chip, which links to the session and says what it is.
  publishSessionReferences(registry([{ id: ID, title: "Fix the drawer", status: "running" }]));
  assert.equal(element.children.length, 1);
  const anchor = element.children[0] as FakeNode;
  assert.equal(anchor.tagName, "a");
  assert.equal(anchor.getAttribute("href"), `/sessions/${ID}`, "the chip opens that chat in place");
  assert.equal(anchor.getAttribute("data-testid"), "session-ref");
  assert.match(anchor.getAttribute("aria-label") ?? "", /^Open session Fix the drawer/u);
  assert.equal(anchor.textContent, "Fix the drawer Running");
  // Losing the session puts the words back where the chip stood.
  publishSessionReferences(registry());
  assert.equal(element.textContent, `session:${ID}`);
});

test("a reference the parser typed keeps its own text, and nothing is written while it is already right", async () => {
  publishSessionReferences(registry());
  const element = await typedChip("195c3659");
  assert.equal(element.textContent, "session:195c3659", "the typed text is what an unresolved reference reads");
  assert.equal(element.replacements, 0, "an element that already says its fallback is never rewritten");

  publishSessionReferences(registry([{ id: ID, title: "Fix the drawer", status: "idle" }]));
  assert.match(element.textContent, /^Fix the drawer Idle$/u, "the prefix resolves into its chip");

  // A session that goes away puts back the text the writer typed, never a guessed id.
  publishSessionReferences(registry());
  assert.equal(element.textContent, "session:195c3659");
});
