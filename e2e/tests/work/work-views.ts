/**
 * Opening a Work view for a test at either width: the wide split workspace shows the pane and
 * picks the launcher from its + menu (WORK-001, WORK-002), while a narrow screen opens the full-screen Work destination
 * from the Active panel selector (WORK-010). The test reads neither the width nor a platform, so one test proves its use
 * case where a desktop draws the pane beside the chat and where a phone draws it as a destination of its own.
 *
 * Every step waits for whichever of the two the page settles into: `isVisible()` answers at once, so a check that ran
 * before the page had rendered its layout would pick the other width's route. `reopenWork` shows a view that is already
 * open — a wide pane collapsed to its rail, or a phone's chat with the view in its Active panel selector — and
 * `hideWork` hides the pane either way. A reload at phone size lands on the chat, so a test that reloads reopens the
 * view it means.
 *
 * A view that is not a Work view's own test but opens one anyway (a chat's /btw answers in the Side chat view) uses the
 * same routes instead of assuming the pane sits beside the chat.
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
  const pane = screen.getByLabel("Work pane");
  const tab = pane.getByRole("tab", name).first();
  const rail = pane.getByRole("button", `Show ${name}`);
  await settle(tab, rail, panelSelector(screen));
  // A visible tab still has to be the active one: the pane comes back on whichever view was in front.
  if (await tab.isVisible()) {
    await tab.tap();
    return;
  }
  if (await rail.isVisible()) {
    await rail.tap();
    return;
  }
  await panelSelector(screen).tap();
  await screen.getByText(name, { exact: true }).first().tap();
};

/**
 * Hides the Work pane: a wide screen collapses it to its rail and a phone leaves the full-screen destination for the
 * chat (WORK-006, WORK-010). Both show the chat again and both keep the views mounted.
 */
export const hideWork = async (screen: Screen): Promise<void> => {
  const hide = screen.getByRole("button", "Hide Work pane");
  await settle(hide, screen.getByRole("button", "Back to chat"), panelSelector(screen));
  if (await hide.isVisible()) await hide.tap();
  else await backToChat(screen);
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
 * Gives the pane the room a view's own wide controls need: the split workspace maximizes it, and a phone's destination is
 * already the whole screen, so nothing is pressed there (WORK-010, WORK-017).
 */
export const maximizeWork = async (screen: Screen): Promise<void> => {
  const maximize = screen.getByRole("button", "Maximize Work pane");
  await settle(maximize, screen.getByRole("button", "Back to chat"), panelSelector(screen));
  if (await maximize.isVisible()) await maximize.tap();
};

/**
 * Waits for the Work pane to be hidden again: a wide screen shows its rail's Show Work pane, and a phone is back on the
 * chat, with no Back to chat control of the destination on screen (WORK-006, WORK-010).
 */
export const expectWorkPaneHidden = async (screen: Screen): Promise<void> => {
  const show = screen.getByRole("button", "Show Work pane");
  const back = screen.getByRole("button", "Back to chat");
  await settle(show, panelSelector(screen));
  await expect.poll(async () => (await show.isVisible()) || !(await back.isVisible())).toBe(true);
};
