/** The chat header's Run status popover: the one place the shared tests read a conversation's helpers and watchers. */
import { expect, type Locator, type Screen } from "e2e";

/** Opens Run status when it is closed and returns the popover. */
export async function openRunStatus(screen: Screen): Promise<Locator> {
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");
  if (!(await popover.isVisible())) {
    await expect(trigger).toBeVisible();
    await trigger.tap();
  }
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
