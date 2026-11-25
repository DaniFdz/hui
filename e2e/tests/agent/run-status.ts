/** The chat header's Run status popover: how the shared tests open it, and the one place they read a conversation's
 * helpers and watchers from it. */
import { expect, type Locator, type Screen } from "e2e";
import type { Hui } from "../../fixtures/hui.ts";

/** The panel itself, by test id: a content read needs a selector rather than the role-and-name locator. */
const PANEL = "[data-testid=\"run-status\"]";

/** Opens Run status and returns the popover. */
export async function openRunStatus(screen: Screen): Promise<Locator> {
  const trigger = screen.getByTestId("run-status-trigger");
  const popover = screen.getByLabel("Run status");
  // One box at a time: while the panel is out its header is the converted pill, so the trigger keeps its box as the
  // popover's anchor and its aria-expanded, but it is not painted. Attachment, not paint, is what this read needs until
  // the pill itself has to be pressed.
  await expect(trigger).toBeAttached();
  const expanded = async () => (await trigger.getAttribute("aria-expanded")) === "true";
  // The panel opens only on the operator's own press — no run and no window opens it — and Web Awesome's dialog stays on
  // screen through its show and hide animations while the pill paints only once the fold has landed. So the trigger is
  // pressed only once its aria-expanded and the screen agree, in the settled closed state and never mid-animation.
  await expect.poll(async () => (await expanded()) === (await popover.isVisible())).toBe(true);
  if (!(await expanded())) {
    // A closed panel paints the pill, and the pill is the control the operator presses to open it.
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

/**
 * Opens Run status once the run a prompt just started has settled, and returns the popover. The panel stays closed through
 * every run until the operator opens it, so a read after the turn opens it. `expected` is what the turn leaves in the
 * panel — the rows it starts and the states the gateway's poll records for them — and waiting for it first proves the run
 * began, because `Session status: Idle` also holds in the moment before a prompt's run starts. The gate reads the panel's
 * whole content: more than four watchers sit behind `Watcher details`, and a rendered read leaves those rows out while the
 * panel is open, which is the state an operator's open leaves it in. What a row shows is asserted through the disclosure
 * that holds it.
 */
export async function openSettledRunStatus(hui: Hui, screen: Screen, ...expected: readonly string[]): Promise<Locator> {
  await expect.poll(async () => {
    const shown = await hui.contentOf(PANEL);
    return expected.every((part) => shown.includes(part));
  }, { timeout: 90_000 }).toBe(true);
  await expect(screen.getByLabel("Session status: Idle")).toBeVisible();
  return openRunStatus(screen);
}

/** Opens Run status after that run settled and returns its Helpers region; a successful batch stays folded inside it. */
export async function openSettledHelpers(hui: Hui, screen: Screen, ...expected: readonly string[]): Promise<Locator> {
  const popover = await openSettledRunStatus(hui, screen, ...expected);
  const helpers = popover.getByRole("region", { name: "Helpers" });
  await expect(helpers).toBeVisible();
  return helpers;
}

/** Opens Run status after that run settled and returns its Background watchers section; more than four rows sit behind
 * Watcher details. */
export async function openSettledWatchers(hui: Hui, screen: Screen, ...expected: readonly string[]): Promise<Locator> {
  const popover = await openSettledRunStatus(hui, screen, ...expected);
  const watchers = popover.getByLabel("Background watchers");
  await expect(watchers).toBeVisible();
  return watchers;
}
