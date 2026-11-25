/** A phone's chat spends one header row: the navigation menu leads it, the Active panel chooser sits in the header in
 * place of the title, and the Run status plan is always open and its panel settles on the actions group's corner,
 * clear of that menu (SHELL-047). */
import { expect } from "e2e";
import { test } from "../../fixtures/hui.ts";
import type { Settings } from "../../../src/api/schema/settings.ts";

test(
  "a phone's chat keeps its chooser in the header and its Run status plan always open",
  { tags: ["SHELL-047"], platforms: ["web"] },
  async ({ screen, hui }) => {
    const settings = await hui.api<Settings>("GET", "/__hui/settings");
    await hui.api("PUT", "/__hui/settings", {
      ...settings,
      models: { ...settings.models, utility: "hui-e2e/fixture" },
    });
    const session = await hui.createSession({ title: "Phone chat" });
    await hui.open(`/sessions/${session.id}`);
    await hui.phoneScreen();

    const header = screen.getByTestId("chat-header");
    const picker = screen.getByRole("button", { name: /^Active panel:/u });
    await expect(picker).toBeVisible();
    const [head, chooser] = await Promise.all([
      header.boundingBox(),
      picker.boundingBox(),
    ]);
    expect(chooser!.y).toBeGreaterThanOrEqual(head!.y);
    expect(chooser!.y + chooser!.height).toBeLessThanOrEqual(
      head!.y + head!.height + 1,
    );
    expect(head!.height).toBeLessThan(70);

    await picker.tap();
    const list = screen.getByTestId("picker-list");
    for (const label of [
      "Chat",
      "Work",
      "New terminal",
      "Browser",
      "Files",
      "VS Code",
      "Diff",
    ]) {
      await expect(
        list.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }
    await list.getByText("Chat", { exact: true }).tap();

    await screen.getByLabel("Message").fill("E2E_PROGRESS");
    await screen.getByRole("button", "Send message").tap();
    const trigger = screen.getByTestId("run-status-trigger");
    const popover = screen.getByLabel("Run status");
    // A phone never opens the popover by itself, so it is closed here and the trigger is the only way in.
    await expect(popover).toBeHidden();
    await trigger.tap();
    await expect(popover).toBeVisible();
    await expect(screen.getByText("1 of 2", { visible: true })).toBeVisible();
    const steps = screen.getByLabel("Task progress steps");
    await expect(steps.getByText("Read fixture")).toBeVisible();
    await screen.getByText("1 of 2", { visible: true }).tap();
    await expect(steps.getByText("Read fixture")).toBeVisible();
    await expect(screen.getByTestId("task-progress").getByRole("button", { name: "Recompute", exact: true })).toBeVisible();
    await expect.poll(() => hui.contentOf(".chat-run-status__head .chat-run-status__state")).toBe("Status");
    const pill = await trigger.boundingBox();
    const actions = await hui.rect(".chat-pane__header-actions");
    // Scoped to the header: the shell topbar draws an Open navigation button of its own.
    const navToggle = header.getByRole("button", "Open navigation");
    const nav = await navToggle.boundingBox();
    const panel = await popover.boundingBox();
    expect(pill).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(Math.abs(panel!.y - actions!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(panel!.x + panel!.width - actions!.x - actions!.width)).toBeLessThanOrEqual(1);
    // The menu leads the header, so the panel that settles on the actions group's right edge clears it.
    expect(nav!.x + nav!.width).toBeLessThanOrEqual(panel!.x);
    // It sits in the header's own row, not merely somewhere on the screen.
    expect(nav!.y).toBeGreaterThanOrEqual(head!.y);
    expect(nav!.y + nav!.height).toBeLessThanOrEqual(head!.y + head!.height + 1);
    // The menu leads the header, before the chooser that follows it in the same leading group.
    expect(nav!.x + nav!.width).toBeLessThanOrEqual(chooser!.x);
    if ((await hui.viewportSize()).width === 390) expect(Math.abs(panel!.width - 318)).toBeLessThanOrEqual(1);
    expect(nav!.x + nav!.width).toBeLessThanOrEqual(pill!.x);
    expect(nav!.x + nav!.width).toBeLessThanOrEqual(actions!.x);
    expect(nav!.width).toBeGreaterThanOrEqual(24);
    expect(await hui.overflowsSideways()).toBe(false);
    // The panel's own first line is the phone's close: one tap on the pill's copy and chevron mark folds it back into the
    // pill, which paints again with the state its accessible name carries.
    await screen.getByTestId("run-status-head-close").tap();
    await expect(popover).toBeHidden();
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleName(/^Run status: /u);
    await trigger.tap();
    await expect(popover).toBeVisible();
    // The tap that opens the drawer also dismisses the panel sitting over the header row.
    await navToggle.tap();
    await expect(popover).toBeHidden();
    await expect(screen.getByRole("button", "Close navigation").first()).toBeVisible();
    // The menu it came from keeps the header on one row.
    expect((await header.boundingBox())!.height).toBeLessThan(70);
  },
);
