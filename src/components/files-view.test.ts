/**
 * The Files view's share control belongs to the phone: the element cannot be built outside a page, so this pins the
 * wiring the way the other element tests do — the control is drawn only where `nativeShell()` answers a shell, and it
 * hands the open file to the shell as `lib/native-shell.test.ts` pins the payload.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const source = readFileSync(new URL("./files-view.ts", import.meta.url), "utf8");

test("the Files view shares the open file only where the page is in the phone shell", () => {
  const header = source.slice(source.indexOf("private renderHeader()"), source.indexOf("private renderConflict()"));
  assert.match(header, /\$\{nativeShell\(\) \? html`<button type="button" class="btn btn--ghost btn--icon hui-files-share" data-testid="files-share" aria-label=\$\{`Share \$\{this\.file\?\.name \?\? "file"\}`\} data-hui-tooltip="Share file"/u);
  assert.match(header, /@click=\$\{\(\) => this\.shareSelected\(\)\}/u);
  assert.doesNotMatch(header, /title="Share/u, "HUI's own tooltip, never the browser's");
});

test("a shared file is the text on screen, else where it lives", () => {
  const share = source.slice(source.indexOf("private shareSelected()"), source.indexOf("private async copyText("));
  assert.match(share, /if \(!shell \|\| !path \|\| !file\) return;/u);
  assert.match(share, /void shell\.share\(fileShare\(\{ name: file\.name, path, text: file\.kind === "text" \? this\.draft\?\.content \?\? file\.content : undefined \}\)\);/u);
});
