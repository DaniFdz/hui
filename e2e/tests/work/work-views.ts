/**
 * Opening, leaving and coming back to a Work view for the WORK area's shared tests at either width: the wide split
 * workspace shows the pane and picks the launcher from its + menu (WORK-001, WORK-002), while a narrow screen opens the
 * full-screen Work destination from the Active panel selector (WORK-010). The test reads neither the width nor a platform,
 * so one test proves its use case where a desktop draws the pane beside the chat and where a phone draws it as a
 * destination of its own.
 *
 * Every step waits for whichever of the two the page settles into: `isVisible()` answers at once, so a check that ran
 * before the page had rendered its layout would pick the other width's route.
 */
import { expect, type Locator, type Screen } from "e2e";
import type { Hui } from "../../fixtures/hui.ts";

/** Resolves once one of the candidates is on screen: the page has drawn the layout it is going to use. */
export const settle = async (...candidates: Locator[]): Promise<void> => {
  await expect.poll(async () => (await Promise.all(candidates.map((candidate) => candidate.isVisible()))).some(Boolean)).toBe(true);
};

const panelSelector = (screen: Screen) => screen.getByRole("button", { name: /^Active panel/u });

/** Opens the named Work view, by the name the + menu and the panel selector both show it under. */
export const openWork = async (screen: Screen, name: string): Promise<void> => {
  const plus = screen.getByRole("button", "Open Work view");
  const show = screen.getByRole("button", "Show Work pane");
  await settle(show, plus, panelSelector(screen));
  if (await plus.isVisible() || await show.isVisible()) {
    if (await show.isVisible()) await show.tap();
    await plus.tap();
    await screen.getByRole("menuitem").filter({ hasText: name }).tap();
    return;
  }
  await panelSelector(screen).tap();
  await screen.getByText(name, { exact: true }).first().tap();
};

/**
 * Makes the Files navigator visible: the column beside the editor on the web, the drawer a narrow screen opens over it
 * (WORK-056). Both widths show the same Show files / Hide files control, so a test reaches a file the same way.
 */
export const showFiles = async (screen: Screen): Promise<void> => {
  const navigator = screen.getByLabel("Files navigator");
  await settle(navigator, screen.getByRole("button", "Show files"), screen.getByRole("button", "Hide files"));
  if (await navigator.isVisible()) return;
  await screen.getByRole("button", "Show files").tap();
};

/**
 * Shows the Work pane with its launchers: a wide screen expands it from its rail, a narrow one chooses the empty Work
 * destination in the Active panel selector (WORK-010). Nothing is launched, so the caller still owns what it opens.
 */
export const showWork = async (screen: Screen): Promise<void> => {
  const show = screen.getByRole("button", "Show Work pane");
  await settle(show, panelSelector(screen));
  if (await show.isVisible()) {
    await show.tap();
    return;
  }
  await panelSelector(screen).tap();
  await screen.getByText("Work", { exact: true }).first().tap();
};

/** Leaves the full-screen Work destination for the chat; a wide screen already shows both, so there is nothing to do. */
export const backToChat = async (screen: Screen): Promise<void> => {
  const back = screen.getByRole("button", "Back to chat");
  if (await back.isVisible()) await back.tap();
};

/**
 * Leaves the Work pane so the chat is on screen again: a wide screen collapses the pane to its rail, a phone returns from
 * its full-screen Work destination to the conversation (WORK-006, WORK-010). The open views stay mounted either way, so a
 * caller reads the chat and comes back with `resumeWork`.
 */
export const leaveWork = async (screen: Screen): Promise<void> => {
  const hide = screen.getByRole("button", "Hide Work pane");
  const back = screen.getByRole("button", "Back to chat");
  await settle(hide, back);
  if (await hide.isVisible()) await hide.tap();
  else await back.tap();
};

/**
 * Shows the conversation's terminal again, the way the chat's own Open terminal offers it at either width (WORK-024): a
 * wide screen already draws the pane beside the chat, and a phone leaves the chat for the full-screen destination. A
 * reloaded terminal has not named itself yet, so its tab caption is no way to find it.
 */
export const openTerminalView = async (screen: Screen): Promise<void> => {
  const shown = screen.getByRole("button", "Hide Work pane");
  const back = screen.getByRole("button", "Back to chat");
  const open = screen.getByRole("button", "Open terminal");
  await settle(shown, back, open);
  if (await shown.isVisible() || await back.isVisible()) return;
  await expect(open).toBeEnabled();
  await open.tap();
};

/**
 * Shows the pane again after `leaveWork`, with the view it had in front: a wide screen expands it from its rail, a phone
 * chooses that view in the Active panel selector (WORK-006, WORK-010). `title` is the caption the view is listed under.
 * The wide layout's rail is the only difference, so the app's own breakpoint picks the branch and each waits for the
 * controls it is about to use: a reload lays the page out again, and reading a control before that would pick the other.
 */
export const resumeWork = async (hui: Hui, screen: Screen, title: string): Promise<void> => {
  if (await hui.narrowLayout()) {
    const back = screen.getByRole("button", "Back to chat");
    await settle(back, panelSelector(screen));
    if (await back.isVisible()) return;
    await panelSelector(screen).tap();
    // A caption a view only reports once it has reconnected is waited for, not read once.
    const option = screen.getByText(title, { exact: true }).first();
    await expect(option).toBeVisible();
    await option.tap();
    return;
  }
  const shown = screen.getByRole("button", "Hide Work pane");
  const collapsed = screen.getByRole("button", "Show Work pane");
  await settle(shown, collapsed);
  if (await shown.isVisible()) return;
  await collapsed.tap();
};
