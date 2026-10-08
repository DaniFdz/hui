/**
 * Importing a bot (the roster's + → Import bot…) and exporting one (its ⋯ → Export…). Rendering only: `hui-app.ts`
 * owns the state and every request (`lib/bot-templates.ts`). The import dialog has two steps: the source (a file or a
 * folder, a Grok Bot link, or pasted text), then the gateway's preview of everything creating it would do, which shows
 * all of the imported text, since it is untrusted, before Create.
 */
import { html, nothing, type TemplateResult } from "lit";
import { BOT_TEMPLATE_FORMATS, BOT_TEMPLATE_LIMITS, type BotImportPreview } from "../../shared/bot-templates.ts";
import type { BotView } from "../lib/bots.ts";
import type { BotImportTab, PickedSource } from "../lib/bot-templates.ts";
import { icons } from "../lib/icons.ts";
import { renderBotAvatar, type BotPlace } from "./bots.ts";
import { describeRoutineSchedule } from "./settings-automation.ts";
import { loadViewAssets } from "../lib/view-assets.ts";

loadViewAssets(() => import("../styles/bot-import.css"));

export type BotImportDialogProps = {
  step: "source" | "preview";
  tab: BotImportTab;
  picked?: PickedSource | undefined;
  url: string;
  text: string;
  /** Remote workers a bot can be imported onto; none: this machine only. */
  workers: readonly BotPlace[];
  /** The chosen worker's id; "" for this machine. */
  worker: string;
  /** Reading a source, or creating the bot. */
  pending: boolean;
  error: string;
  preview?: BotImportPreview | undefined;
  onTab: (tab: BotImportTab) => void;
  onPickFile: (file: File) => void;
  onPickFolder: (files: File[]) => void;
  onUrl: (value: string) => void;
  onText: (value: string) => void;
  onWorker: (id: string) => void;
  onPreview: () => void;
  /** Another agent of a file that holds several. */
  onPick: (key: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onClose: () => void;
};

const TABS: readonly [BotImportTab, string][] = [["file", "File or folder"], ["link", "Link"], ["paste", "Paste"]];
const ACCEPT = ".zip,.json,.af,.png,.md,.markdown,.yaml,.yml,.txt";
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What HUI reads, one line, for the source step. */
export const IMPORT_FORMATS_HINT = "HUI reads Grok Bot links, OpenClaw workspaces (a folder or a zip), Claude Code subagents (.claude/agents/*.md), Letta agent files (.af), character cards (JSON or PNG), CrewAI agents.yaml and HUI exports. Other text becomes the bot's persona.";

function renderSourceStep(props: BotImportDialogProps) {
  const tab = props.tab;
  return html`<fieldset class="bot-import__tabs">
      <legend class="sr-only">Import from</legend>
      <div class="settings-segmented bot-import__tablist">
        ${TABS.map(([value, label]) => html`<label class="settings-segmented__btn"><input type="radio" name="bot-import-tab" value=${value} .checked=${tab === value}
          @change=${() => props.onTab(value)} /><span>${label}</span></label>`)}
      </div>
    </fieldset>
    ${tab === "file" ? html`<div class="bot-import__drop ${props.picked ? "bot-import__drop--picked" : ""}"
        @dragover=${(event: DragEvent) => { event.preventDefault(); }}
        @drop=${(event: DragEvent) => {
          event.preventDefault();
          const file = event.dataTransfer?.files[0];
          if (file) props.onPickFile(file);
        }}>
        <span class="bot-import__drop-icon" aria-hidden="true">${props.picked ? icons.check : icons.fileText}</span>
        <p class="bot-import__drop-label" aria-live="polite">${props.picked ? props.picked.label : "Drop a file here, or choose a file or a folder."}</p>
        <div class="bot-import__pick">
          <label class="btn btn--sm">Choose file…<input class="sr-only" type="file" accept=${ACCEPT} ?disabled=${props.pending} @change=${(event: Event) => {
            const input = event.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            if (file) props.onPickFile(file);
            input.value = "";
          }} /></label>
          <label class="btn btn--sm">Choose folder…<input class="sr-only" type="file" webkitdirectory multiple ?disabled=${props.pending} @change=${(event: Event) => {
            const input = event.currentTarget as HTMLInputElement;
            const files = [...input.files ?? []];
            if (files.length) props.onPickFolder(files);
            input.value = "";
          }} /></label>
        </div>
        <p class="bot-import__hint">One file up to ${BOT_TEMPLATE_LIMITS.fileBytes / 1024 / 1024} MB, or a folder up to ${BOT_TEMPLATE_LIMITS.totalBytes / 1024 / 1024} MB.</p>
      </div>` : nothing}
    ${tab === "link" ? html`<label class="bot-import__field">
        <span class="bot-import__label">Grok Bot marketplace link</span>
        <input class="settings-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://x.ai/bot/marketplace/bots/…"
          .value=${props.url} ?disabled=${props.pending} @input=${(event: Event) => props.onUrl((event.currentTarget as HTMLInputElement).value)} />
        <span class="bot-import__hint">HUI fetches this page once, now. If x.ai changed it and HUI can't read it, copy the bot's instructions and paste them instead.</span>
      </label>` : nothing}
    ${tab === "paste" ? html`<label class="bot-import__field">
        <span class="bot-import__label">Template</span>
        <textarea class="settings-input bot-import__paste" rows="9" spellcheck="false" ?disabled=${props.pending}
          placeholder="A Claude Code subagent, a character card's JSON, an agents.yaml, a Letta agent file, or a Grok Bot's instructions…"
          .value=${props.text} @input=${(event: Event) => props.onText((event.currentTarget as HTMLTextAreaElement).value)}></textarea>
      </label>` : nothing}
    ${props.workers.length ? html`<label class="bot-import__field bot-import__field--inline">
        <span class="bot-import__label">Runs on</span>
        <select class="settings-input" ?disabled=${props.pending} @change=${(event: Event) => props.onWorker((event.currentTarget as HTMLSelectElement).value)}>
          <option value="" ?selected=${!props.worker}>Local</option>
          ${props.workers.map((worker) => html`<option value=${worker.id} ?selected=${props.worker === worker.id}>${worker.name}${worker.state === "connected" ? "" : ` (${worker.state === "error" ? "offline" : worker.state})`}</option>`)}
        </select>
      </label>` : nothing}
    <p class="bot-import__hint">${IMPORT_FORMATS_HINT}</p>`;
}

function section(title: string, count: string | undefined, body: TemplateResult | typeof nothing, options: { open?: boolean; name: string }) {
  return html`<details class="bot-import__section" data-import-section=${options.name} ?open=${options.open ?? false}>
    <summary><span>${title}</span>${count ? html`<span class="bot-import__count">${count}</span>` : nothing}</summary>
    <div class="bot-import__section-body">${body}</div>
  </details>`;
}

/** The imported text, exactly as it will be used: plain text, never rendered. */
const textBlock = (text: string) => html`<pre class="bot-import__text">${text}</pre>`;

function renderPreviewStep(props: BotImportDialogProps, preview: BotImportPreview) {
  const { bot, template } = preview;
  const from = [BOT_TEMPLATE_FORMATS[template.format], template.author ? `by ${template.author}` : "", template.origin ? `· ${template.origin}` : ""].filter(Boolean).join(" ");
  const facts: [string, string][] = [
    ["Soul", preview.soul ? `${preview.soul.length.toLocaleString()} characters${preview.memories.total ? `, with ${preview.memories.included} of ${plural(preview.memories.total, "memory", "memories")}` : ""}` : "None: it starts with its first conversation"],
    ["Model", preview.model ?? "Gateway default"],
    ["Skills", preview.skills.length ? `${preview.skills.length} of its own, on` : "None of its own"],
    ["Routines", preview.routines.length ? `${preview.routines.length}, disabled` : "None"],
    ["Tools off", preview.disabledTools.length ? String(preview.disabledTools.length) : "None"],
  ];
  const missing = preview.integrations.filter((integration) => !integration.tool).length;
  return html`<div class="bot-import__who">
      ${renderBotAvatar({ id: `import:${bot.handle}`, avatar: { ...(bot.emoji ? { emoji: bot.emoji } : {}), ...bot.avatar } }, "md")}
      <div class="bot-import__identity">
        <div class="bot-import__name">${bot.name} <span class="bot-import__handle">@${bot.handle}</span></div>
        <div class="bot-import__meta">${[bot.title, `From ${from}`, bot.worker ? `Runs on ${bot.worker.name}` : ""].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
    ${preview.candidates?.length ? html`<label class="bot-import__field bot-import__field--inline">
        <span class="bot-import__label">Agent</span>
        <select class="settings-input" ?disabled=${props.pending} @change=${(event: Event) => props.onPick((event.currentTarget as HTMLSelectElement).value)}>
          ${preview.candidates.map((candidate) => html`<option value=${candidate.key} ?selected=${candidate.key === preview.pick}>${candidate.name}${candidate.title ? ` — ${candidate.title}` : ""}</option>`)}
        </select>
      </label>` : nothing}
    <p class="bot-import__untrusted" role="note"><span aria-hidden="true">${icons.alertTriangle}</span><span>Imported text is untrusted: read it below before you create the bot. An import turns nothing on beyond a new bot's defaults: its routines start disabled, and a tools list can only turn tools off.</span></p>
    <dl class="bot-import__facts">${facts.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}</dl>
    ${section("SOUL.md", preview.soul ? `${preview.soul.length.toLocaleString()} characters` : "none", preview.soul ? textBlock(preview.soul) : html`<p class="bot-import__hint">No persona: the bot asks what you expect from it and writes its own SOUL.md.</p>`, { open: true, name: "soul" })}
    ${preview.opener ? section("First message", undefined, html`${textBlock(preview.opener)}<p class="bot-import__hint">It sends this as its first message, in a first turn HUI starts once it exists.</p>`, { name: "opener" }) : nothing}
    ${preview.skills.length ? section("Skills", String(preview.skills.length), html`<ul class="bot-import__list">${preview.skills.map((skill) => html`<li>
        <div><strong>${skill.name}</strong>${skill.original && skill.original !== skill.name ? html` <span class="bot-import__muted">(from ${skill.original})</span>` : nothing} — ${skill.description}</div>
        <details><summary>Instructions</summary>${textBlock(skill.content)}</details>
      </li>`)}</ul><p class="bot-import__hint">Its own, in its home folder: only this bot loads them. They are on, like every skill of a bot; turn any off in its Tools tab.</p>`, { name: "skills" }) : nothing}
    ${preview.routines.length ? section("Routines", `${preview.routines.length} · disabled`, html`<ul class="bot-import__list">${preview.routines.map((routine) => html`<li>
        <div><strong>${routine.name}</strong> · ${describeRoutineSchedule(routine.schedule)}${routine.guessed ? html` <span class="bot-import__warn">· assumed${routine.scheduleText ? ` from “${routine.scheduleText}”` : ""}, check it</span>` : routine.scheduleText ? html` <span class="bot-import__muted">· “${routine.scheduleText}”</span>` : nothing}</div>
        ${textBlock(routine.prompt)}
      </li>`)}</ul>`, { name: "routines" }) : nothing}
    ${preview.integrations.length ? section("Integrations", missing ? `${missing} missing` : "all mapped", html`<ul class="bot-import__list bot-import__list--compact">${preview.integrations.map((integration) => html`<li class=${integration.tool ? "is-mapped" : "is-missing"}>
        <span aria-hidden="true">${integration.tool ? icons.check : icons.circleX}</span>
        <span><strong>${integration.name}</strong>${integration.tool ? html` → ${integration.tool.label} <code>${integration.tool.name}</code>` : html` <span class="bot-import__muted">· missing: HUI has no tool for it</span>`}</span>
      </li>`)}</ul>`, { name: "integrations" }) : nothing}
    ${preview.disabledTools.length ? section("Tools turned off", String(preview.disabledTools.length), html`<p class="bot-import__chips">${preview.disabledTools.map((tool) => html`<code>${tool}</code>`)}</p>`, { name: "tools" }) : nothing}
    ${preview.dropped.length ? section("Left out", String(preview.dropped.length), html`<ul class="bot-import__lines">${preview.dropped.map((line) => html`<li>${line}</li>`)}</ul>`, { name: "dropped" }) : nothing}
    ${preview.notes.length ? section("Notes", String(preview.notes.length), html`<ul class="bot-import__lines">${preview.notes.map((line) => html`<li>${line}</li>`)}</ul>`, { name: "notes", open: true }) : nothing}`;
}

export function renderBotImportDialog(props: BotImportDialogProps) {
  const preview = props.step === "preview" ? props.preview : undefined;
  return html`<dialog class="hui-modal-dialog bot-import-dialog" aria-labelledby="bot-import-title"
    @cancel=${(event: Event) => { event.preventDefault(); if (!props.pending) props.onClose(); }}>
    <form class="exec-approval-card bot-import" method="dialog" aria-busy=${props.pending ? "true" : "false"}
      @submit=${(event: SubmitEvent) => { event.preventDefault(); if (props.pending) return; if (preview) props.onCreate(); else props.onPreview(); }}>
      <header class="bot-import__header">
        <h2 class="exec-approval-title bot-import__title" id="bot-import-title">${preview ? `Import ${preview.bot.name}` : "Import bot"}</h2>
        <button type="button" class="btn btn--ghost btn--icon bot-import__close" aria-label="Close" ?disabled=${props.pending} @click=${props.onClose}>${icons.close}</button>
      </header>
      <div class="bot-import__body">
        ${preview ? renderPreviewStep(props, preview) : renderSourceStep(props)}
      </div>
      ${props.error ? html`<p class="group-action-dialog__error bot-import__error" role="alert">${props.error}</p>` : nothing}
      <div class="exec-approval-actions bot-import__actions">
        <button type="submit" class="btn primary" ?disabled=${props.pending}>${preview ? (props.pending ? "Creating…" : "Create bot") : (props.pending ? "Reading…" : "Preview")}</button>
        ${preview
          ? html`<button type="button" class="btn bot-import-back" ?disabled=${props.pending} @click=${props.onBack}>Back</button>`
          : html`<button type="button" class="btn bot-import-cancel" ?disabled=${props.pending} @click=${props.onClose}>Cancel</button>`}
      </div>
    </form>
  </dialog>`;
}

/* ── export ───────────────────────────────────────────────────────────── */

export type BotExportDialogProps = {
  bot: BotView;
  memory: boolean;
  pending: boolean;
  error: string;
  onMemory: (memory: boolean) => void;
  onExport: () => void;
  onClose: () => void;
};

export function renderBotExportDialog(props: BotExportDialogProps) {
  const { bot } = props;
  return html`<dialog class="hui-modal-dialog group-action-dialog bot-export-dialog" aria-labelledby="bot-export-title"
    @cancel=${(event: Event) => { event.preventDefault(); if (!props.pending) props.onClose(); }}>
    <form class="exec-approval-card" method="dialog" @submit=${(event: SubmitEvent) => { event.preventDefault(); if (!props.pending) props.onExport(); }}>
      <div class="exec-approval-title" id="bot-export-title">Export ${bot.name}</div>
      <div class="exec-approval-sub">A .zip with its profile, SOUL.md, its own skills, its routines and the tools and skills you turned off. Importing it gives the bot back, on this HUI or another; its chat stays here.</div>
      <label class="bot-export__memory">
        <input type="checkbox" .checked=${props.memory} ?disabled=${props.pending} @change=${(event: Event) => props.onMemory((event.currentTarget as HTMLInputElement).checked)} />
        <span>Include its memory<span class="bot-import__hint">memory.md: what its memory holds now, the latest messages and summaries of older ones. It can be private.</span></span>
      </label>
      ${props.error ? html`<p class="group-action-dialog__error" role="alert">${props.error}</p>` : nothing}
      <div class="exec-approval-actions">
        <button type="submit" class="btn primary" ?disabled=${props.pending}>${props.pending ? "Exporting…" : "Download"}</button>
        <button type="button" class="btn bot-export-cancel" ?disabled=${props.pending} @click=${props.onClose}>Cancel</button>
      </div>
    </form>
  </dialog>`;
}
