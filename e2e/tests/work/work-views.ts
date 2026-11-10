/**
 * Opening a Work view for the WORK area's shared tests at either width: the wide split workspace shows the pane and
 * picks the launcher from its + menu (WORK-001, WORK-002), while a narrow screen opens the full-screen Work destination
 * from the Active panel selector (WORK-010). The test reads neither the width nor a platform, so one test proves its use
 * case where a desktop draws the pane beside the chat and where a phone draws it as a destination of its own.
 */
import type { Screen } from "e2e";

/** Opens the named Work view, by the name the + menu and the panel selector both show it under. */
export const openWork = async (screen: Screen, name: string): Promise<void> => {
  const plus = screen.getByRole("button", "Open Work view");
  const show = screen.getByRole("button", "Show Work pane");
  if (await plus.isVisible() || await show.isVisible()) {
    if (await show.isVisible()) await show.tap();
    await plus.tap();
    await screen.getByRole("menuitem").filter({ hasText: name }).tap();
    return;
  }
  await screen.getByRole("button", { name: /^Active panel/u }).tap();
  await screen.getByText(name, { exact: true }).first().tap();
};

/**
 * Makes the Files navigator visible: the column beside the editor on the web, the drawer a narrow screen opens over it
 * (WORK-056). Both widths show the same Show files / Hide files control, so a test reaches a file the same way.
 */
export const showFiles = async (screen: Screen): Promise<void> => {
  if (await screen.getByLabel("Files navigator").isVisible()) return;
  await screen.getByRole("button", "Show files").tap();
};
