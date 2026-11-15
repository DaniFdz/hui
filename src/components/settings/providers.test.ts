/**
 * Settings → Models → Providers: the setup wizard's steps and wording, and the provider card's one-column structure
 * staying true in the markup and the stylesheet — a draft-bound Models count, one --hui-inset owner, hairlines instead
 * of nested frames, and a limits line that never states a subscription PI does not report. The limits and order values
 * have their own tests in `src/lib/provider-quota.test.ts`; this file only reads the sources, so it does not load the
 * element.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("./providers.ts");
const css = read("../../styles/providers.css");

/** One rule's declarations, from its selector to its closing brace. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} has a rule`);
  return css.slice(start, css.indexOf("}", start));
}

/** The phone overrides, from their media query to the end of the stylesheet. */
const phone = css.slice(css.indexOf("@media (max-width: 600px)"));

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
  assert.match(styles, /\.hui-provider-dialog \{[^}]*width: min\(480px, calc\(100vw - var\(--space-7\)\)\)/u);
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

test("the limits block tells the truth about what it knows", () => {
  assert.doesNotMatch(source, /Subscription status/u, "no subscription-status row: the payload has no such field");
  assert.doesNotMatch(source, /Billing status and renewal dates/u, "no note explaining an absence nobody needs");
  assert.doesNotMatch(source, /hui-subscription-status|hui-subscription-note/u);
  assert.match(source, /<p class="hui-provider-quota-meta">\$\{quotaMetaLine\(quota, new Date\(quota\.checkedAt\)\.toLocaleString\(\)\)\}<\/p>/u);
  const meta = rule(".hui-provider-quota > .hui-provider-quota-meta");
  assert.match(meta, /margin: var\(--space-2\) 0 0/u);
  assert.match(meta, /color: var\(--muted\)/u);
  assert.match(meta, /font-variant-numeric: tabular-nums/u, "the checked time keeps its digits aligned");
  assert.match(source, /quota\.windows\.length \? html`<div class="hui-provider-windows">/u, "an empty windows list draws no grid");
  assert.match(source, /<h4>Subscription and limits<\/h4>/u);
  assert.match(source, /"Checking…" : "Refresh limits"/u);
  assert.match(source, /Reset not reported/u);
});

test("an account is a row in the card's column, not a card inside it", () => {
  assert.match(source, /<article class="hui-provider-account[^>]*>\s*<div class="hui-account-row">/u);
  assert.match(source, /class="hui-account-grip"/u);
  assert.match(source, /class="hui-account-identity"><strong class="hui-account-name">/u);
  assert.match(source, /class="hui-account-actions"><button class="btn"/u);
  assert.match(source, /class="hui-account-actions"><button[\s\S]*?\$\{account\.authenticated \? "Reconnect" : "Sign in"\}[\s\S]*?Remove account<\/button><\/div>/u);
  assert.doesNotMatch(source, /hui-provider-method|hui-provider-flat/u, "the count lives in the summary only");
  assert.equal(source.match(/selected`/gu)?.length, 1, "one selected-count string, in the Models summary");
  assert.match(rule(".hui-account-row"), /display: flex/u);
  assert.match(rule(".hui-account-grip"), /flex: 0 0 24px/u);
  assert.match(rule(".hui-account-grip"), /height: 44px/u);
  assert.match(rule(".hui-account-actions"), /margin-left: auto/u);
});

test("the header, empty state and loading line keep their place", () => {
  // The header offers the action only once a provider exists, so the empty state's own button keeps the name unique.
  assert.match(source, /<div class="settings-section__actions">\$\{providers\.length \? html`<button[\s\S]*?>Connect a provider<\/button>` : nothing\}<\/div>/u);
  assert.match(source, /<section class="hui-provider-empty">\s*<h3>No model providers configured<\/h3>\s*<p>Sign in to a provider or add an API key, then continue\.<\/p>/u);
  assert.match(source, /<p class="hui-provider-loading">Loading providers…<\/p>/u);
});

test("the Models summary counts the draft, so Select visible and Clear selection show at once", () => {
  assert.match(source, /<span class="hui-provider-picker-count">\$\{state\.models\.size \? `\$\{state\.models\.size\} selected` : "Choose models"\}<\/span>/u);
  assert.doesNotMatch(source, /provider\.selected\.length \? `\$\{provider\.selected\.length\} selected`/u, "the summary never shows the saved selection");
});

test("the Models disclosure has its own caret element, and the count keeps its own selector", () => {
  assert.match(source, /<summary><span class="hui-provider-caret" aria-hidden="true"><\/span>Models /u);
  const caret = rule(".hui-provider-caret");
  assert.match(caret, /width: 0/u);
  assert.match(caret, /height: 0/u);
  assert.match(caret, /border-left: 5px solid currentColor/u);
  assert.match(caret, /transition: transform/u);
  assert.match(css, /\.hui-provider-picker\[open\] > summary > \.hui-provider-caret \{ transform: rotate\(90deg\); \}/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.hui-provider-caret \{ transition: none; \} \}/u);
  assert.match(rule(".hui-provider-picker > summary .hui-provider-picker-count"), /margin-left: auto/u);
  assert.doesNotMatch(css, /\.hui-provider-picker > summary span \{/u, "the caret is not caught by the count's selector");
});

test("both removal confirmations are one block in the card's column, not a boxed form", () => {
  assert.equal(source.match(/<div class="hui-provider-confirm">/gu)?.length, 3, "the account, the connection and the waiting sign-in's close each use the same block");
  assert.equal(source.match(/class="hui-provider-confirm-actions"/gu)?.length, 2, "Confirm removal and Keep share one row");
  assert.match(source, /<p>Remove \$\{this\.#accountLabel\(provider, account\)\}\? Other accounts and model selections are kept\.<\/p>/u);
  assert.match(source, /<p>Remove this HUI connection and its saved credentials\? PI configuration is kept\./u);
  assert.match(source, />Confirm removal<\/button><button class="btn"[\s\S]*?>Keep account<\/button><\/div><\/div>/u);
  assert.match(source, />Confirm removal<\/button><button class="btn"[\s\S]*?>Keep connection<\/button><\/div><\/div>/u);
  assert.doesNotMatch(source, /hui-provider-login"><p>Remove/u, "the provider confirmation no longer reuses the dialog's box");
  assert.match(source, /<p role="status" class="hui-provider-status">Waiting for sign-in…/u, "the waiting line is the sign-in step's own status");
  const confirm = rule(".hui-provider-confirm");
  assert.match(confirm, /padding-block: var\(--space-3\)/u);
  assert.match(confirm, /border-top: 1px solid var\(--border\)/u);
  assert.match(rule(".hui-provider-confirm p"), /color: var\(--muted\)/u);
  assert.match(rule(".hui-provider-confirm p"), /font-size: var\(--control-ui-text-sm\)/u);
  assert.match(rule(".hui-provider-confirm p"), /margin: 0 0 var\(--space-3\)/u);
  assert.match(rule(".hui-provider-confirm-actions"), /display: flex; flex-wrap: wrap; gap: var\(--space-2\)/u);
});

test("a provider card is one content column with one inset owner", () => {
  const detail = rule(".hui-provider-detail");
  assert.match(detail, /--hui-inset: var\(--space-4\)/u);
  assert.doesNotMatch(detail, /(?:^|[;{]\s*)(?:padding|border|border-radius):/u, "the card adds no padding and no frame of its own");
  assert.match(rule(".hui-provider-cards"), /padding-block: var\(--space-4\)/u);
  assert.doesNotMatch(rule(".hui-provider-cards"), /(?:^|[;{]\s*)padding\s*:/u, "the container adds no second inset around the card's column");
  assert.match(rule(".hui-provider-cards"), /border-top: 1px solid var\(--border\)/u);

  const inset = css.slice(css.indexOf("/* The inset's one owner"), css.indexOf("{ padding-inline: var(--hui-inset); }"));
  assert.ok(inset.length > 0, "one rule owns the card's horizontal inset");
  for (const leaf of [
    ".hui-provider-detail > :is(.hui-provider-heading, .hui-provider-confirm)",
    ".hui-provider-account > .hui-provider-confirm",
    ".hui-provider-accounts > :is(.hui-provider-heading, .settings-section__desc, .hui-account-drag-help)",
    ".hui-account-row",
    ".hui-provider-quota > :is(.hui-provider-heading, p, .hui-provider-windows)",
    ".hui-provider-picker > summary",
    ".hui-provider-picker-panel > :is(.hui-provider-field, .hui-provider-actions)",
  ]) assert.ok(inset.includes(leaf), `${leaf} carries the inset`);
  assert.match(rule(".hui-provider-model"), /padding: var\(--space-3\) var\(--hui-inset\)/u, "a model row insets its own text against the list's hairline");
});

test("every hairline inside the frame runs edge to edge", () => {
  assert.match(rule(".hui-provider-detail + .hui-provider-detail"), /margin-top: var\(--space-5\)[\s\S]*padding-top: var\(--space-5\)[\s\S]*border-top: 1px solid var\(--border\)/u);
  assert.doesNotMatch(rule(".hui-provider-account"), /border:|border-radius|padding-inline/u, "the account draws no card of its own");
  assert.match(rule(".hui-provider-account"), /padding-block-end: var\(--space-3\)/u, "the drop markers need room under the last text line");
  assert.match(rule(".hui-provider-account + .hui-provider-account"), /border-top: 1px solid var\(--border\)/u);
  assert.match(css, /\.hui-provider-account\.drop-before::before \{ top: 0; \}/u, "the marker sits on the article's own top edge");
  assert.match(css, /\.hui-provider-account\.drop-after::after \{ bottom: 0; \}/u, "the marker sits on the article's own bottom edge");

  const quota = rule(".hui-provider-quota");
  assert.doesNotMatch(quota, /border-block|border-radius/u);
  assert.match(quota, /border-top: 1px solid var\(--border\)/u);
  assert.match(quota, /padding-top: var\(--space-3\)/u);
  assert.match(rule(".hui-provider-picker"), /border-top: 1px solid var\(--border\)/u);
  assert.match(rule(".hui-provider-models"), /border-block: 1px solid var\(--border\)/u);
});

test("the Models disclosure is a row with its count at the right, not a float", () => {
  const summary = rule(".hui-provider-picker > summary");
  assert.match(summary, /display: flex/u);
  assert.match(summary, /padding-block: var\(--space-3\)/u);
  assert.doesNotMatch(css, /float:\s*right/u);
  assert.match(rule(".hui-provider-models"), /max-height: min\(340px, 50dvh\)/u);
  assert.doesNotMatch(rule(".hui-provider-models"), /border-radius|border: 1px/u, "the list keeps hairlines instead of its own box");
  assert.match(rule(".hui-provider-model input"), /margin: 0/u);
});

test("the design tokens own the card's spacing, radii and type", () => {
  const rawSpacing = [...css.matchAll(/(?:^|[;{])\s*(padding|margin|gap|inset)(?:-[a-z]+)?\s*:\s*([^;{}]+);/gmu)]
    .filter((match) => /\b(?:4|8|12|16|20|24|32|40)px\b/u.test(match[2]!))
    .map((match) => match[0]!.trim());
  assert.deepEqual(rawSpacing, [], "insets come from --space-*");

  const cardCss = css.slice(0, css.indexOf("/* --- Provider setup wizard (HUI) --- */"));
  const rawType = [...cardCss.matchAll(/font-size:\s*([^;{}]+);/gu)]
    .filter((match) => !/^var\(--control-ui-text-(?:xs|sm|md|lg)\)$/u.test(match[1]!.trim()))
    .map((match) => match[0]);
  assert.deepEqual(rawType, [], "the card's type comes from --control-ui-text-*");
  // A device code is read across a room, so it may exceed the scale; everything else in the wizard uses it.
  const wizardType = [...css.matchAll(/font-size:\s*([^;{}]+);/gu)].map((match) => match[1]!.trim());
  const exotic = wizardType.filter((value) => !/^var\(--control-ui-text-(?:xs|sm|md|lg)\)$/.test(value));
  assert.deepEqual(exotic, ["clamp(20px, 7vw, 30px)"], "only the device code leaves the type scale");

  const radii = [...css.matchAll(/border-radius:\s*([^;{}]+);/gu)].map((match) => match[1]!.trim());
  assert.ok(radii.length > 0, "the configuration frame, dialog and grip keep a radius");
  for (const value of radii) assert.match(value, /^var\(--radius-[a-z]+\)$/u, `"${value}" is not a --radius-* token`);

  const offsets = [...css.matchAll(/outline-offset:\s*([^;{}]+);/gu)].map((match) => match[1]!.trim());
  assert.ok(offsets.length > 0, "the focus rings keep their offset");
  for (const value of offsets) assert.equal(value, "2px", "every focus ring sits the same distance out");
});

test("the phone keeps the card's inset, and the dialog keeps its own title size and blur", () => {
  assert.match(phone, /\.hui-provider-detail \{ --hui-inset: var\(--space-3\); \}/u);
  assert.match(phone, /\.hui-provider-cards \{ padding-block: var\(--space-3\); \}/u, "the card padding shrinks on its block axis only");
  assert.match(phone, /\.hui-account-actions \{ flex-basis: 100%; \}/u, "the account's actions take their own line on a phone");
  assert.match(phone, /\.hui-provider-detail \.hui-provider-heading h3 \{ font-size: var\(--control-ui-text-md\); \}/u);
  assert.doesNotMatch(phone, /^\s*\.hui-provider-heading h3 \{/mu, "the dialog title keeps the large size on a phone");

  const dialog = rule(".hui-provider-dialog");
  assert.match(dialog, /padding: var\(--space-6\)/u);
  assert.match(dialog, /border-radius: var\(--radius-lg\)/u);
  assert.match(dialog, /box-shadow: var\(--shadow-xl\)/u);
  assert.match(phone, /\.hui-provider-dialog \{ padding: var\(--space-4\); \}/u);
  assert.match(rule(".hui-provider-dialog::backdrop"), /background: #0009; backdrop-filter: blur\(4px\)/u);
});
