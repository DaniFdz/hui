/**
 * The effort selector shared by the chat composer, New Session and Settings → Models: a gauge trigger that reads the
 * level at a glance, and a slider whose fill, dots and thumb grow steadily from the cheapest reasoning to the model's
 * highest. It renders the same markup everywhere; each caller owns the panel's placement and dismissal so the composer
 * keeps its popover lane and Settings anchors the panel under its row.
 */
import { html, nothing } from "lit";
import { icons } from "../lib/icons.ts";
import { THINKING_LABELS, isThinkingLevel, PI_THINKING_LEVELS, THINKING_LEVELS, type ThinkingLevel } from "../lib/thinking.ts";

/** The trigger's gauge arc: a 240° dial from the lower left to the lower right. */
const GAUGE_ARC = "M3.34 17a10 10 0 1 1 17.32 0";

export type EffortState = {
  /** The level shown: the caller's level, fitted to the levels the model offers. */
  level: ThinkingLevel;
  /** The caller has no level of its own (Settings' Use PI default): the slider is unanchored. */
  unset: boolean;
  index: number;
  /** 0 at Off or unset, 1 at the highest offered level. */
  fraction: number;
  /** "ultra" at Ultra, "max" at the model's highest PI level, "" otherwise. */
  boost: "" | "max" | "ultra";
};

export type EffortSelectorOptions = {
  /** The control's name, before the colon: "Thinking" or "Default reasoning". */
  label: string;
  /** The current level; "" is the unset state when `unset` is given. */
  level: string;
  /** The levels to offer, cheapest first. An empty list offers all of PI's levels. */
  levels: readonly string[] | undefined;
  disabled: boolean;
  /** Present when the value may stay unset: the trigger's label for it and the panel's action. */
  unset?: { label: string; action: string };
  /** What the accessible name names after the colon; defaults to the raw level (Thinking: low). */
  ariaValue?: string;
  fast?: { on: boolean; onSelect: (fast: boolean) => void };
  /** Autonomous mode: the session leads its own task and reports each stop to its chief of staff. */
  autonomy?: { on: boolean; onSelect: (on: boolean) => void };
  /** The panel is light-dismissed (Settings), or stays until its trigger closes it (composer). */
  dismissable?: boolean;
  /** Close the panel after a selection (Settings) or leave it open for another adjustment (composer). */
  closeOnSelect?: boolean;
  /** Extra class on the picker, for a caller's own trigger treatment (Settings' bordered row control). */
  className?: string;
  /** The trigger's chevron points where the panel opens. */
  chevron?: "up" | "down";
  onSelect: (level: string) => void;
  onToggle: (event: Event) => void;
  onKeydown?: (event: KeyboardEvent) => void;
  onOpen?: (event: MouseEvent) => void;
  onPanelToggle?: (event: Event) => void;
};

/** The level a selector shows for `level`, fitted to the offered levels. Ultra is a mode chosen on its own, never what
 * a higher saved level fits to. */
export function shownThinking(level: string, levels: readonly ThinkingLevel[]): ThinkingLevel {
  if (level === "ultra" && levels.includes("ultra")) return "ultra";
  const sent: readonly ThinkingLevel[] = levels.filter((candidate) => candidate !== "ultra");
  return sent.includes(level as ThinkingLevel)
    ? level as ThinkingLevel
    : sent.find((candidate) => thinkingRank(candidate) >= thinkingRank(level)) ?? sent.at(-1) ?? "medium";
}

function thinkingRank(level: string): number {
  return THINKING_LEVELS.indexOf(level as ThinkingLevel);
}

/** Where `level` sits on the selector's scale, and whether it is the model's top level or Ultra. */
export function effortState(value: string, levels: readonly string[] | undefined): EffortState {
  const known = (levels ?? []).filter(isThinkingLevel);
  const offered: readonly ThinkingLevel[] = known.length ? known : PI_THINKING_LEVELS;
  const unset = value === "";
  const level = unset ? offered[0] ?? "off" : shownThinking(value, offered);
  const index = Math.max(0, offered.indexOf(level));
  const last = Math.max(1, offered.length - 1);
  const top = offered.findLastIndex((candidate) => candidate !== "ultra");
  const boost = level === "ultra" ? "ultra" : index === top && top > 0 ? "max" : "";
  return { level, unset, index, fraction: unset ? 0 : index / last, boost };
}

/** Places the panel on its preferred side of the trigger, inside the viewport, and hides it when the trigger closes. */
export function placeEffortPanel(details: HTMLDetailsElement, preferred: "above" | "below"): void {
  const trigger = details.querySelector<HTMLElement>(":scope > summary");
  const menu = details.querySelector<HTMLElement>(".chat-controls__inline-select-menu");
  if (!trigger || !menu) return;
  if (!details.open) {
    menu.hidePopover?.();
    return;
  }
  menu.showPopover?.();
  const rect = trigger.getBoundingClientRect();
  const spaceAbove = rect.top - 20;
  const spaceBelow = window.innerHeight - rect.bottom - 20;
  const side = (preferred === "above" ? spaceAbove : spaceBelow) >= 160
    ? preferred
    : (preferred === "above" ? spaceBelow : spaceAbove) > (preferred === "above" ? spaceAbove : spaceBelow)
      ? preferred === "above" ? "below" : "above"
      : preferred;
  menu.style.position = "fixed";
  menu.style.right = "auto";
  menu.style.left = `${Math.max(12, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 12))}px`;
  if (side === "above") {
    menu.style.top = "auto";
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    menu.style.setProperty("--auto-size-available-height", `${Math.max(80, spaceAbove)}px`);
  } else {
    menu.style.bottom = "auto";
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.setProperty("--auto-size-available-height", `${Math.max(80, spaceBelow)}px`);
  }
}

/** Escape closes the panel and returns the keyboard to its trigger. */
export function closeEffortSelector(event: KeyboardEvent): void {
  const details = event.currentTarget;
  if (!(details instanceof HTMLDetailsElement) || !details.open) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  details.open = false;
  details.querySelector<HTMLElement>("summary")?.focus();
}

function closePanel(element: Element): void {
  const details = element.closest("details");
  if (details) {
    details.open = false;
    details.querySelector<HTMLElement>("summary")?.focus();
  }
}

export function renderEffortSelector(options: EffortSelectorOptions) {
  const state = effortState(options.level, options.levels);
  const unset = state.unset && Boolean(options.unset);
  const shown = unset ? options.unset!.label : THINKING_LABELS[state.level];
  const ariaValue = options.ariaValue ?? (unset ? options.unset!.label : options.level || state.level);
  const known = (options.levels ?? []).filter(isThinkingLevel);
  const levels: readonly ThinkingLevel[] = known.length ? known : PI_THINKING_LEVELS;
  const angle = -120 + state.fraction * 240;
  const { fast, autonomy } = options;
  const disabled = options.disabled || (levels.length < 2 && !fast && !autonomy);
  const label = `${options.label}: ${ariaValue}${fast?.on ? ", fast" : ""}${autonomy?.on ? ", autonomous" : ""}`;
  const setValue = (at: number, element: Element) => {
    const next = levels[at] ?? state.level;
    options.onSelect(next);
    if (options.closeOnSelect) closePanel(element);
  };
  return html`<details class=${`chat-controls__inline-select chat-controls__effort-picker ${options.className ?? ""}`} @keydown=${options.onKeydown} @toggle=${options.onToggle}>
    <summary class="chat-controls__inline-select-trigger chat-controls__effort-trigger ${disabled ? "chat-controls__inline-select-trigger--disabled" : ""}" aria-label=${label} aria-disabled=${String(disabled)} @click=${(event: MouseEvent) => {
      if (disabled) event.preventDefault();
      else options.onOpen?.(event);
    }}>
      <span class="chat-controls__effort-gauge ${unset ? "chat-controls__effort-gauge--unset" : ""} ${state.level === "off" ? "chat-controls__effort-gauge--off" : ""}" style=${`--effort-fill: ${state.fraction}`} data-effort-boost=${state.boost || nothing} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path class="chat-controls__effort-gauge-dial" d=${GAUGE_ARC} pathLength="100"></path>
          <path class="chat-controls__effort-gauge-arc" d=${GAUGE_ARC} pathLength="100" stroke-dasharray="100" stroke-dashoffset=${100 - state.fraction * 100}></path>
          <path class="chat-controls__effort-gauge-needle" d="M12 12V6" style=${`transform: rotate(${angle}deg)`}></path>
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"></circle>
          ${state.boost === "ultra" ? html`<circle class="chat-controls__effort-gauge-orbit" cx="12" cy="12" r="10" pathLength="100" stroke-dasharray="7 93"></circle>` : nothing}
        </svg>
        ${fast?.on ? html`<span class="chat-controls__effort-fast-badge">${icons.zap}</span>` : nothing}
      </span>
      ${fast?.on ? html`<span class="chat-controls__effort-zap" aria-hidden="true">${icons.zap}</span>` : nothing}
      <span class="chat-controls__inline-select-label">${shown}</span>
      <span class="chat-controls__inline-select-chevron" aria-hidden="true">${options.chevron === "down" ? icons.chevronDown : icons.chevronUp}</span>
    </summary>
    <div class="chat-controls__inline-select-menu chat-controls__effort-menu" popover=${options.dismissable ? "auto" : "manual"} @toggle=${options.onPanelToggle ?? nothing}>
      ${levels.length > 1 ? html`<div class="chat-controls__reasoning-panel">
        <div class="chat-controls__reasoning-head">
          <span class="chat-controls__effort-heading">Effort</span>
          <span class="chat-controls__effort-value" aria-hidden="true" .textContent=${shown}></span>
        </div>
        <div class="chat-controls__reasoning-slider" data-effort-boost=${state.boost || nothing} style=${`--effort-fill: ${state.fraction}`}>
          <div class="chat-controls__reasoning-spectrum" aria-hidden="true"></div>
          <div class="chat-controls__reasoning-dots" aria-hidden="true">
            ${levels.map((_, at) => html`<span class="chat-controls__reasoning-dot" data-state=${at < state.index ? "passed" : at === state.index ? "current" : "ahead"}></span>`)}
          </div>
          <input
            class="chat-controls__reasoning-range ${unset ? "chat-controls__reasoning-range--unset" : ""}"
            type="range"
            min="0"
            max=${String(levels.length - 1)}
            step="1"
            .value=${String(state.index)}
            style=${`--effort-fill: ${state.fraction}`}
            data-effort-boost=${state.boost || nothing}
            aria-label="Thinking effort"
            aria-valuetext=${shown}
            ?disabled=${options.disabled}
            @input=${(event: Event) => {
              const input = event.currentTarget as HTMLInputElement;
              const at = Number(input.value);
              const next = levels[at] ?? state.level;
              const fraction = levels.length > 1 ? at / (levels.length - 1) : 0;
              input.style.setProperty("--effort-fill", String(fraction));
              input.setAttribute("aria-valuetext", THINKING_LABELS[next]);
              input.dataset["effortBoost"] = next === "ultra" ? "ultra" : at === levels.length - 1 && next !== "off" ? "max" : "";
              const panel = input.closest(".chat-controls__reasoning-panel");
              const slider = input.closest<HTMLElement>(".chat-controls__reasoning-slider");
              if (slider) slider.style.setProperty("--effort-fill", String(fraction));
              const value = panel?.querySelector(".chat-controls__effort-value");
              if (value) value.textContent = THINKING_LABELS[next];
              const dots = panel?.querySelectorAll(".chat-controls__reasoning-dot");
              dots?.forEach((dot, index) => dot.setAttribute("data-state", index < at ? "passed" : index === at ? "current" : "ahead"));
            }}
            @change=${(event: Event) => setValue(Number((event.currentTarget as HTMLInputElement).value), event.currentTarget as HTMLInputElement)}
          />
        </div>
        <div class="chat-controls__effort-scale" aria-hidden="true"><span>Faster</span><span>Smarter</span></div>
        ${options.unset ? html`<div class="chat-controls__effort-default">
          <button type="button" class="chat-controls__effort-default-action" aria-pressed=${String(unset)} @click=${(event: Event) => {
            closePanel(event.currentTarget as HTMLElement);
            options.onSelect("");
          }}>${options.unset.action}</button>
        </div>` : nothing}
      </div>` : nothing}
      ${fast ? html`<div class="chat-controls__speed-panel">
        <span class="chat-controls__effort-heading">Speed</span>
        <div class="chat-controls__speed-options" role="radiogroup" aria-label="Speed">
          ${([[false, "Standard"], [true, "Fast"]] as const).map(([value, text]) => html`<button type="button" role="radio"
            class="chat-controls__speed-option" aria-checked=${String(fast.on === value)} ?disabled=${options.disabled}
            @click=${() => { if (fast.on !== value) fast.onSelect(value); }}>${text}</button>`)}
        </div>
      </div>` : nothing}
      ${autonomy ? html`<div class="chat-controls__speed-panel">
        <span class="chat-controls__effort-heading">Autonomy</span>
        <div class="chat-controls__speed-options" role="radiogroup" aria-label="Autonomy">
          ${([[false, "Supervised"], [true, "Autonomous"]] as const).map(([value, text]) => html`<button type="button" role="radio"
            class="chat-controls__speed-option" aria-checked=${String(autonomy.on === value)} ?disabled=${options.disabled}
            @click=${() => { if (autonomy.on !== value) autonomy.onSelect(value); }}>${text}</button>`)}
        </div>
      </div>` : nothing}
    </div>
  </details>`;
}
