/**
 * The words the Files view shows: its navigator's labels, the new file and folder dialog, and the delete
 * confirmation's list of what goes. The web renders them and the iOS core hands the same ones to the app, so both
 * platforms say the same thing and a shared test reads one set of words.
 */

export const FILES_COPY = {
  view: "Files",
  navigator: "Files navigator",
  filter: "Filter files",
  workingDirectory: "the working directory",
  emptyFolder: "Empty folder",
  emptyRoot: "This folder is empty. Create a file or drop files here.",
  loading: "Loading files…",
  loadingFolder: "Loading…",
  linkOutside: "link outside this folder",
  notRegularFile: "not a regular file",
  newFile: "New file",
  newFolder: "New folder",
  name: "Name",
  cancel: "Cancel",
  delete: "Delete",
  irreversible: "Deleting does not use the trash and cannot be undone. It removes:",
  truncated: "Only the first 2,000 entries are listed; use the filter to find the rest.",
} as const;

/** The Work pane tab's caption: the selected file's name, or the view's own name. */
export function filesTabTitle(selected: string | undefined): string {
  return selected ? selected.slice(selected.lastIndexOf("/") + 1) : FILES_COPY.view;
}

/** The editor's accessible name, so a test tells it from the filter. */
export function filesEditorLabel(path: string): string {
  return `Contents of ${path}`;
}

export function filesNoMatch(query: string): string {
  return `No file matches “${query}”.`;
}

export function filesCreatedLabel(kind: "file" | "directory"): string {
  return `Create ${kind === "file" ? "file" : "folder"}`;
}

/** Where a new entry goes, named as the user chose the folder. */
export function filesCreateIn(folder: string, root: string): string {
  return `In ${folder || root}`;
}

export function filesDeleteLabel(name: string): string {
  return `${FILES_COPY.delete} ${name}`;
}

export function filesDeleteTitle(name: string): string {
  return `${FILES_COPY.delete} ${name}?`;
}

export type FilesDeleteRisk = {
  path: string;
  directory: boolean;
  symlink: boolean;
  /** The file's size, already written for people ("1.2 KB"); nothing when it is unknown. */
  size?: string;
  /** The open file, when it is the deleted entry or inside it. */
  open?: string;
  /** The file whose unsaved edits are lost, when there are any. */
  unsaved?: string;
};

/** What a confirmed delete destroys, one line each, as the web lists them. */
export function filesDeleteRisks(risk: FilesDeleteRisk): string[] {
  const folder = risk.directory && !risk.symlink;
  const lines = [folder
    ? `The folder ${risk.path} and everything inside it.`
    : risk.symlink || risk.directory
      ? `The link ${risk.path}. What it points to is kept.`
      : `The file ${risk.path}${risk.size ? ` (${risk.size})` : ""}.`];
  if (risk.unsaved) lines.push(`Unsaved edits to ${risk.unsaved}.`);
  if (risk.open && folder) lines.push(`The open file ${risk.open} closes.`);
  return lines;
}

/** A file's size for people, as the delete confirmation writes it. */
export function filesBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
