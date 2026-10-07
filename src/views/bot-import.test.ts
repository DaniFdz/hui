import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("+ → Import bot… opens the import dialog and a bot's ⋯ → Export… the export dialog; only while bots are on", () => {
  const roster = read("./bots.ts");
  assert.match(between(roster, "function botRow(", "function archivedRow("), /<span class="session-menu__text">Export…<\/span>/u);
  assert.match(between(roster, "function botRow(", "function archivedRow("), /if \(action === "export"\) \{ drawer\.dialog\(event\); props\.onExport\(bot\); \}/u);
  assert.match(roster, /class="btn btn--sm bot-roster__import"[^\n]*props\.onImport\(\);/u, "the empty roster offers it too");
  assert.match(read("./shell.ts"), /onImport: botsTab\.onImport,/u);
  const app = read("../hui-app.ts");
  const shell = between(app, "private shellBotsProps(", "private createNewBot");
  assert.match(shell, /^private shellBotsProps\(\): ShellBotsProps \| undefined \{\n\s+if \(!botsEnabled\(this\.settings\)\) return undefined;/u, "no + and no ⋯ while bots are off");
  assert.match(shell, /onImport: this\.botImports\.openImport,/u);
  assert.match(shell, /onExport: \(bot\) => \{ this\.botMenuFor = ""; this\.botImports\.openExport\(bot\); \},/u);
  assert.match(between(app, "private followBotsSetting(", "private shellBotsProps("), /this\.botImports\.close\(\);/u, "turning bots off closes both dialogs");
  assert.match(app, /this\.navigate\(\{ kind: "bot", id: bot\.id \}\);\n\s+\},\n\s+\}\);/u, "an imported bot's chat opens, as a new bot's does");
});

test("the preview shows every imported text as plain text, says it is untrusted, and Create is the only way to make the bot", () => {
  const source = read("./bot-import.ts");
  assert.doesNotMatch(source, /unsafeHTML|renderMarkdown|innerHTML/u, "imported text is never rendered as HTML or Markdown");
  assert.match(source, /const textBlock = \(text: string\) => html`<pre class="bot-import__text">\$\{text\}<\/pre>`;/u);
  const preview = between(source, "function renderPreviewStep(", "export function renderBotImportDialog(");
  for (const shown of ["textBlock(preview.soul)", "textBlock(preview.opener)", "textBlock(skill.content)", "textBlock(routine.prompt)"]) assert.ok(preview.includes(shown), shown);
  assert.match(preview, /Imported text is untrusted: read it below before you create the bot\. An import turns nothing on beyond a new bot's defaults/u);
  assert.match(preview, /section\("Routines", `\$\{preview\.routines\.length\} · disabled`/u, "routines say they start disabled");
  assert.match(preview, /section\("Left out"/u, "and what was left out, with why");
  const dialog = between(source, "export function renderBotImportDialog(", "/* ── export");
  assert.match(dialog, /if \(preview\) props\.onCreate\(\); else props\.onPreview\(\);/u, "Preview first; Create only from a preview");
  assert.match(dialog, /\(props\.pending \? "Creating…" : "Create bot"\)/u);
  const css = read("../styles/bot-import.css");
  assert.match(css, /\.bot-import__text \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/u, "long lines wrap instead of widening the dialog");
  assert.match(css, /@media \(max-width: 640px\) \{\n\s+\.bot-import-dialog \{ width: calc\(100vw - 24px\);/u, "a phone gets the whole width");
});
