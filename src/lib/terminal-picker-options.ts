/** Rows for the terminal switcher, keeping the current terminal selectable after it leaves the list. */
import type { PickerOption } from "../views/settings-picker.ts";
import type { TerminalView } from "./terminal-types.ts";

/** Terminal switcher rows; keeps the current id selectable when it is no longer listed. */
export function terminalPickerOptions(entries: readonly TerminalView[], terminalId: string): PickerOption[] {
  const listed = entries.map((entry) => ({ value: entry.id, label: `${entry.title}${entry.status === "exited" ? " (exited)" : ""}` }));
  return entries.some(({ id }) => id === terminalId) ? listed : [{ value: terminalId, label: "Terminal unavailable" }, ...listed];
}
