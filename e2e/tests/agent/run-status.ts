/** The chat header's Run status popover: how the shared tests open it, and the one place they read a conversation's
 * helpers and watchers from it. */
import { expect, type Locator, type Screen } from "e2e";

/** Opens Run status and returns the popover. */
export async function openRunStatus(screen: Screen): Promise<Locator> {
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");
  await expect(trigger).toBeVisible();
  const expanded = async () => (await trigger.getAttribute("aria-expanded")) === "true";
  // A wide window opens and closes it by itself around a run, and Web Awesome's dialog stays on screen through its show
  // and hide animations. Wait until the trigger's own state and what is on screen agree, so the one toggle is pressed in
  // the settled state and never mid-animation.
  await expect.poll(async () => (await expanded()) === (await popover.isVisible())).toBe(true);
  if (!(await expanded())) await trigger.tap();
  await expect(popover).toBeVisible();
  return popover;
}

/** Opens Run status and returns its Helpers region; a successful batch stays folded inside it. */
export async function openHelpers(screen: Screen): Promise<Locator> {
  const popover = await openRunStatus(screen);
  const helpers = popover.getByRole("region", { name: "Helpers" });
  await expect(helpers).toBeVisible();
  return helpers;
}

/** Opens Run status and returns its Background watchers section; more than four rows sit behind Watcher details. */
export async function openWatchers(screen: Screen): Promise<Locator> {
  const popover = await openRunStatus(screen);
  const watchers = popover.getByLabel("Background watchers");
  await expect(watchers).toBeVisible();
  return watchers;
}
