/**
 * The composer's Markdown input rules: what typing a closing delimiter turns into rich text, and what must stay literal.
 *
 * A rule converts only when the delimiter that completes a run is typed, and only what that run wraps: `**bold**`
 * becomes strong text with the markers gone, while `2 * 3 * 4`, `a * b`, `read_text_file`, a lone `*` and an unmatched
 * `**` stay exactly as typed. A star may open inside a word (`a*b*` is emphasis in Markdown), an underscore may not
 * (`read_text_file` is a name), no run's content may start or end with whitespace, and no rule fires inside a code mark
 * or a code block. Block rules (heading, quote, note, bullet, ordered item, fence) fire only in a paragraph, so `# ` typed
 * inside a heading stays text instead of silently converting it; a fence opens on the space after it here, or on the
 * Enter that follows it (`keys.ts`' `openCodeFence`). A quote becomes a note when a `[!NOTE]` marker and the space after
 * it complete a blockquote holding that one paragraph: the marker goes and the quote's node becomes the note of that
 * kind, which is what `> [!NOTE]` is on the wire. A literal draft (see `editor.ts`) has no rules: the plugin's
 * `enabled` check is off there, so its markers stay text.
 *
 * Undo is exact. The typed character is dispatched as its own ordinary edit first and the conversion second, marked
 * with `closeHistory`, so prosemirror-history keeps the literal markers as an event of their own: one undo brings
 * `**bold**` back byte for byte, and the next removes it. (The `inputRules()` plugin dispatches the conversion in place
 * of the typed text, so its undo would drop the keystroke that completed the markers.)
 */
import { InputRule, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { closeHistory } from "prosemirror-history";
import type { MarkType, NodeType, Schema } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { AlertType } from "../../markdown/parser.ts";
import { schemaMark, schemaNode } from "./schema.ts";

/** The view surface the rules read and write: a whole `EditorView` satisfies it, and so does a test double. */
export type RuleView = {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
  composing?: boolean;
};

/** How a rule converts a matched run; the same signature `prosemirror-inputrules` gives its handlers. */
type RuleConversion = (state: EditorState, match: RegExpMatchArray, start: number, end: number, text: string) => Transaction | null;

/** A rule with the pattern and handler it was built from, which the 1.7 typings keep private. */
type RuleParts = { match: RegExp; handler: RuleConversion };

function partsOf(rule: InputRule): RuleParts {
  return rule as unknown as RuleParts;
}

/** The marker that turns a quote into a note, with the one space that completes it: `[!NOTE]`, and the four other kinds. */
const NOTE_MARKER_RE = /(?<=^|\s)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\] $/iu;

/**
 * The quote around the marker becomes a note of `kind`, with the marker and the space that completed it deleted: one
 * transaction, which the caller closes with `closeHistory` so one undo restores the quote and the literal marker byte for
 * byte. `undefined` when there is no blockquote at `start`, or when the quote cannot be a note where it sits: the same
 * check a conversion makes before it changes a block (`keys.ts`' `openingFence`).
 */
export function noteFromMarker(state: EditorState, start: number, end: number, kind: AlertType): Transaction | null {
  const $start = state.doc.resolve(start);
  const depth = $start.depth;
  if (depth < 2) return null;
  if ($start.node(depth - 1).type !== schemaNode(state.schema, "blockquote")) return null;
  const note = schemaNode(state.schema, "note");
  const index = $start.index(depth - 2);
  if (!$start.node(depth - 2).canReplaceWith(index, index + 1, note)) return null;
  const tr = state.tr.delete(start, end);
  tr.setNodeMarkup($start.before(depth - 1), note, { kind });
  tr.setSelection(TextSelection.create(tr.doc, start)).scrollIntoView();
  return tr;
}

/** A marker completes a quote of one paragraph into a note of its kind; anywhere else the marker stays text. */
function noteInputRule(): InputRule {
  return new InputRule(NOTE_MARKER_RE, (state, match, start, end) => {
    const kind = (match[1] ?? "note").toLowerCase() as AlertType;
    const $start = state.doc.resolve(start);
    const depth = $start.depth;
    if (depth < 2) return null;
    const quote = $start.node(depth - 1);
    if (quote.type !== schemaNode(state.schema, "blockquote") || quote.childCount !== 1) return null;
    return noteFromMarker(state, start, end, kind);
  });
}

/** How much text before the cursor a rule may look at, the same window `prosemirror-inputrules` uses. */
const MAX_MATCH = 500;

/** A mark rule's pattern names the content in `contentGroup`; the delimiters around it are removed on conversion. */
export function markInputRule(pattern: RegExp, markType: MarkType, contentGroup = 1): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const content = match[contentGroup] ?? "";
    if (!content) return null;
    // The content is the run's tail, so its last occurrence is the one this match captured.
    const offset = match[0].lastIndexOf(content);
    if (offset < 0) return null;
    const from = start + offset;
    const to = from + content.length;
    const tr = state.tr;
    if (to < end) tr.delete(to, end);
    if (from > start) tr.delete(start, from);
    tr.addMark(start, start + content.length, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  }, { inCodeMark: false });
}

type RuleTable = {
  /** Every rule in the order it is tried: a completed `**run**` is never read as two emphasis runs. */
  rules: readonly InputRule[];
  /** The rules that only make sense in a paragraph. */
  paragraphsOnly: ReadonlySet<InputRule>;
  paragraph: NodeType;
};

const ruleTables = new WeakMap<Schema, RuleTable>();

function rulesOf(schema: Schema): RuleTable {
  const cached = ruleTables.get(schema);
  if (cached) return cached;
  const paragraph = schemaNode(schema, "paragraph");
  const heading = schemaNode(schema, "heading");
  const blockquote = schemaNode(schema, "blockquote");
  const bulletList = schemaNode(schema, "bullet_list");
  const orderedList = schemaNode(schema, "ordered_list");
  const codeBlock = schemaNode(schema, "code_block");
  const strong = schemaMark(schema, "strong");
  const em = schemaMark(schema, "em");
  const s = schemaMark(schema, "s");
  const code = schemaMark(schema, "code");
  const paragraphsOnly = new Set<InputRule>();
  const inParagraph = (rule: InputRule): InputRule => {
    paragraphsOnly.add(rule);
    return rule;
  };
  const rules: InputRule[] = [
    // A fence opens on the space after ``` or ```lang, and on the Enter that follows it (`keys.ts`' `openCodeFence`).
    inParagraph(textblockTypeInputRule(/^```([A-Za-z0-9_+.#-]*)\s$/u, codeBlock, (match) => ({ language: match[1] ?? "" }))),
    inParagraph(textblockTypeInputRule(/^(#{1,6})\s$/u, heading, (match) => ({ level: (match[1] ?? "#").length }))),
    inParagraph(wrappingInputRule(/^\s*>\s$/u, blockquote)),
    // A quote holding one paragraph turns into the note its marker names, the marker gone (`noteFromMarker`).
    inParagraph(noteInputRule()),
    inParagraph(wrappingInputRule(/^\s*-\s$/u, bulletList)),
    inParagraph(wrappingInputRule(/^\s*(\d{1,9})[.)]\s$/u, orderedList, (match) => ({ order: Number(match[1]) }))),
    markInputRule(/(?<!\*)\*\*([^\s*](?:[^*]*[^\s*])?)\*\*$/u, strong),
    markInputRule(/(?<![\p{L}\p{N}_*])__([^\s_](?:[^_]*[^\s_])?)__$/u, strong),
    markInputRule(/(?<!~)~~([^\s~](?:[^~]*[^\s~])?)~~$/u, s),
    markInputRule(/(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*$/u, em),
    markInputRule(/(?<![\p{L}\p{N}_])_([^\s_](?:[^_]*[^\s_])?)_$/u, em),
    // A span's text may hold anything but backticks; its own run is group 1 and the text group 2.
    markInputRule(/(?<!`)(`+)([^\n`]+)\1$/u, code, 2),
  ];
  const table: RuleTable = { rules, paragraphsOnly, paragraph };
  ruleTables.set(schema, table);
  return table;
}

/** Whether any mark with `code: true` covers the range the rule would convert. */
function insideCodeMark(state: EditorState, from: number, to: number): boolean {
  let inside = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && node.marks.some((mark) => mark.type.spec.code)) inside = true;
  });
  return inside;
}

/**
 * Runs the rules for text the browser is about to insert. `text` is the input that triggered the check, which the
 * view has not inserted yet; the matching range therefore includes it.
 */
export function applyInputRules(view: RuleView, from: number, to: number, text: string, schema: Schema): boolean {
  if (view.composing) return false;
  const state = view.state;
  const $from = state.doc.resolve(from);
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - MAX_MATCH), $from.parentOffset, null, "\ufffc") + text;
  const table = rulesOf(schema);
  const stored = from === to && state.selection.from === from && state.selection.to === to ? state.storedMarks : null;
  const marks = stored ?? (from === to ? $from.marks() : $from.marksAcross(state.doc.resolve(to)) ?? []);
  if (marks.some((mark) => mark.type.spec.code) || $from.parent.type.spec.code) return false;
  for (const rule of table.rules) {
    if (table.paragraphsOnly.has(rule) && $from.parent.type !== table.paragraph) continue;
    const { match: pattern, handler: convert } = partsOf(rule);
    const match = pattern.exec(before);
    if (!match || match[0].length < text.length) continue;
    const start = from - (match[0].length - text.length);
    if (insideCodeMark(state, start, from)) continue;
    // The typed text lands first as an ordinary edit, so the conversion is a history event of its own (see the header).
    const typed = text ? state.tr.insertText(text, from, to) : undefined;
    const after = typed ? state.apply(typed) : state;
    let conversion: Transaction | null = null;
    try {
      conversion = convert(after, match, start, start + match[0].length, text);
    } catch {
      // A conversion that cannot build its transaction leaves the keystroke to the browser, as if no rule matched.
      conversion = null;
    }
    if (!conversion) continue;
    if (typed) view.dispatch(typed);
    view.dispatch(closeHistory(conversion));
    return true;
  }
  return false;
}

/**
 * The composer's Markdown input rules as a plugin: `handleTextInput`, plus the rules once an IME composition ends. Both
 * run only while `enabled` says so, which is always for a rich draft.
 */
export function richInputRules(schema: Schema, enabled: () => boolean = () => true): Plugin {
  rulesOf(schema);
  const rule: Plugin = new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        return enabled() ? applyInputRules(view, from, to, text, schema) : false;
      },
      handleDOMEvents: {
        compositionend(view) {
          // The composed text is in the document by now, so the rules read it the way the next keystroke would.
          setTimeout(() => {
            if (!enabled()) return;
            const cursor = view.state.selection.empty ? view.state.selection.from : undefined;
            if (cursor !== undefined) applyInputRules(view, cursor, cursor, "", schema);
          }, 0);
          return false;
        },
      },
    },
  });
  return rule;
}
