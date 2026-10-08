/**
 * The Files kind of Work view: what the Work pane needs to launch, name and render a Files view. Each launch is a new
 * view (a new id) with its own selection; the tab shows the selected file's name. The `<hui-files-view>` element
 * loads the first time a Files view renders, so neither it nor its editor weighs on the main bundle.
 *
 * Until this branch sits on the Work pane's, the contract below is a local structural copy of
 * `src/lib/work-pane.ts`'s `WorkViewKind`; registering it there is one `registerWorkViewKind(filesWorkViewKind)` call.
 */
import { html, type TemplateResult } from "lit";
import { filesViewTitle } from "../files-view-state.ts";

/* Local structural copy of the Work view contract owned by src/lib/work-pane.ts. */
export type FilesWorkViewRef = { kind: "files"; id: string };
export type WorkViewContext = {
  sessionId: string;
  visible: boolean;
  narrow: boolean;
  close(): void;
};
export type FilesWorkViewKind = {
  kind: "files";
  label: string;
  icon: TemplateResult;
  shortcut?: string;
  unavailable?(): string | undefined;
  create(sessionId: string): Promise<FilesWorkViewRef> | FilesWorkViewRef;
  key(ref: FilesWorkViewRef): string;
  title(ref: FilesWorkViewRef): string;
  render(ref: FilesWorkViewRef, ctx: WorkViewContext): TemplateResult;
};

/** Lucide folder-tree, sized for the launcher. */
const filesIcon = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/></svg>`;

let viewSequence = 0;
/** A new, page-unique view id. */
export function newFilesViewId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `files-${random}` : `files-${Date.now().toString(36)}-${(++viewSequence).toString(36)}`;
}

let loading: Promise<unknown> | undefined;
function loadFilesView(): void {
  if (typeof customElements === "undefined" || customElements.get("hui-files-view")) return;
  loading ??= import("../../components/files-view.ts").catch((error: unknown) => { loading = undefined; throw error; });
}

export const filesWorkViewKind: FilesWorkViewKind = {
  kind: "files",
  label: "Files",
  icon: filesIcon,
  shortcut: "Mod+Alt+KeyF",
  create: () => ({ kind: "files", id: newFilesViewId() }),
  key: (ref) => ref.id,
  title: (ref) => filesViewTitle(ref.id),
  render(ref, ctx) {
    loadFilesView();
    return html`<hui-files-view .sessionId=${ctx.sessionId} .viewId=${ref.id} .visible=${ctx.visible} .narrow=${ctx.narrow}></hui-files-view>`;
  },
};
