import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the provider wizard keeps the accessible names its steps are reached and finished with", () => {
  const source = read("./providers.ts");
  // The empty state replaces "Add provider" and the old "No providers added yet" line.
  assert.match(source, /<h3>No model providers configured<\/h3>/u);
  assert.match(source, /Sign in to a provider or add an API key, then continue\./u);
  assert.match(source, />Connect a provider<\/button>/u);
  assert.doesNotMatch(source, /Add provider|No providers added yet/u);
  // Every sign-in step: browser, device code, manual entry, waiting.
  assert.match(source, />Open sign-in<\/button>/u);
  assert.match(source, />Copy link<\/button>/u);
  assert.match(source, />Copy code<\/button>/u);
  assert.match(source, /<summary>Use manual entry<\/summary>/u);
  assert.match(source, /Waiting for sign-in…/u);
  assert.match(source, /Starting provider sign-in…/u);
  assert.match(source, /Complete sign-in in your browser, then return here\./u);
  assert.match(source, /Continue only if you started this sign-in yourself/u);
  // The model step and its check.
  assert.match(source, /Account connected\. Choose a model when you want to test a reply\./u);
  assert.match(source, />Check model<\/button>/u);
  assert.match(source, /HUI received a real reply from/u);
  assert.match(source, />Start chatting<\/button>/u);
  assert.match(source, />Stay in settings<\/button>/u);
  // Closing a waiting sign-in asks first.
  assert.match(source, /Sign-in is still waiting\. Close and cancel it\?/u);
  assert.match(source, />Keep waiting<\/button>/u);
  assert.match(source, /aria-label="Close provider dialog"/u);
});

test("the wizard never draws a native select and keeps its options in the shared picker", () => {
  const source = read("./providers.ts");
  assert.doesNotMatch(source, /<select\b/u);
  assert.match(source, /renderPicker\(\{/u);
  assert.match(source, /@close|@cancel/u, "Escape and the dialog's cancel event both ask before closing a waiting sign-in");
});

test("a completed sign-in is saved before the dialog leaves it, never as an empty selection", () => {
  const source = read("./providers.ts");
  assert.match(source, /#saveCompleted\(\)/u);
  assert.match(source, /modelsForStep\(provider\.models, provider\.selected, this\.#chosen\)/u);
  assert.match(source, /if \(!provider \|\| !step\.saved\.length\) return true;/u, "a provider with no model writes nothing");
  assert.match(source, /await providerRequest\(provider\.id, "PUT", \{ models: step\.saved \}\)/u);
  assert.doesNotMatch(source, /\{ models: provider\.selected \}/u);
});

test("the model step is a radio list, and the dialog fits a phone without sideways scrolling", () => {
  const source = read("./providers.ts");
  assert.match(source, /type="radio" name="hui-provider-model"/u);
  assert.match(source, /<fieldset class="hui-provider-model-list">/u);
  const styles = read("../../styles/providers.css");
  assert.match(styles, /\.hui-provider-dialog \{[^}]*width: min\(480px, calc\(100vw - 32px\)\)/u);
  assert.match(styles, /\.hui-provider-device-code code \{[^}]*overflow-wrap: anywhere/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.hui-provider-spinner \{ animation: none; \} \}/u);
});
