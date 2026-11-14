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
  // A sign-in the gateway no longer holds says so and offers both ways on.
  assert.match(source, /This sign-in session ended\. Start it again to continue\./u);
  assert.match(source, />Try again<\/button>/u);
  assert.match(source, />Choose another method<\/button>/u);
  assert.match(source, /if \(this\.#ended \|\| \(this\.#attempt && !this\.#busy\)\) return this\.#signInEnded\(\);/u);
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
});

test("Escape reaches the dialog through its cancel event alone, and asks before closing a waiting sign-in", () => {
  const source = read("./providers.ts");
  const dialog = source.slice(source.indexOf("#modal() {"), source.indexOf("#modelPicker("));
  assert.match(dialog, /@cancel=\$\{\(event: Event\) => this\.#escape\(event\)\}/u);
  assert.match(dialog, /@keydown=\$\{\(event: KeyboardEvent\) => \{ if \(event\.key === "Escape"\) event\.stopPropagation\(\); \}\}/u, "Escape never reaches Settings' own handler");
  assert.doesNotMatch(dialog, /#escape\(event\)[^}]*keydown|keydown[^;]*#escape\(event\)/u, "the dialog handles Escape once");
  assert.match(source, /#escape\(event: Event\) \{\n\s+event\.preventDefault\(\);/u);
  assert.match(source, /if \(this\.#confirmClose\) \{ this\.#confirmClose = false; this\.requestUpdate\(\); return; \}/u);
});

test("the close confirmation is announced, not only focused", () => {
  const source = read("./providers.ts");
  assert.match(source, /<p role="alert">Sign-in is still waiting\. Close and cancel it\?<\/p>/u);
});

test("a completed sign-in is always written, and a refresh after it is not mistaken for the write", () => {
  const source = read("./providers.ts");
  assert.match(source, /#saveCompleted\(\)/u);
  assert.match(source, /modelsForStep\(provider\.models, provider\.selected, this\.#chosen\)/u);
  assert.match(source, /if \(!provider \|\| !step\.saved\.length\) return true;/u, "a provider with no model writes nothing");
  assert.match(source, /if \(same && !this\.#completed\) return true;/u, "a completed sign-in is written even when its selection is already saved");
  assert.match(source, /await providerRequest\(provider\.id, "PUT", \{ models: step\.saved \}\)/u);
  assert.match(source, /const refreshed = await loadProviders\(\)\.then\(\(next\) => next, \(\) => undefined\);/u, "only the write's own failure carries the write's message");
  assert.match(source, /The model selection is saved, but the provider list could not be refreshed\./u);
  assert.match(source, /if \(!refreshed\) \{/u);
  assert.doesNotMatch(source, /\{ models: provider\.selected \}/u);
});

test("the check tests the account this sign-in created, not the provider's first", () => {
  const source = read("./providers.ts");
  const models = source.slice(source.indexOf("#enterModels(login: ProviderLogin)"), source.indexOf("#mutate(path: string"));
  assert.match(models, /if \(login\.accountId\) this\.#accountId = login\.accountId;/u);
  const check = source.slice(source.indexOf("async #runCheck()"), source.indexOf("async #startChat()"));
  assert.match(check, /const accountId = this\.#accountId;/u);
  assert.doesNotMatch(check, /#currentLogin\(\)/u);
  assert.match(check, /testProviderModel\(provider\.id, \{ model: step\.selected, \.\.\.\(accountId \? \{ accountId \} : \{\}\) \}\)/u);
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

test("a device code counts down from the expiry the gateway reports", () => {
  const source = read("./providers.ts");
  assert.match(source, /Expires in \$\{expiresInMinutes\(login, this\.#startedAt\)\} minutes/u);
});

test("every provider keeps an optional account label, and only OpenCode Go requires it", () => {
  const source = read("./providers.ts");
  assert.match(source, /Label when email is unavailable \(optional\)/u);
  assert.match(source, /\$\{nameRequired \? "Account name" : "Label when email is unavailable \(optional\)"\}/u);
  assert.match(source, /<input id="hui-provider-account-name" maxlength="80" \?required=\$\{nameRequired\}/u);
  assert.match(source, /A name is required because OpenCode does not report the account name or email\./u);
  // Every method sends the label it was given; the gateway falls back to "Account N" when it is empty.
  assert.match(source, /const name = this\.#accountName\.trim\(\);/u);
  assert.match(source, /\.\.\.\(name \? \{ name \} : \{\}\), \.\.\.\(this\.#accountId \? \{ accountId: this\.#accountId \} : \{\}\) \}/u);
});

test("the verified screen only promises chatting when it can offer it", () => {
  const source = read("./providers.ts");
  assert.match(source, /HUI received a real reply from \$\{label\}\.\$\{this\.onStartChat \? " You can start chatting now\." : ""\}/u);
});

test("closing the wizard returns focus to whatever opener is left", () => {
  const source = read("./providers.ts");
  assert.match(source, /void this\.updateComplete\.then\(\(\) => this\.#focusOpener\(\)\);/u);
  assert.match(source, /this\.querySelector<HTMLElement>\("\.hui-provider-empty \.btn"\)\n\s+\?\? this\.querySelector<HTMLElement>\("\.settings-section__header \.btn"\)/u);
});
