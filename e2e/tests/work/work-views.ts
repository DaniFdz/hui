/**
 * Opening a Work view for the WORK area's shared tests at either width: the wide split workspace shows the pane and
 * picks the launcher from its + menu (WORK-001, WORK-002), while a narrow screen opens the full-screen Work destination
 * from the Active panel selector (WORK-010). The test reads neither the width nor a platform, so one test proves its use
 * case where a desktop draws the pane beside the chat and where a phone draws it as a destination of its own.
 *
 * Every step waits for whichever of the two the page settles into: `isVisible()` answers at once, so a check that ran
 * before the page had rendered its layout would pick the other width's route. `reopenWork` shows a view that is already
 * open: a phone reloads onto the chat and keeps the view in its Active panel selector, while a wide pane comes back
 * open on it.
 */
import { expect, type Locator, type Screen } from "e2e";

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
 * Shows a Work view that is already open. A wide screen keeps its pane open across a reload; a phone leaves it on the
 * chat, with the conversation's views still listed in the Active panel selector, so the test picks the view there
 * (WORK-010, WORK-011). A caller that has just opened the view on a phone finds it shown already and this does nothing.
 */
export const reopenWork = async (screen: Screen, name: string): Promise<void> => {
  const tab = screen.getByLabel("Work pane").getByRole("tab", name);
  await settle(tab, panelSelector(screen));
  if (await tab.isVisible()) return;
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
