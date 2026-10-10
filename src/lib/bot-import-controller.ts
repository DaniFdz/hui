/**
 * The import and export dialogs' state (the roster's + → Import bot…, a bot's ⋯ → Export…), as a Lit controller so
 * `hui-app.ts` only opens them, renders them (`views/bot-import.ts`) and hears about an imported bot. Every request
 * goes through `bot-templates.ts`; a refusal stays in the dialog, never as an optimistic success.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { BotView } from "./bots.ts";
import { downloadBotExport, importBot, importSource, pickedFile, pickedFolder, previewBotImport, type BotImportPreview, type BotImportTab, type PickedSource } from "./bot-templates.ts";
import { ensureModal } from "./modal-dialog.ts";
import { botExportFileName } from "../../shared/bot-templates.ts";
import type { BotExportDialogProps, BotImportDialogProps } from "../views/bot-import.ts";
import type { BotPlace } from "../views/bots.ts";

type ImportState = {
  step: "source" | "preview";
  tab: BotImportTab;
  picked?: PickedSource | undefined;
  url: string;
  text: string;
  worker: string;
  pending: boolean;
  error: string;
  preview?: BotImportPreview | undefined;
};

type ExportState = { bot: BotView; memory: boolean; pending: boolean; error: string };

export type BotImportOptions = {
  /** Remote workers an import may run a bot on (Settings → Workers). */
  workers(): readonly BotPlace[];
  /** A bot was imported: the roster shows it and its chat opens; `warnings` are steps after it that failed. */
  imported(bot: BotView, warnings: readonly string[]): void;
};

export class BotImportController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #options: BotImportOptions;
  #import: ImportState | undefined;
  #export: ExportState | undefined;

  constructor(host: ReactiveControllerHost, options: BotImportOptions) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }

  hostConnected(): void {}

  get importing(): boolean { return this.#import !== undefined; }
  get exporting(): boolean { return this.#export !== undefined; }

  #set(change: Partial<ImportState>): void {
    if (!this.#import) return;
    this.#import = { ...this.#import, ...change };
    this.#host.requestUpdate();
  }

  openImport = (): void => {
    this.#import = { step: "source", tab: "file", url: "", text: "", worker: "", pending: false, error: "" };
    this.#host.requestUpdate();
  };

  /** Both dialogs go (bots were turned off, say); a request in flight finds nothing to update. */
  close = (): void => {
    this.#import = undefined;
    this.#export = undefined;
    this.#host.requestUpdate();
  };

  #closeImport = (): void => {
    if (this.#import?.pending) return;
    this.#import = undefined;
    this.#host.requestUpdate();
  };

  /** Reads a picked file or folder into a source; a refusal (too large) says so in the dialog. */
  async #pick(read: () => Promise<PickedSource>): Promise<void> {
    this.#set({ pending: true, error: "" });
    try {
      const picked = await read();
      this.#set({ picked, pending: false });
    } catch (error) {
      this.#set({ pending: false, picked: undefined, error: error instanceof Error ? error.message : "That file could not be read." });
    }
  }

  async #preview(pick?: string): Promise<void> {
    const state = this.#import;
    if (!state || state.pending) return;
    const source = importSource(state.tab, state);
    if (typeof source === "string") {
      this.#set({ error: source });
      return;
    }
    this.#set({ pending: true, error: "" });
    try {
      const preview = await previewBotImport({ source, ...(pick !== undefined ? { pick } : {}), ...(state.worker ? { worker: state.worker } : {}) });
      if (this.#import === undefined) return;
      this.#set({ step: "preview", preview, pending: false });
    } catch (error) {
      this.#set({ pending: false, error: error instanceof Error ? error.message : "HUI could not read that template." });
    }
  }

  async #create(): Promise<void> {
    const state = this.#import;
    if (!state?.preview || state.pending) return;
    this.#set({ pending: true, error: "" });
    try {
      const result = await importBot(state.preview.template, state.worker || undefined);
      if (this.#import === undefined) return;
      this.#import = undefined;
      this.#host.requestUpdate();
      this.#options.imported(result.bot, result.warnings);
    } catch (error) {
      this.#set({ pending: false, error: error instanceof Error ? error.message : "The bot could not be imported." });
    }
  }

  importProps(): BotImportDialogProps | undefined {
    const state = this.#import;
    if (!state) return undefined;
    return {
      ...state,
      workers: this.#options.workers(),
      onTab: (tab) => this.#set({ tab, error: "" }),
      onPickFile: (file) => void this.#pick(() => pickedFile(file)),
      onPickFolder: (files) => void this.#pick(() => pickedFolder(files)),
      onUrl: (url) => this.#set({ url }),
      onText: (text) => this.#set({ text }),
      onWorker: (worker) => this.#set({ worker }),
      onPreview: () => void this.#preview(),
      onPick: (key) => void this.#preview(key),
      onBack: () => this.#set({ step: "source", error: "" }),
      onCreate: () => void this.#create(),
      onClose: this.#closeImport,
    };
  }

  openExport = (bot: BotView): void => {
    this.#export = { bot, memory: false, pending: false, error: "" };
    this.#host.requestUpdate();
  };

  async #download(): Promise<void> {
    const state = this.#export;
    if (!state || state.pending) return;
    this.#export = { ...state, pending: true, error: "" };
    this.#host.requestUpdate();
    try {
      await downloadBotExport(state.bot.id, { memory: state.memory, fallbackName: botExportFileName(state.bot.handle) });
      this.#export = undefined;
    } catch (error) {
      if (this.#export) this.#export = { ...this.#export, pending: false, error: error instanceof Error ? error.message : "The bot could not be exported." };
    }
    this.#host.requestUpdate();
  }

  exportProps(): BotExportDialogProps | undefined {
    const state = this.#export;
    if (!state) return undefined;
    return {
      ...state,
      onMemory: (memory) => {
        if (this.#export) this.#export = { ...this.#export, memory };
        this.#host.requestUpdate();
      },
      onExport: () => void this.#download(),
      onClose: () => {
        if (this.#export?.pending) return;
        this.#export = undefined;
        this.#host.requestUpdate();
      },
    };
  }

  /** After a render: an open dialog shows as a modal, its first control focused. */
  showDialogs(root: ParentNode): void {
    for (const [open, selector, focus] of [[this.importing, ".bot-import-dialog", ".bot-import-cancel, .bot-import-back"], [this.exporting, ".bot-export-dialog", ".bot-export-cancel"]] as const) {
      if (!open) continue;
      const dialog = root.querySelector?.(selector);
      if (dialog instanceof HTMLDialogElement && !dialog.open) {
        ensureModal(dialog);
        dialog.querySelector<HTMLElement>(focus)?.focus();
      }
    }
  }
}
