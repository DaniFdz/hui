/**
 * The composer's own placeholder state: `data-empty` is what the sheet paints `data-placeholder` from, so it is set on
 * the empty draft alone — one paragraph holding nothing — and never over a block the operator made. A note, a quote, a
 * heading or a fence is that block whatever it holds, so an empty callout keeps the placeholder off its own title.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Node } from "prosemirror-model";
import { test } from "vitest";
import { emptyDraft } from "./editor.ts";
import { parseMarkdown } from "./markdown.ts";
import { richSchema, schemaNode } from "./schema.ts";

const docOf = (...content: Node[]) => schemaNode(richSchema, "doc").create(null, content);
const paragraph = (...content: Node[]) => schemaNode(richSchema, "paragraph").create(null, content);
const noteOf = (kind: string, ...content: Node[]) => schemaNode(richSchema, "note").create({ kind }, content);
const quoteOf = (...content: Node[]) => schemaNode(richSchema, "blockquote").create(null, content);

test("the placeholder belongs to the empty draft and to nothing else", () => {
  // A cleared composer, and a draft the operator emptied again: one paragraph with no content.
  assert.equal(emptyDraft(docOf(paragraph())), true);

  // Every other draft carries a block, and the placeholder would be painted over it: an empty note, quote, heading or
  // fence is one — a callout whose body is empty still draws its own title where the placeholder would be.
  assert.equal(emptyDraft(docOf(noteOf("note", paragraph()))), false);
  assert.equal(emptyDraft(docOf(quoteOf(paragraph()))), false);
  assert.equal(emptyDraft(docOf(schemaNode(richSchema, "heading").create({ level: 2 }))), false);
  assert.equal(emptyDraft(docOf(schemaNode(richSchema, "code_block").create({ language: "" }))), false);
  assert.equal(emptyDraft(docOf(schemaNode(richSchema, "bullet_list").create(null, schemaNode(richSchema, "list_item").create(null, paragraph())))), false);

  // A draft with text, a second empty paragraph, and a paragraph holding only a line break are all drafts of the
  // operator's: the last one still holds a hard break, so it is not the empty paragraph the placeholder sits on.
  assert.equal(emptyDraft(docOf(paragraph(richSchema.text("hi")))), false);
  assert.equal(emptyDraft(docOf(paragraph(), paragraph())), false);
  assert.equal(emptyDraft(docOf(paragraph(schemaNode(richSchema, "hard_break").create()))), false);

  // The drafts the editor actually loads: a cleared composer, a callout with nothing typed in it, and a quote's marker
  // line on its own all come from the wire the way the tests above build them.
  assert.equal(emptyDraft(parseMarkdown("")), true);
  assert.equal(emptyDraft(parseMarkdown("> [!NOTE]")), false);
  assert.equal(emptyDraft(parseMarkdown(">")), false);
  // A note with a body is no more the placeholder's state than an empty one is.
  assert.equal(emptyDraft(parseMarkdown("> [!NOTE]\n> The body.")), false);
});

test("the surface's placeholder attribute is read from the draft, not from the text it shows", () => {
  const editor = readFileSync(new URL("./editor.ts", import.meta.url), "utf8");

  // `data-empty` is asked of the document through `emptyDraft`; the text a draft shows is not its state, because an
  // empty callout, quote or heading shows no text at all and is still a block the operator made.
  assert.match(editor, /#syncEmpty\(\): void \{\s*this\.#view\.dom\.toggleAttribute\("data-empty", emptyDraft\(this\.#view\.state\.doc\)\);/u);
  assert.doesNotMatch(editor, /toggleAttribute\("data-empty", this\.#view\.state\.doc\.textContent === ""\)/u);
});
