/**
 * The Triggers section of a bot's Routines tab (HUI-18): its triggers with what they watch, when they last fired,
 * their cooldown, an on/off switch, Test and Delete; the latest runs; and the add form, with a Review requests preset
 * for Slack. A webhook trigger's URL shows once, right after it was made or replaced. Rendering only:
 * `BotTriggersController` (`src/lib/bot-triggers.ts`) owns the state and every request.
 */
import { html, nothing } from "lit";
import {
  BOT_TRIGGER_LIMITS, BOT_TRIGGER_SOURCE_LABELS, BOT_TRIGGER_SOURCES, GITHUB_TRIGGER_EVENT_LABELS, GITHUB_TRIGGER_EVENTS, SESSION_TRIGGER_EVENT_LABELS, SESSION_TRIGGER_EVENTS,
  SLACK_TRIGGER_EVENT_LABELS, SLACK_TRIGGER_EVENTS, botTriggerFilterSummary, cooldownLabel,
  type BotTrigger, type BotTriggerRun, type BotTriggerSource,
} from "../../shared/bot-triggers.ts";
import type { BotView } from "../../shared/bots.ts";
import { icons } from "../lib/icons.ts";
import { REVIEW_REQUESTS_PRESET, TriggerFormError, triggerFormInput, type BotTriggersActions, type BotTriggersState, type RevealedHook } from "../lib/bot-triggers.ts";
import { renderSettingsToggle } from "./settings-toggle.ts";
import { loadViewAssets } from "../lib/view-assets.ts";

loadViewAssets(() => import("../styles/bot-triggers.css"));

export type BotTriggersProps = { bot: BotView; now: number; state: BotTriggersState } & BotTriggersActions;

const SOURCE_ICONS: Record<BotTriggerSource, unknown> = { github: icons.gitBranch, session: icons.squareTerminal, webhook: icons.zap, slack: icons.messageSquare };
const RUN_LABELS: Record<BotTriggerRun["status"], string> = { fired: "Fired", coalesced: "Coalesced", skipped: "Skipped", failed: "Failed" };
/** The cooldowns the form offers, in seconds. */
export const COOLDOWN_CHOICES: readonly number[] = [0, 60, 300, 900, 3_600];
/** What a new GitHub trigger starts with checked. */
const DEFAULT_GITHUB_EVENTS = new Set(["pr_opened", "checks_failed", "review_changes_requested", "mention"]);
const DEFAULT_SESSION_EVENTS = new Set(["finished", "failed", "waiting"]);

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`, or the date. */
export function agoLabel(at: string | undefined, now: number): string {
  const time = Date.parse(at ?? "");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1_000));
  if (seconds < 45) return "just now";
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)} d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** `14:05` today, or a date and time. */
export function whenLabel(at: string, now: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return at;
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return sameDay ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderTrigger(trigger: BotTrigger, props: BotTriggersProps) {
  const { state } = props;
  const fired = trigger.lastFiredAt ? `Last fired ${agoLabel(trigger.lastFiredAt, props.now)}` : "Never fired";
  return html`<li class="bot-trigger ${trigger.enabled ? "" : "bot-trigger--paused"}" data-trigger=${trigger.id} data-source=${trigger.source}>
    <div class="bot-trigger__head">
      <span class="bot-trigger__source" title=${BOT_TRIGGER_SOURCE_LABELS[trigger.source]}>${SOURCE_ICONS[trigger.source]}<span class="settings-control__sr-label">${BOT_TRIGGER_SOURCE_LABELS[trigger.source]}:</span></span>
      <span class="bot-trigger__name">${trigger.name}</span>
      ${renderSettingsToggle(`Enable ${trigger.name}`, trigger.enabled, (checked) => props.onToggle(trigger, checked), state.pending)}
    </div>
    <p class="bot-trigger__filter" title=${botTriggerFilterSummary(trigger)}>${botTriggerFilterSummary(trigger)}</p>
    <p class="bot-trigger__meta">${fired} · cooldown ${cooldownLabel(trigger.cooldownSeconds)}${trigger.createdBy === "bot" ? ` · added by ${props.bot.name}` : ""}</p>
    ${trigger.pending ? html`<p class="bot-trigger__meta bot-trigger__meta--pending">${trigger.pending.events} event${trigger.pending.events === 1 ? "" : "s"} wait${trigger.pending.events === 1 ? "s" : ""}, sent together at ${whenLabel(trigger.pending.until, props.now)}</p>` : nothing}
    ${(trigger.source === "github" || trigger.source === "slack") && trigger.watch?.error ? html`<p class="bot-trigger__meta bot-trigger__meta--error" role="status">${trigger.watch.error}</p>`
      : (trigger.source === "github" || trigger.source === "slack") && trigger.enabled ? html`<p class="bot-trigger__meta">${trigger.watch?.polledAt ? `${BOT_TRIGGER_SOURCE_LABELS[trigger.source]} read ${agoLabel(trigger.watch.polledAt, props.now)}` : `Waiting for the first read of ${BOT_TRIGGER_SOURCE_LABELS[trigger.source]}`}</p>` : nothing}
    ${trigger.source === "webhook" ? html`<p class="bot-trigger__meta">URL …/hooks/${trigger.tokenHint ?? ""}… · shown when it was made</p>` : nothing}
    ${trigger.prompt ? html`<p class="bot-trigger__prompt" title=${trigger.prompt}>${trigger.prompt}</p>` : nothing}
    <div class="bot-trigger__actions">
      <button type="button" class="btn btn--sm bot-trigger__test" ?disabled=${state.pending} aria-label=${`Test ${trigger.name}`} @click=${() => props.onTest(trigger)}>${icons.zap}<span>Test</span></button>
      ${trigger.source === "webhook" ? html`<button type="button" class="btn btn--sm btn--ghost bot-trigger__rotate" ?disabled=${state.pending} aria-label=${`New URL for ${trigger.name}`} @click=${() => props.onRotate(trigger)}>${icons.refresh}<span>New URL</span></button>` : nothing}
      <button type="button" class="btn btn--sm btn--ghost bot-trigger__delete" ?disabled=${state.pending} aria-label=${`Delete ${trigger.name}`} @click=${() => props.onDelete(trigger)}>${icons.trash}<span>Delete</span></button>
    </div>
  </li>`;
}

function renderRevealed(revealed: RevealedHook, props: BotTriggersProps) {
  return html`<div class="bot-trigger-url" role="status" aria-live="polite">
    <p class="bot-trigger-url__title">${revealed.name}: its webhook URL</p>
    <p class="bot-panel__hint">Copy it now: HUI keeps only a fingerprint of it and can't show it again. POST JSON or text to it from this machine or your tailnet.</p>
    <code class="bot-trigger-url__value" aria-label=${`Webhook URL of ${revealed.name}`}>${revealed.url}</code>
    <div class="bot-trigger-url__actions">
      <button type="button" class="btn btn--sm bot-trigger-url__copy" @click=${props.onCopy}>${revealed.copied ? icons.check : icons.copy}<span>${revealed.copied ? "Copied" : "Copy"}</span></button>
      <button type="button" class="btn btn--sm btn--ghost" @click=${props.onDismissUrl}>Done</button>
    </div>
  </div>`;
}

function renderRun(run: BotTriggerRun, now: number) {
  const tags = [...(run.test ? ["test"] : []), ...(run.catchUp ? ["catch-up"] : []), ...(run.events > 1 ? [`${run.events} events`] : [])];
  return html`<li class="bot-run bot-trigger-run" data-run=${run.id} data-status=${run.status}>
    <div class="bot-run__head"><span class="bot-run__name">${run.triggerName}</span><span class="bot-run__status">${RUN_LABELS[run.status]}</span></div>
    <p class="bot-run__facts">${agoLabel(run.at, now)}${tags.length ? ` · ${tags.join(" · ")}` : ""}</p>
    ${run.summary ? html`<p class="bot-run__body">${run.summary}</p>` : nothing}
    ${run.reason ? html`<p class="bot-run__body ${run.status === "failed" ? "bot-run__body--error" : ""}" role=${run.status === "failed" ? "alert" : nothing}>${run.reason}</p>` : nothing}
  </li>`;
}

const formText = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

function submitTrigger(event: SubmitEvent, props: BotTriggersProps) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  try {
    const input = triggerFormInput({
      name: formText(data, "name"),
      source: formText(data, "source"),
      prompt: formText(data, "prompt"),
      cooldown: formText(data, "cooldown"),
      repos: formText(data, "repos"),
      githubEvents: data.getAll("githubEvents").map(String),
      authors: formText(data, "authors"),
      labels: formText(data, "labels"),
      base: formText(data, "base"),
      pulls: formText(data, "pulls"),
      draft: formText(data, "draft"),
      sessionEvents: data.getAll("sessionEvents").map(String),
      matchField: formText(data, "matchField"),
      matchOp: formText(data, "matchOp"),
      matchValue: formText(data, "matchValue"),
      slackEvents: data.getAll("slackEvents").map(String),
      slackPrLinks: data.get("slackPrLinks") !== null,
      slackFrom: formText(data, "slackFrom"),
      slackIn: formText(data, "slackIn"),
      slackExternal: data.get("slackExternal") !== null,
      slackBots: data.get("slackBots") !== null,
    });
    // Only an accepted trigger clears the form; a refusal keeps what was typed.
    void props.onCreate(input).then((created) => {
      if (created) form.reset();
    });
  } catch (error) {
    props.onFormError(error instanceof TriggerFormError ? error.message : "Could not read the trigger form.");
  }
}

/** The Review requests preset fills the form: Slack, mentions and DMs, PR links only, and a name and prompt when
 * those are still empty. Nothing is sent until Add trigger. */
function applyReviewPreset(event: Event) {
  const form = (event.currentTarget as HTMLElement).closest("form");
  if (!form) return;
  const field = (name: string) => form.elements.namedItem(name);
  const slack = form.querySelector<HTMLInputElement>('input[name="source"][value="slack"]');
  if (slack) slack.checked = true;
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="slackEvents"]')) box.checked = REVIEW_REQUESTS_PRESET.events.includes(box.value as (typeof REVIEW_REQUESTS_PRESET.events)[number]);
  const links = field("slackPrLinks");
  if (links instanceof HTMLInputElement) links.checked = REVIEW_REQUESTS_PRESET.prLinks;
  const name = field("name");
  if (name instanceof HTMLInputElement && !name.value.trim()) name.value = REVIEW_REQUESTS_PRESET.name;
  const prompt = field("prompt");
  if (prompt instanceof HTMLTextAreaElement && !prompt.value.trim()) prompt.value = REVIEW_REQUESTS_PRESET.prompt;
}

function renderForm(props: BotTriggersProps, open: boolean) {
  const { state } = props;
  const name = props.bot.name;
  return html`<details class="bot-trigger-form" ?open=${open}>
    <summary class="bot-trigger-form__summary">${icons.plus}<span>Add trigger</span></summary>
    <form class="bot-trigger-form__body" novalidate @submit=${(event: SubmitEvent) => submitTrigger(event, props)}>
      <label class="bot-field"><span class="bot-field__label">Name</span>
        <input class="settings-input" name="name" type="text" maxlength=${BOT_TRIGGER_LIMITS.name} placeholder="PR watch" autocomplete="off" /></label>
      <fieldset class="bot-field">
        <legend class="bot-field__label">Watches</legend>
        <div class="settings-segmented bot-trigger-form__sources">
          ${BOT_TRIGGER_SOURCES.map((source) => html`<label class="settings-segmented__btn"><input type="radio" name="source" value=${source} ?checked=${source === "github"} /><span>${BOT_TRIGGER_SOURCE_LABELS[source]}</span></label>`)}
        </div>
      </fieldset>
      <div class="bot-trigger-form__when bot-trigger-form__when--github">
        <label class="bot-field"><span class="bot-field__label">Repos</span>
          <input class="settings-input" name="repos" type="text" placeholder="owner/name, owner/other" autocomplete="off" spellcheck="false" /></label>
        <fieldset class="bot-field">
          <legend class="bot-field__label">Events</legend>
          <div class="bot-trigger-form__checks">
            ${GITHUB_TRIGGER_EVENTS.map((event) => html`<label class="bot-trigger-form__check"><input type="checkbox" name="githubEvents" value=${event} ?checked=${DEFAULT_GITHUB_EVENTS.has(event)} /><span>${GITHUB_TRIGGER_EVENT_LABELS[event]}</span></label>`)}
          </div>
        </fieldset>
        <details class="bot-trigger-form__more">
          <summary class="bot-trigger-form__more-summary">Only some pull requests</summary>
          <div class="bot-trigger-form__grid">
            <label class="bot-field"><span class="bot-field__label">Authors</span><input class="settings-input" name="authors" type="text" placeholder="login, other" autocomplete="off" spellcheck="false" /></label>
            <label class="bot-field"><span class="bot-field__label">Labels</span><input class="settings-input" name="labels" type="text" placeholder="bug, needs review" autocomplete="off" /></label>
            <label class="bot-field"><span class="bot-field__label">Base branches</span><input class="settings-input" name="base" type="text" placeholder="main" autocomplete="off" spellcheck="false" /></label>
            <label class="bot-field"><span class="bot-field__label">Pull requests</span><input class="settings-input" name="pulls" type="text" placeholder="#12, #14" autocomplete="off" /></label>
            <label class="bot-field"><span class="bot-field__label">Drafts</span>
              <select class="settings-input" name="draft"><option value="any" selected>Drafts and ready</option><option value="drafts">Only drafts</option><option value="ready">Only ready for review</option></select></label>
          </div>
        </details>
        <p class="bot-field__hint">Read through the gateway's GitHub CLI login. Your own comments and reviews never wake ${name}.</p>
      </div>
      <div class="bot-trigger-form__when bot-trigger-form__when--session">
        <fieldset class="bot-field">
          <legend class="bot-field__label">When a session ${name} started</legend>
          <div class="bot-trigger-form__checks">
            ${SESSION_TRIGGER_EVENTS.map((event) => html`<label class="bot-trigger-form__check"><input type="checkbox" name="sessionEvents" value=${event} ?checked=${DEFAULT_SESSION_EVENTS.has(event)} /><span>${SESSION_TRIGGER_EVENT_LABELS[event]}</span></label>`)}
          </div>
        </fieldset>
      </div>
      <div class="bot-trigger-form__when bot-trigger-form__when--webhook">
        <p class="bot-field__hint">HUI makes a URL with a secret token and shows it once. Programs on this machine or your tailnet POST JSON or text to it (up to ${BOT_TRIGGER_LIMITS.body / 1024} KiB).</p>
        <fieldset class="bot-field">
          <legend class="bot-field__label">Only calls where (optional)</legend>
          <div class="bot-trigger-form__match">
            <input class="settings-input" name="matchField" type="text" placeholder="action" aria-label="JSON field" autocomplete="off" spellcheck="false" />
            <select class="settings-input" name="matchOp" aria-label="Comparison"><option value="equals" selected>equals</option><option value="contains">contains</option></select>
            <input class="settings-input" name="matchValue" type="text" placeholder="opened" aria-label="Value" autocomplete="off" />
          </div>
        </fieldset>
      </div>
      <div class="bot-trigger-form__when bot-trigger-form__when--slack">
        <div class="bot-trigger-form__preset">
          <button type="button" class="btn btn--sm bot-trigger-form__preset-button" @click=${applyReviewPreset}>${icons.messageSquare}<span>Review requests</span></button>
          <span class="bot-field__hint">Mentions and DMs that link a GitHub pull request.</span>
        </div>
        <fieldset class="bot-field">
          <legend class="bot-field__label">Slack messages that</legend>
          <div class="bot-trigger-form__checks">
            ${SLACK_TRIGGER_EVENTS.map((event) => html`<label class="bot-trigger-form__check"><input type="checkbox" name="slackEvents" value=${event} checked /><span>${SLACK_TRIGGER_EVENT_LABELS[event]}</span></label>`)}
          </div>
        </fieldset>
        <label class="bot-trigger-form__check"><input type="checkbox" name="slackPrLinks" /><span>Only with a GitHub pull request link (a thread's counts)</span></label>
        <details class="bot-trigger-form__more">
          <summary class="bot-trigger-form__more-summary">Only some people or channels</summary>
          <div class="bot-trigger-form__grid">
            <label class="bot-field"><span class="bot-field__label">From</span><input class="settings-input" name="slackFrom" type="text" placeholder="maria, @bob" autocomplete="off" spellcheck="false" /></label>
            <label class="bot-field"><span class="bot-field__label">In channels</span><input class="settings-input" name="slackIn" type="text" placeholder="#team-reviews" autocomplete="off" spellcheck="false" /></label>
            <label class="bot-trigger-form__check"><input type="checkbox" name="slackExternal" /><span>Also people outside your workspace (Slack Connect)</span></label>
            <label class="bot-trigger-form__check"><input type="checkbox" name="slackBots" /><span>Also bots and apps</span></label>
          </div>
        </details>
        <p class="bot-field__hint">Read as you, through Settings → Integrations → Slack, about once a minute; nothing is ever posted. Your own messages never wake ${name}, and what someone writes reaches ${name} as information, never as instructions. A message mentioning a user group doesn't count.</p>
      </div>
      <label class="bot-field"><span class="bot-field__label">Prompt</span>
        <textarea class="settings-input" name="prompt" rows="2" maxlength=${BOT_TRIGGER_LIMITS.prompt} placeholder=${`What should ${name} do when it fires?`}></textarea></label>
      <label class="bot-field bot-trigger-form__cooldown"><span class="bot-field__label">Cooldown</span>
        <select class="settings-input" name="cooldown">
          ${COOLDOWN_CHOICES.map((seconds) => html`<option value=${String(seconds)} ?selected=${seconds === BOT_TRIGGER_LIMITS.cooldownDefault}>${seconds ? cooldownLabel(seconds) : "None"}</option>`)}
        </select></label>
      <p class="bot-field__hint">Events within the cooldown of the last delivery arrive together, as one message. ${name} takes at most ${BOT_TRIGGER_LIMITS.perHour} trigger deliveries an hour; more wait.</p>
      ${state.formError ? html`<p class="bot-field__error" role="alert">${state.formError}</p>` : nothing}
      <div class="bot-trigger-form__actions"><button type="submit" class="btn primary btn--sm" ?disabled=${state.pending}>Add trigger</button></div>
    </form>
  </details>`;
}

/** The Triggers section, below the routines. */
export function renderBotTriggers(props: BotTriggersProps) {
  const { state } = props;
  const list = state.list;
  const headingId = `bot-triggers-${props.bot.id}`;
  let body;
  if (!list) {
    body = state.error
      ? html`<div class="bot-panel__state" role="alert">${state.error} <button type="button" class="btn btn--sm" @click=${props.onRetry}>Retry</button></div>`
      : html`<p class="bot-panel__state" role="status">Reading triggers…</p>`;
  } else {
    body = html`
      ${state.actionError ? html`<p class="bot-field__error" role="alert">${state.actionError}</p>` : nothing}
      ${state.notice ? html`<p class="bot-panel__hint bot-triggers__notice" role="status">${state.notice}</p>` : nothing}
      ${state.revealed ? renderRevealed(state.revealed, props) : nothing}
      ${list.triggers.length
        ? html`<ul class="bot-triggers__list" aria-label="Triggers">${list.triggers.map((trigger) => renderTrigger(trigger, props))}</ul>`
        : html`<p class="bot-panel__hint">No triggers yet. A trigger wakes ${props.bot.name} when something happens: a pull request changes on GitHub, a session it started finishes, fails or asks something, a program calls its webhook URL, or someone pings you in Slack.</p>`}
      ${renderForm(props, list.triggers.length === 0)}
      ${list.runs.length ? html`<h4 class="bot-triggers__subheading">Latest trigger runs</h4><ul class="bot-runs">${list.runs.slice(0, 10).map((run) => renderRun(run, props.now))}</ul>` : nothing}
      <p class="bot-panel__hint">${list.deliveries.lastHour} of ${list.deliveries.perHour} trigger deliveries in the last hour.</p>
      ${state.error ? html`<p class="bot-field__error" role="alert">Refresh failed: ${state.error}</p>` : nothing}`;
  }
  return html`<section class="bot-panel__section bot-triggers" aria-labelledby=${headingId}>
    <h3 class="bot-panel__heading" id=${headingId}>Triggers</h3>
    ${body}
  </section>`;
}
