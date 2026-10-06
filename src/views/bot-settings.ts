/**
 * A bot's Settings tab (HUI-18), after Grok Bot's "Bot settings": who the bot
 * is, the models it runs on, how it sounds on calls and where it works, as
 * compact rows in the style of HUI's Settings pages. Each change saves on its
 * own through `PATCH /__hui/bots/:id` (owned by `hui-app.ts`): its row says
 * while the save is pending and shows a refusal. There is no Save button.
 * Rendering only.
 */
import { html, nothing, type TemplateResult } from "lit";
import { botSettingOf, type BotSettingKey, type BotSettingValue, type BotView } from "../lib/bots.ts";
import type { RuntimeModel } from "../lib/sessions-store.ts";
import { BOT_FACE_COLORS, BOT_FACE_SHAPES, BOT_FACE_SHAPE_LABELS, BOT_LIMITS, BOT_THINKING_LEVELS, botColorName, isBotFaceShape, type BotAvatar, type BotFaceShape } from "../../shared/bots.ts";
import { facePath } from "../lib/bot-face.ts";
import { GPT_LIVE_VOICES, gptLiveVoiceLabel, type GptLiveVoice } from "../../shared/calls.ts";
import { languageOptions } from "../lib/voice.ts";
import { renderPicker } from "./settings-picker.ts";
import { renderDirectoryPicker } from "./directory-picker.ts";

export type { BotSettingKey, BotSettingValue } from "../lib/bots.ts";

/** Per row: the value a save is sending (shown until the gateway answers) and the last refusal. */
export type BotSettingsSaves = {
  pending: Partial<Record<BotSettingKey, BotSettingValue>>;
  errors: Partial<Record<BotSettingKey, string>>;
};

export const NO_BOT_SETTINGS_SAVES: BotSettingsSaves = { pending: {}, errors: {} };

/** The Calls section: GPT-Live's default voice, which a bot's "Default" follows. */
export type BotSettingsCall = { defaultVoice: GptLiveVoice };

export type BotSettingsProps = {
  bot: BotView;
  /** Prefix of the tab's element ids. */
  id: string;
  /** Draws the bot's face, or its emoji, for a look (the one a save is sending), as the roster does. */
  face: (avatar: BotAvatar) => TemplateResult;
  models: readonly RuntimeModel[];
  /** The name of Settings' utility model, the bot's while it has none of its own. */
  utilityDefault?: string;
  saves: BotSettingsSaves;
  onChange: (key: BotSettingKey, value: BotSettingValue) => void;
  /** Drops a control's refusal, as Escape does in a text field. */
  onDismiss: (key: BotSettingKey) => void;
  /** The Calls section, always shown: calls run on GPT-Live. */
  call: BotSettingsCall;
  directory: { suggestions: readonly string[]; onInput: (value: string) => void };
};

const THINKING_LABELS: Record<(typeof BOT_THINKING_LEVELS)[number], string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" };
/** "Gateway default" sends "": the bot goes back to the model and thinking level a new chat gets. */
const THINKING_CHOICES = [{ value: "", label: "Gateway default" }, ...BOT_THINKING_LEVELS.map((level) => ({ value: level, label: THINKING_LABELS[level] }))];

/** `empty` labels the default choice, the empty value. */
function modelOptions(models: readonly RuntimeModel[], empty: string, current: string) {
  const options = [{ value: "", label: empty }, ...models.map((model) => ({ value: `${model.provider}/${model.id}`, label: model.name, description: model.provider }))];
  // A model no longer in the catalog still shows what the bot runs on.
  return current && !options.some((option) => option.value === current) ? [...options, { value: current, label: current }] : options;
}

/** Every language's English name and code, read once: they never change while HUI runs. */
let languageChoices: ReturnType<typeof languageOptions> | undefined;

/** The value a row shows: the one a save is sending, else the bot's. */
export function botSettingValue(bot: BotView, saves: BotSettingsSaves, key: BotSettingKey): BotSettingValue {
  return saves.pending[key] ?? botSettingOf(bot, key);
}

/** While a turn runs, starts or waits for an answer, the bot's workspace cannot move (the gateway refuses it). */
export function botIsBusy(bot: Pick<BotView, "status">): boolean {
  return bot.status === "running" || bot.status === "starting" || bot.status === "waiting";
}

type RowOptions = {
  /** `data-setting`, for tests and styles. */
  setting: string;
  /** What the row saves: its pending state and refusals follow these keys. */
  keys?: readonly BotSettingKey[];
  title: string;
  /** Names a native control; the pickers name themselves. */
  labelFor?: string;
  desc?: unknown;
  control: unknown;
  /** The title above a full-width control, where the panel leaves the control no room beside it. */
  stacked?: boolean;
};

/** One compact row: title and short description, the control beside them (or under them when stacked), the
 * save's state on the title line, so a save never moves the rows, and a refusal under it all. */
function renderRow(props: BotSettingsProps, options: RowOptions) {
  const keys = options.keys ?? [];
  const pending = keys.some((key) => props.saves.pending[key] !== undefined);
  const errors = keys.flatMap((key) => props.saves.errors[key] ?? []);
  const title = options.labelFor
    ? html`<label class="settings-row__title" for=${options.labelFor}>${options.title}</label>`
    : html`<span class="settings-row__title">${options.title}</span>`;
  return html`<div class="settings-row bot-setting ${options.stacked ? "bot-setting--stacked" : ""}" data-setting=${options.setting} aria-busy=${pending ? "true" : "false"}>
    <div class="settings-row__text">
      <div class="bot-setting__title">${title}<span class="bot-setting__status" role="status">${pending ? "Saving…" : ""}</span></div>
      ${options.desc ? html`<span class="settings-row__desc">${options.desc}</span>` : nothing}
    </div>
    <div class="settings-row__control">${options.control}</div>
    ${errors.length ? html`<p class="bot-setting__error" role="alert">${errors.join(" ")}</p>` : nothing}
  </div>`;
}

function sectionHead(props: BotSettingsProps, section: string, title: string, note?: string) {
  return html`<div class="bot-settings__head"><h3 class="bot-panel__heading" id=${`${props.id}-settings-${section}`}>${title}</h3>${note ? html`<span class="bot-settings__note">${note}</span>` : nothing}</div>`;
}

/** A shape's outline, small, for its chip. */
function shapeIcon(shape: BotFaceShape) {
  return html`<svg class="bot-look__shape-icon" viewBox="16 22 88 88" aria-hidden="true" focusable="false"><path d=${facePath(shape)}></path></svg>`;
}

/** The look: a summary row with the face, opening into Face (shape and color) or Emoji. Each choice saves on its
 * own; choosing Emoji saves once one is typed, and Face clears the emoji. Native radio groups: Tab enters each
 * group, arrows choose. */
function renderLook(props: BotSettingsProps) {
  const { bot, saves, id } = props;
  const shape = botSettingValue(bot, saves, "shape");
  const color = botSettingValue(bot, saves, "color");
  const emoji = botSettingValue(bot, saves, "emoji");
  const keys: readonly BotSettingKey[] = ["shape", "color", "emoji"];
  const pending = keys.some((key) => saves.pending[key] !== undefined);
  const errors = keys.flatMap((key) => saves.errors[key] ?? []);
  const face = isBotFaceShape(shape) ? shape : "blob";
  const custom = BOT_FACE_COLORS.some((entry) => entry.hex === color) ? undefined : color;
  const swatches = [...BOT_FACE_COLORS.map((entry) => ({ hex: entry.hex, label: entry.label })), ...(custom ? [{ hex: custom, label: `Custom ${custom}` }] : [])];
  const avatar: BotAvatar = { shape: face, color, ...(emoji ? { emoji } : {}) };
  const kind = emoji ? "emoji" : "face";
  return html`<details class="settings-row bot-setting bot-look" data-setting="look">
    <summary class="bot-look__summary" aria-label=${`Look: ${emoji ? `emoji ${emoji}` : `${BOT_FACE_SHAPE_LABELS[face]}, ${botColorName(color)}`}`}>
      ${props.face(avatar)}
      <span class="settings-row__text">
        <span class="bot-setting__title"><span class="settings-row__title">Look</span><span class="bot-setting__status" role="status">${pending ? "Saving…" : ""}</span></span>
        <span class="settings-row__desc">${emoji ? `Emoji ${emoji}` : `${BOT_FACE_SHAPE_LABELS[face]} · ${botColorName(color)}`}</span>
      </span>
      <span class="bot-look__change" aria-hidden="true"></span>
    </summary>
    <div class="bot-look__editor">
      <div class="settings-segmented bot-look__kind" role="radiogroup" aria-label="Look">
        ${([["face", "Face"], ["emoji", "Emoji"]] as const).map(([value, label]) => html`<label class="settings-segmented__btn">
          <input type="radio" name=${`${id}-look`} value=${value} .checked=${kind === value}
            @change=${() => { if (value === "face" && botSettingOf(bot, "emoji")) props.onChange("emoji", ""); }} /><span>${label}</span></label>`)}
      </div>
      <div class="bot-look__face">
        <div class="bot-look__shapes" role="radiogroup" aria-label="Shape">
          ${BOT_FACE_SHAPES.map((option) => html`<label class="bot-look__chip" style=${`--bot-look-color: ${color}`} title=${BOT_FACE_SHAPE_LABELS[option]}>
            <input type="radio" name=${`${id}-shape`} value=${option} aria-label=${BOT_FACE_SHAPE_LABELS[option]} .checked=${face === option}
              @change=${() => props.onChange("shape", option)} />${shapeIcon(option)}</label>`)}
        </div>
        <div class="bot-look__colors" role="radiogroup" aria-label="Color">
          ${swatches.map((entry) => html`<label class="bot-look__swatch" style=${`--swatch: ${entry.hex}`} title=${entry.label}>
            <input type="radio" name=${`${id}-color`} value=${entry.hex} aria-label=${entry.label} .checked=${color === entry.hex}
              @change=${() => props.onChange("color", entry.hex)} /></label>`)}
        </div>
      </div>
      <label class="bot-look__emoji"><span class="settings-row__desc">Emoji</span>
        <input class="settings-input" name="emoji" type="text" maxlength="16" autocomplete="off" placeholder="🤖" .value=${botSettingOf(bot, "emoji")}
          @keydown=${(event: KeyboardEvent) => onTextKeydown(event, "emoji", props)} @blur=${(event: FocusEvent) => onTextBlur(event, "emoji", props)} /></label>
      <span class="settings-row__desc bot-look__hint">Its face shows what it is doing: thinking, using tools, waiting for you, listening and speaking on calls. An emoji has no expressions.</span>
    </div>
    ${errors.length ? html`<p class="bot-setting__error" role="alert">${errors.join(" ")}</p>` : nothing}
  </details>`;
}

/** Name, title and look, edited in place: the bot can also set them itself as it learns who it is. */
function renderProfile(props: BotSettingsProps) {
  const { bot } = props;
  const nameId = `${props.id}-settings-name`;
  const titleId = `${props.id}-settings-title`;
  return html`<section class="bot-settings__section" aria-labelledby=${`${props.id}-settings-profile`}>
    ${sectionHead(props, "profile", "Profile")}
    <div class="settings-group bot-settings__group">
      ${renderRow(props, { setting: "name", keys: ["name"], title: "Name", labelFor: nameId, desc: `@${bot.handle}`,
        control: html`<input class="settings-input" id=${nameId} name="name" type="text" required maxlength=${BOT_LIMITS.name} autocomplete="off" .value=${bot.name}
          @keydown=${(event: KeyboardEvent) => onTextKeydown(event, "name", props)} @blur=${(event: FocusEvent) => onTextBlur(event, "name", props)} />` })}
      ${renderRow(props, { setting: "title", keys: ["title"], title: "Title", labelFor: titleId,
        control: html`<input class="settings-input" id=${titleId} name="title" type="text" maxlength=${BOT_LIMITS.title} autocomplete="off" placeholder="Add a title" .value=${bot.title ?? ""}
          @keydown=${(event: KeyboardEvent) => onTextKeydown(event, "title", props)} @blur=${(event: FocusEvent) => onTextBlur(event, "title", props)} />` })}
      ${renderLook(props)}
    </div>
  </section>`;
}

function renderModels(props: BotSettingsProps) {
  const value = (key: BotSettingKey) => botSettingValue(props.bot, props.saves, key);
  const model = value("model");
  const thinking = value("thinking");
  const utility = value("memoryModel");
  return html`<section class="bot-settings__section" aria-labelledby=${`${props.id}-settings-model`}>
    ${sectionHead(props, "model", "Model", "Applies from its next turn")}
    <div class="settings-group bot-settings__group">
      ${renderRow(props, { setting: "model", keys: ["model"], stacked: true, title: "Model", desc: "The smartest you have. Speed doesn't matter.",
        control: renderPicker({ label: "Model", value: model, searchable: true, searchPlaceholder: "Search models",
          options: modelOptions(props.models, "Gateway default", model), onChange: (next) => props.onChange("model", next) }) })}
      ${renderRow(props, { setting: "thinking", keys: ["thinking"], title: "Thinking",
        control: renderPicker({ label: "Thinking", value: thinking, options: THINKING_CHOICES, onChange: (next) => props.onChange("thinking", next) }) })}
      ${renderRow(props, { setting: "utility", keys: ["memoryModel"], stacked: true, title: "Utility model",
        desc: "The fastest you have, ideally cheap: memory summaries and quick answers on calls.",
        control: renderPicker({ label: "Utility model", value: utility, searchable: true, searchPlaceholder: "Search models",
          options: modelOptions(props.models, props.utilityDefault ? `Default (${props.utilityDefault})` : "Default (same as the bot)", utility),
          onChange: (next) => props.onChange("memoryModel", next) }) })}
    </div>
  </section>`;
}

/** The call voice: GPT-Live's own voices, "Default" following Settings → Models → Calls. */
function renderCallVoiceRow(props: BotSettingsProps, call: BotSettingsCall) {
  const value = botSettingValue(props.bot, props.saves, "callVoice");
  const options = [{ value: "", label: `Default (${gptLiveVoiceLabel(call.defaultVoice)})` }, ...GPT_LIVE_VOICES.map((voice) => ({ value: voice, label: gptLiveVoiceLabel(voice) }))];
  return renderRow(props, { setting: "call-voice", keys: ["callVoice"], stacked: true, title: "Call voice",
    desc: "How it sounds on calls. Default follows Settings → Models → Calls.",
    control: renderPicker({ label: "Call voice", value, options, onChange: (next) => props.onChange("callVoice", next) }) });
}

/** The language it speaks on calls; Auto answers in the caller's. */
function renderLanguageRow(props: BotSettingsProps) {
  languageChoices ??= languageOptions();
  const value = botSettingValue(props.bot, props.saves, "voiceLanguage");
  return renderRow(props, { setting: "language", keys: ["voiceLanguage"], title: "Language", desc: "Auto answers in yours.",
    control: renderPicker({ label: "Language", value, searchable: true, searchPlaceholder: "Search languages", options: languageChoices,
      onChange: (next) => props.onChange("voiceLanguage", next) }) });
}

/** Calls, on GPT-Live, the only engine: always shown. */
function renderCalls(props: BotSettingsProps) {
  return html`<section class="bot-settings__section" aria-labelledby=${`${props.id}-settings-calls`}>
    ${sectionHead(props, "calls", "Calls")}
    <div class="settings-group bot-settings__group">
      ${renderCallVoiceRow(props, props.call)}
      ${renderLanguageRow(props)}
    </div>
  </section>`;
}

/** The text controls: they save on Enter or when the focus leaves them. */
type TextKey = "name" | "title" | "emoji" | "cwd";

/** Saves what a text control holds, if it changed. An emptied name, emoji or directory keeps the bot's (only a
 * title can be cleared). Leaving the control does not send again what it already sent (a refused value stays
 * refused until it is edited); Enter does. */
function commitText(input: HTMLInputElement, key: TextKey, props: BotSettingsProps, explicit: boolean) {
  const current = botSettingOf(props.bot, key);
  const value = input.value.trim();
  if (!value && key !== "title") {
    input.value = current;
    return;
  }
  if (value === current || (!explicit && input.dataset["sent"] === value)) return;
  input.dataset["sent"] = value;
  props.onChange(key, value);
}

/** The directory's suggestions are open and list something, so Escape is theirs to close. */
function suggestionsShowing(input: HTMLInputElement): boolean {
  return input.getAttribute("aria-expanded") === "true" && Boolean(input.closest(".new-session-page__directory-picker")?.querySelector('[role="option"]'));
}

/** Enter saves; Escape takes back what was typed, before it closes anything (the directory's suggestions first).
 * Keys from a suggestion choose it. */
function onTextKeydown(event: KeyboardEvent, key: TextKey, props: BotSettingsProps) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitText(input, key, props, true);
  } else if (event.key === "Escape" && !event.defaultPrevented && input.value !== botSettingOf(props.bot, key) && !suggestionsShowing(input)) {
    event.preventDefault();
    event.stopPropagation();
    input.value = botSettingOf(props.bot, key);
    if (key === "cwd") input.setAttribute("aria-expanded", "false");
    delete input.dataset["sent"];
    props.onDismiss(key);
  }
}

function onTextBlur(event: FocusEvent, key: TextKey, props: BotSettingsProps) {
  const input = event.target;
  if (input instanceof HTMLInputElement && !input.disabled) commitText(input, key, props, false);
}

/** The directory field saves when the focus leaves it and its suggestions alike. */
function onDirectoryFocusOut(event: FocusEvent, props: BotSettingsProps) {
  const field = event.currentTarget as HTMLElement;
  if (event.relatedTarget instanceof Node && field.contains(event.relatedTarget)) return;
  const input = field.querySelector("input");
  if (input && !input.disabled) commitText(input, "cwd", props, false);
}

function renderWorkspace(props: BotSettingsProps) {
  const busy = botIsBusy(props.bot);
  const inputId = `${props.id}-settings-cwd`;
  return html`<section class="bot-settings__section" aria-labelledby=${`${props.id}-settings-workspace`}>
    ${sectionHead(props, "workspace", "Workspace")}
    <div class="settings-group bot-settings__group">
      ${renderRow(props, { setting: "workspace", keys: ["cwd"], stacked: true, title: "Directory", labelFor: inputId,
        desc: busy ? "It is working. The directory can change once it is idle." : "Where it works. Can change only while it is idle.",
        control: html`<div class="bot-settings__directory" @keydown=${{ handleEvent: (event: KeyboardEvent) => onTextKeydown(event, "cwd", props), capture: true }}
          @focusout=${(event: FocusEvent) => onDirectoryFocusOut(event, props)}>
          ${renderDirectoryPicker({ id: inputId, label: "Directory", value: props.bot.cwd, suggestions: props.directory.suggestions, onInput: props.directory.onInput,
            inputClass: "settings-input", externalLabel: true, disabled: busy })}
        </div>` })}
    </div>
  </section>`;
}

export function renderBotSettings(props: BotSettingsProps) {
  return html`<div class="bot-settings">
    ${renderProfile(props)}
    ${renderModels(props)}
    ${renderCalls(props)}
    ${renderWorkspace(props)}
  </div>`;
}
